// Transcribing a real game from a broadcast (BOT-PRO.md): the engine plays the game as the transcriber clicks, dealing
// stand-ins for every card the broadcast doesn't show (engine/script.ts), and the result is a saved game like any
// other, with its DealScript, which replays under any seed. Pure; components/transcribe/Transcribe.svelte renders it.
import { tx } from '../i18n';
import { DEFAULT_POLICY } from '../bots/plans';
import { actor, apply, createGame, legalActions } from '../engine/actions';
import { def } from '../engine/db';
import { emptyScript, nameCard, unknownCards } from '../engine/script';
import { keyOf } from '../engine/state';
import type { Action, CardId, DealScript, GameState, PlayerId } from '../engine/types';
import { gamesFile, replay, type ProMeta, type SavedGame } from '../review/record';
import { describeAction, handActions } from './play';

export interface Transcript {
  seed: number;
  decks: [string[], string[]];
  names: [string, string];
  /** The meta deck whose plan each seat is reviewed with (SavedGame mine / opponent). */
  plans: [string, string];
  pro: ProMeta;
  states: GameState[];
  actions: Action[];
}

export interface StartOptions {
  decks: [string[], string[]];
  names: [string, string];
  plans: [string, string];
  pro: ProMeta;
  /** Mulligans each player took in the real game. */
  mulligans?: [number, number];
  seed?: number;
}

/** A new transcript: the game before its first choice (who goes first), dealing stand-ins. */
export function startTranscript(o: StartOptions): Transcript {
  const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
  const s = createGame({
    seed,
    decks: [
      { name: o.names[0], cards: o.decks[0] },
      { name: o.names[1], cards: o.decks[1] },
    ],
    names: o.names,
    script: { ...emptyScript(), ...(o.mulligans ? { mulligans: o.mulligans } : {}) },
  });
  return { seed, decks: o.decks, names: o.names, plans: o.plans, pro: o.pro, states: [s], actions: [] };
}

/** A transcript picked up from its saved game (the page keeps one while transcribing): the game goes on recording. */
export function fromSaved(g: SavedGame): Transcript {
  const states = replay(g);
  const last = states[states.length - 1]!;
  if (last.script) states[states.length - 1] = { ...last, script: { ...last.script, record: true } };
  return {
    seed: g.seed,
    decks: g.decks,
    names: g.pro?.players ?? [g.mineName ?? '', g.opponentName],
    plans: [g.mine ?? 'player', g.opponent],
    pro: g.pro ?? { event: '', players: [g.mineName ?? '', g.opponentName], source: 'other' },
    states,
    actions: g.actions,
  };
}

export const current = (t: Transcript): GameState => t.states[t.states.length - 1]!;

/** The next move or answer, checked against the rules: an illegal one throws, which means the transcript is wrong somewhere. */
export function act(t: Transcript, a: Action): Transcript {
  const s = apply(current(t), a);
  return { ...t, states: [...t.states, s], actions: [...t.actions, a] };
}

export function undo(t: Transcript): Transcript {
  if (t.states.length < 2) return t;
  return { ...t, states: t.states.slice(0, -1), actions: t.actions.slice(0, -1) };
}

export const isKnown = (s: GameState, c: CardId): boolean => s.script?.known.includes(c) ?? true;

/** The cards in p's hand the transcript hasn't seen. */
export const standIns = (s: GameState, p: PlayerId): CardId[] => s.players[p].hand.filter((c) => !isKnown(s, c));

/** What a stand-in of p may still be: each card with copies not yet seen in p's hidden zones, and how many. */
export function unseenKeys(s: GameState, p: PlayerId): { key: string; name: string; left: number }[] {
  const ps = s.players[p];
  const hidden = new Set([...ps.deck, ...ps.prizes, ...ps.hand]);
  const left = new Map<string, number>();
  for (const c of unknownCards(s, p)) if (hidden.has(c)) left.set(keyOf(s, c), (left.get(keyOf(s, c)) ?? 0) + 1);
  return [...left]
    .map(([key, n]) => ({ key, name: def(key).name, left: n }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where the pending choice's action started: the index of that position among the transcript's, and the position
 * itself. The setup's choices start from the game before setup, which createGame() never returns: it comes from the
 * pending choice, and the transcript is rebuilt by applying setup to it again (`setup`).
 */
function baseOf(t: Transcript): { i: number; base: GameState; setup: boolean } {
  const cur = current(t);
  if (!cur.pending) return { i: t.states.length - 1, base: cur, setup: false };
  const i = t.states.indexOf(cur.pending.base);
  if (i >= 0) return { i, base: t.states[i]!, setup: false };
  if (cur.pending.action.t === 'setup') return { i: 0, base: cur.pending.base, setup: true };
  throw new Error('transcript: the pending choice did not start from a recorded position');
}

/**
 * The stand-in `card` is the `key` the broadcast showed (engine/script.ts nameCard). With a choice pending, the naming
 * is done on the position the action started from, and the action and the answers given so far are run again; an
 * answer that pointed at the stand-in now points at the named card. Returns the transcript and the named card.
 */
export function name(t: Transcript, card: CardId, key: string): { t: Transcript; card: CardId } {
  const { i, base, setup } = baseOf(t);
  const named = nameCard(base, card, key);
  const other = named.script!.known[named.script!.known.length - 1]!;
  const swap = (c: number) => (c === card ? other : c === other ? card : c);
  const states = [...t.states.slice(0, i), setup ? apply(named, { t: 'setup' }, { trusted: true }) : named];
  const actions = t.actions.slice(0, i);
  for (let j = i; j < t.actions.length; j++) {
    let a = t.actions[j]!;
    if (a.t === 'choose') {
      const options = t.states[j]!.pending?.request.options ?? [];
      a = { t: 'choose', picks: a.picks.map((v) => (options.some((o) => o.value === v && o.card !== undefined) ? swap(v) : v)) };
    } else if ('card' in a) a = { ...a, card: swap(a.card) };
    states.push(apply(states[states.length - 1]!, a));
    actions.push(a);
  }
  return { t: { ...t, states, actions }, card: other };
}

/**
 * A card seen for the first time as it is played or picked: the first stand-in `among` (the pending choice's unseen
 * options, else the hand of the player to act) becomes it.
 */
export function nameUnseen(t: Transcript, key: string, among?: CardId[]): { t: Transcript; card: CardId } {
  const s = current(t);
  const pool = among ?? standIns(s, actor(s));
  const standIn = pool.find((c) => !isKnown(s, c));
  if (standIn === undefined) throw new Error(tx('ไม่มีการ์ดที่ยังไม่เห็นเหลือตรงนี้', 'No unseen card is left here'));
  return name(t, standIn, key);
}

/** The unseen cards among a pending choice's options. */
export function unseenOptions(s: GameState): CardId[] {
  const req = s.pending?.request;
  if (!req) return [];
  return req.options.filter((o) => o.card !== undefined && !isKnown(s, o.card)).map((o) => o.card!);
}

export interface Command {
  label: string;
  action: Action;
}

/** What the player to act can do now, the cards not yet seen aside (nameUnseen() one first). One entry per card name. */
export function commands(s: GameState): Command[] {
  if (s.pending || s.winner !== null) return [];
  const out: Command[] = [];
  const seen = new Set<string>();
  for (const [card, ca] of handActions(s)) {
    if (!isKnown(s, card) || seen.has(keyOf(s, card))) continue;
    seen.add(keyOf(s, card));
    for (const a of ca.kind === 'now' ? [ca.action] : ca.actions) out.push({ label: describeAction(s, a), action: a });
  }
  for (const a of legalActions(s)) if (!('card' in a)) out.push({ label: describeAction(s, a), action: a });
  return out;
}

/** The coin flips of the action being transcribed (in progress with a choice pending, else the last one), with their index in the script. */
export function flipsOf(t: Transcript): { index: number; heads: boolean }[] {
  const cur = current(t);
  const before = cur.pending ? cur.pending.base : t.states[t.states.length - 2];
  if (!cur.script || !before) return [];
  const from = before.scriptPos!.coins;
  return cur.script.coins.slice(from, cur.scriptPos!.coins).map((heads, k) => ({ index: from + k, heads }));
}

/** The flip at `index` (flipsOf) was `heads` in the real game: the transcript is played again from that action on. */
export function setFlip(t: Transcript, index: number, heads: boolean): Transcript {
  const cur = current(t);
  const coins = cur.script!.coins.map((h, k) => (k === index ? heads : h));
  // The last recorded position before that flip with nothing pending: the action that flipped starts there.
  let i = t.states.length - 1;
  while (i > 0 && (t.states[i]!.scriptPos!.coins > index || t.states[i]!.pending)) i--;
  return rerun(t, i, { ...cur.script!, coins });
}

/** The transcript played again from position i with `script` (everything recorded so far, some of it changed). */
function rerun(t: Transcript, i: number, script: DealScript): Transcript {
  const at = t.states[i]!;
  // The first position is the setup's first choice: setup is applied again to the game before it, with the script.
  const start = at.pending ? apply({ ...at.pending.base, script }, at.pending.action, { trusted: true }) : { ...at, script };
  const states = [...t.states.slice(0, i), start];
  for (let j = i; j < t.actions.length; j++) states.push(apply(states[states.length - 1]!, t.actions[j]!));
  return { ...t, states };
}

/** The transcript as a saved game (the review page's format), its deal in `script`. */
export function toSaved(t: Transcript): SavedGame {
  const cur = current(t);
  const sc = cur.script!;
  return {
    savedAt: Date.now(),
    seed: t.seed,
    opponent: t.plans[1],
    opponentName: t.names[1],
    mine: t.plans[0],
    mineName: t.names[0],
    mode: 'real',
    rules: { version: cur.rules.version },
    policy: DEFAULT_POLICY,
    decks: t.decks,
    actions: t.actions,
    winner: cur.winner,
    reason: cur.winReason,
    turns: cur.turn,
    script: { orders: sc.orders, coins: sc.coins, known: sc.known, ...(sc.mulligans ? { mulligans: sc.mulligans } : {}) },
    pro: t.pro,
  };
}

const zonesOf = (s: GameState) => s.players.map((ps) => [ps.deck, ps.hand, ps.prizes, ps.discard, ps.active?.stack ?? [], ps.bench.map((b) => b.stack)]);

/** What differs between the saved game replayed from its file and the transcript: nothing when it is sound. */
export function verify(t: Transcript): string[] {
  const states = replay(JSON.parse(JSON.stringify(toSaved(t))) as SavedGame);
  const out: string[] = [];
  if (states.length !== t.states.length) out.push(tx(`เล่นซ้ำได้ ${states.length} ตำแหน่ง แต่ที่ถอดมี ${t.states.length}`, `the replay has ${states.length} positions, the transcript ${t.states.length}`));
  const n = Math.min(states.length, t.states.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(zonesOf(states[i]!)) !== JSON.stringify(zonesOf(t.states[i]!))) {
      out.push(tx(`ตำแหน่งที่ ${i} ไม่ตรง`, `position ${i} differs`));
      break;
    }
  }
  return out;
}

/** The transcript as a games file (what the review page imports; scripts/pro reads it). */
export const exportText = (t: Transcript): string => JSON.stringify(gamesFile([toSaved(t)]));
