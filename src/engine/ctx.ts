// Execution context for one action. Effects are written as straight-line code; when a player must
// choose, ctx.choose() either returns the answer given earlier or throws NeedChoice. apply() then
// stores the request as `pending` and, once answered, re-runs the action from its starting state.
import { def } from './db';
import { next, shuffleInPlace } from './rng';
import { keyOf, nameOf } from './state';
import type { CardId, ChoiceRequest, GameState, PlayerId, PlayerState, Purpose, Slot } from './types';

export class NeedChoice {
  constructor(readonly request: ChoiceRequest) {}
}

export class GameOver {}

export interface PickOpts {
  prompt: string;
  min?: number;
  max?: number;
  purpose?: Purpose;
  secret?: boolean;
  source?: string;
  hint?: string;
  ordered?: boolean;
}

export class Ctx {
  private answered = 0;
  private logCopied = false;

  constructor(
    readonly s: GameState,
    private readonly answers: readonly number[][],
  ) {}

  ps(p: PlayerId): PlayerState {
    return this.s.players[p];
  }

  // ---------- choices ----------

  choose(req: ChoiceRequest): number[] {
    const max = req.repeat ? req.max : Math.min(req.max, req.options.length);
    const min = Math.min(req.min, max);
    if (max <= 0 || req.options.length === 0) return [];
    // Nothing to decide: every option must be taken, in any order.
    if (!req.repeat && !req.ordered && min >= req.options.length) return req.options.map((o) => o.value);
    if (!req.repeat && req.ordered && req.options.length === 1 && min >= 1) return [req.options[0]!.value];
    if (req.repeat && req.options.length === 1 && min === max) return Array(max).fill(req.options[0]!.value);

    const full: ChoiceRequest = { ...req, min, max };
    if (this.answered < this.answers.length) {
      const picks = this.answers[this.answered++]!;
      const problem = invalidPicks(full, picks);
      if (problem) throw new Error(`invalid choice for "${req.prompt}": ${problem}`);
      return picks;
    }
    throw new NeedChoice(full);
  }

  yesNo(player: PlayerId, prompt: string, source?: string, hint?: string): boolean {
    const [v] = this.choose({
      player,
      purpose: 'yesno',
      prompt,
      source,
      hint,
      options: [
        { value: 1, label: 'ใช่' },
        { value: 0, label: 'ไม่' },
      ],
      min: 1,
      max: 1,
    });
    return v === 1;
  }

  pickOption(player: PlayerId, prompt: string, labels: string[], source?: string, purpose: Purpose = 'option'): number {
    const [v] = this.choose({
      player,
      purpose,
      prompt,
      source,
      options: labels.map((label, value) => ({ value, label })),
      min: 1,
      max: 1,
    });
    return v!;
  }

  pickCards(player: PlayerId, cards: CardId[], o: PickOpts): CardId[] {
    return this.choose({
      player,
      purpose: o.purpose ?? 'take',
      prompt: o.prompt,
      source: o.source,
      hint: o.hint,
      secret: o.secret,
      ordered: o.ordered,
      options: cards.map((c) => ({ value: c, label: nameOf(this.s, c), card: c })),
      min: o.min ?? 1,
      max: o.max ?? 1,
    });
  }

  pickSlots(player: PlayerId, slots: Slot[], o: PickOpts & { repeat?: boolean }): Slot[] {
    const picks = this.choose({
      player,
      purpose: o.purpose ?? 'target',
      prompt: o.prompt,
      source: o.source,
      hint: o.hint,
      repeat: o.repeat,
      options: slots.map((sl) => ({
        value: sl.uid,
        label: nameOf(this.s, sl.stack[sl.stack.length - 1]!),
        slot: sl.uid,
      })),
      min: o.min ?? 1,
      max: o.max ?? 1,
    });
    return picks.map((uid) => slots.find((sl) => sl.uid === uid)!);
  }

  // ---------- log ----------

  log(text: string, player: PlayerId | null = null): void {
    if (this.s.quiet) return;
    if (!this.logCopied) {
      this.s.log = this.s.log.slice();
      this.logCopied = true;
    }
    this.s.log.push({ turn: this.s.turn, player, text, step: this.s.steps });
  }

  who(p: PlayerId): string {
    return this.s.names[p];
  }

  end(winner: PlayerId | 'draw', reason: string): never {
    this.s.winner = winner;
    this.s.winReason = reason;
    this.s.phase = 'over';
    this.log(winner === 'draw' ? `เสมอ (${reason})` : `${this.who(winner)} ชนะ (${reason})`);
    throw new GameOver();
  }

  // ---------- randomness ----------

  flip(): boolean {
    const [r, st] = next(this.s.rng.coin);
    this.s.rng.coin = st;
    const heads = r < 0.5;
    this.log(`โยนเหรียญ: ${heads ? 'หัว' : 'ก้อย'}`);
    return heads;
  }

  shuffle(p: PlayerId): void {
    this.s.rng.shuffle[p] = shuffleInPlace(this.ps(p).deck, this.s.rng.shuffle[p]);
  }

  // ---------- zones (deck index 0 is the top) ----------

  draw(p: PlayerId, n: number): number {
    const ps = this.ps(p);
    const k = Math.max(0, Math.min(n, ps.deck.length));
    if (k > 0) ps.hand.push(...ps.deck.splice(0, k));
    if (k > 0) this.log(`${this.who(p)} จั่ว ${k} ใบ`, p);
    return k;
  }

  /** Remove `card` from wherever it is among p's hand/deck/discard/prizes. */
  take(p: PlayerId, card: CardId): CardId {
    const ps = this.ps(p);
    for (const zone of [ps.hand, ps.deck, ps.discard, ps.prizes]) {
      const i = zone.indexOf(card);
      if (i >= 0) {
        zone.splice(i, 1);
        return card;
      }
    }
    throw new Error(`card ${card} is not in a zone of player ${p}`);
  }

  toHand(p: PlayerId, cards: CardId[]): void {
    for (const c of cards) this.ps(p).hand.push(this.take(p, c));
  }

  toDiscard(p: PlayerId, cards: CardId[]): void {
    for (const c of cards) this.ps(p).discard.push(this.take(p, c));
  }

  /** Put cards into the deck, then shuffle. */
  shuffleIn(p: PlayerId, cards: CardId[]): void {
    for (const c of cards) this.ps(p).deck.push(this.take(p, c));
    this.shuffle(p);
  }

  /** Search the deck (secret to opponents). Returns the picked cards, still in the deck. */
  search(p: PlayerId, filter: (key: string) => boolean, o: PickOpts): CardId[] {
    const ps = this.ps(p);
    const found = ps.deck.filter((c) => filter(keyOf(this.s, c)));
    // Copies only matter when more than one card can be taken (two Dreepy with Poffin).
    const options = (o.max ?? 1) === 1 ? uniqueByKey(this.s, found) : found;
    return this.pickCards(p, options, {
      purpose: 'search',
      secret: true,
      min: 0,
      ...o,
    });
  }

  newSlot(card: CardId): Slot {
    return {
      uid: this.s.nextUid++,
      stack: [card],
      energy: [],
      tool: null,
      damage: 0,
      enteredTurn: this.s.turn,
      evolvedTurn: -1,
      conditions: [],
      marks: [],
      usedAbility: {},
    };
  }

  /** Move a Pokémon in play and everything attached to the discard pile. */
  discardSlot(p: PlayerId, slot: Slot): void {
    this.detachSlot(p, slot);
    const ps = this.ps(p);
    ps.discard.push(...slot.stack, ...slot.energy, ...(slot.tool !== null ? [slot.tool] : []));
  }

  /** Remove a slot from play without moving its cards anywhere (caller places them). */
  detachSlot(p: PlayerId, slot: Slot): void {
    const ps = this.ps(p);
    if (ps.active?.uid === slot.uid) ps.active = null;
    else ps.bench = ps.bench.filter((b) => b.uid !== slot.uid);
  }

  cardName(card: CardId): string {
    return def(keyOf(this.s, card)).name;
  }
}

/**
 * Offer one option per distinct card when a choice is about which card, not which copy:
 * picking any Ultra Ball out of four in the deck is the same decision. Keeps choices small.
 */
export function uniqueByKey(s: GameState, cards: CardId[]): CardId[] {
  const seen = new Set<string>();
  const out: CardId[] = [];
  for (const c of cards) {
    const k = keyOf(s, c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function invalidPicks(req: ChoiceRequest, picks: number[]): string | undefined {
  if (!Array.isArray(picks)) return 'picks must be an array';
  if (picks.length < req.min || picks.length > req.max) return `pick ${req.min}–${req.max}, got ${picks.length}`;
  const values = new Set(req.options.map((o) => o.value));
  for (const v of picks) if (!values.has(v)) return `${v} is not an option`;
  if (!req.repeat && new Set(picks).size !== picks.length) return 'duplicate picks';
  return undefined;
}
