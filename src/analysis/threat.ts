// "ภัยเทิร์นหน้า": what the opponent can do on their next turn if you end yours now. Each sample re-deals
// every card you can't see (determinize: their hand, both decks, both prize piles, coin flips), ends your
// turn, and lets a normal bot play their turn with that hand. Counting over the samples gives the chance
// each of your Pokémon is Knocked Out, the Prizes they take, and how (the cards and attack they used).
// Dealt uniformly, their hand holds more cards they could use than real hands do, so the counted chances
// run high; calibration.ts corrects them per opponent deck from what happened in bot games.
// Only public information goes in, so two positions that differ only in hidden cards give the same report.
import { actor, apply } from '../engine/actions';
import { def, isTrainerType } from '../engine/db';
import { keyOf, opp, slotsOf, topDef, topKey } from '../engine/state';
import type { Action, GameState, PlayerId, SlotId } from '../engine/types';
import { determinize } from '../engine/view';
import { choosePicks } from '../bots/choose';
import { makeBot } from '../bots/core';
import type { Step } from '../bots/finisher';
import type { DeckPlan } from '../bots/types';
import { calibration } from './calibration';

const MAX_ACTIONS = 200;
/** Items and Abilities that set up a Knock Out (moving the attacker in, moving damage, evolving); draw and search are left out. */
const LINE_ITEMS = new Set(['switch', 'energy-switch', 'rare-candy', 'brave-bangle']);
const LINE_ABILITIES = new Set(['Adrena-Brain', 'Plasma Bane', 'Rapid Vernier', 'Subjugating Chains']);

export interface Plans {
  /** Your deck (answers your choices during their turn, e.g. the new Active). */
  mine: DeckPlan;
  theirs: DeckPlan;
}

/** One re-dealt version of the opponent's next turn. */
export interface TurnSample {
  /** Your Pokémon Knocked Out (slot ids from the position analysed). */
  ko: SlotId[];
  /** Damage your surviving Pokémon took, by slot. */
  damage: Record<SlotId, number>;
  /** Prizes the opponent took. */
  prizes: number;
  /** The opponent won during this turn. */
  win: boolean;
  /** The cards and attack that did it, e.g. "Boss's Orders → Phantom Dive" (empty when nothing was Knocked Out). */
  line: string;
}

export interface KoLine {
  label: string;
  /** Samples that Knocked this Pokémon Out this way. */
  n: number;
}

export interface SlotThreat {
  uid: SlotId;
  key: string;
  name: string;
  /** Prizes it gives up when Knocked Out. */
  prizes: number;
  active: boolean;
  /** Samples it was Knocked Out in. */
  ko: number;
  /** Chance it is Knocked Out (the share of samples, corrected by calibration.ts when the deck has a correction). */
  chance: number;
  /** Samples it took damage and survived, and the total of that damage. */
  hit: number;
  damage: number;
  /** How it was Knocked Out, most common first. */
  lines: KoLine[];
}

export interface ThreatReport {
  samples: number;
  /** Your Pokémon, Active first. */
  slots: SlotThreat[];
  /** prizes[n] = samples where the opponent took n Prizes. */
  prizes: number[];
  /** Samples where the opponent won on that turn. */
  win: number;
  /** Prizes the opponent still needs. */
  prizesLeft: number;
  /** Prizes the opponent is expected to take: Σ chance × Prizes, at most what they still need. */
  expected: number;
  /** Chance they win on that turn (corrected like the Knock Outs). */
  winChance: number;
  /** The chances are corrected (calibration.ts). */
  calibrated: boolean;
}

/** Can the threat be read in this position (your main phase, nothing pending, game on)? */
export function canAnalyse(s: GameState, me: PlayerId): boolean {
  return s.winner === null && !s.pending && s.phase === 'main' && s.current === me;
}

/** Re-deals the cards `me` can't see (determinize by default). */
export type Deal = (s: GameState, me: PlayerId, seed: number) => GameState;

/**
 * Play one version of the opponent's next turn. `ending` is the action that ends your turn (default:
 * ending it without attacking); its choices are answered by `ending.picks`, then your deck plan.
 */
export function sampleNextTurn(
  s: GameState,
  me: PlayerId,
  plans: Plans,
  seed: number,
  ending: Step = { action: { t: 'end' } },
  deal: Deal = determinize,
): TurnSample {
  const o = opp(me);
  const bot = makeBot(plans.theirs, { level: 'normal', seed: seed ^ 0x5bd1e995 });
  const ko: SlotId[] = [];
  const trail: string[] = [];
  const forced = (ending.picks ?? []).slice();
  let settled = deal(s, me, seed);
  let st = apply(settled, ending.action, { trusted: true });
  let n = 0;
  while (st.winner === null && n++ < MAX_ACTIONS) {
    if (!st.pending) {
      collectKOs(settled, st, me, ko);
      settled = st;
      if (st.current === me) break;
    }
    let a: Action;
    if (actor(st) === me) {
      // Your choices: the ending action's own picks first, then your deck plan.
      const req = st.pending!.request;
      const f = forced.shift();
      const ok = f && f.every((v) => req.options.some((o) => o.value === v)) && f.length >= req.min && f.length <= req.max;
      a = { t: 'choose', picks: ok ? f! : choosePicks(st, req, plans.mine) };
    } else {
      a = bot.act(st);
      const label = lineLabel(st, a);
      if (label && !trail.includes(label)) trail.push(label);
    }
    st = apply(st, a, { trusted: true });
  }
  if (!st.pending) collectKOs(settled, st, me, ko);
  const damage: Record<SlotId, number> = {};
  const now = new Map(slotsOf(st.players[me]).map((sl) => [sl.uid, sl]));
  for (const sl of slotsOf(s.players[me])) {
    const later = now.get(sl.uid);
    if (later && later.damage > sl.damage) damage[sl.uid] = later.damage - sl.damage;
  }
  return {
    ko,
    damage,
    prizes: s.players[o].prizes.length - st.players[o].prizes.length,
    win: st.winner === o,
    line: ko.length ? trail.join(' → ') : '',
  };
}

/** Your Pokémon that left play between two settled states while the opponent took Prizes. */
export function collectKOs(before: GameState, after: GameState, me: PlayerId, out: SlotId[]): void {
  const o = opp(me);
  if (after.players[o].prizes.length >= before.players[o].prizes.length) return;
  const still = new Set(slotsOf(after.players[me]).map((sl) => sl.uid));
  for (const sl of slotsOf(before.players[me])) if (!still.has(sl.uid) && !out.includes(sl.uid)) out.push(sl.uid);
}

/** The part of a Knock Out line an action contributes: Supporters, Stadiums, set-up Items and Abilities, the attack. */
export function lineLabel(s: GameState, a: Action): string {
  if (a.t === 'attack') return a.name;
  if (a.t === 'ability') return LINE_ABILITIES.has(a.name) ? a.name : '';
  if (a.t === 'trainer' || a.t === 'tool') {
    const k = keyOf(s, a.card);
    return isTrainerType(k, 'Supporter') || isTrainerType(k, 'Stadium') || LINE_ITEMS.has(k) ? def(k).name : '';
  }
  return '';
}

/** Count over the samples; `correct` maps a share of samples to a real chance (calibration.ts). */
export function summarizeThreat(s: GameState, me: PlayerId, samples: TurnSample[], correct?: ((p: number) => number) | null): ThreatReport {
  const ps = s.players[me];
  const n = samples.length;
  const fix = (k: number) => (n ? (correct ? correct(k / n) : k / n) : 0);
  const slots: SlotThreat[] = slotsOf(ps).map((sl) => {
    const lines = new Map<string, number>();
    let ko = 0;
    let hit = 0;
    let damage = 0;
    for (const x of samples) {
      if (x.ko.includes(sl.uid)) {
        ko++;
        lines.set(x.line, (lines.get(x.line) ?? 0) + 1);
      } else if (x.damage[sl.uid]) {
        hit++;
        damage += x.damage[sl.uid]!;
      }
    }
    return {
      uid: sl.uid,
      key: topKey(s, sl),
      name: topDef(s, sl).name,
      prizes: topDef(s, sl).prizes,
      active: sl.uid === ps.active?.uid,
      ko,
      chance: ko ? fix(ko) : 0,
      hit,
      damage,
      lines: [...lines.entries()].map(([label, k]) => ({ label, n: k })).sort((a, b) => b.n - a.n),
    };
  });
  const prizes = Array.from({ length: 7 }, () => 0);
  for (const x of samples) prizes[Math.min(6, Math.max(0, x.prizes))]!++;
  const prizesLeft = s.players[opp(me)].prizes.length;
  const win = samples.filter((x) => x.win).length;
  return {
    samples: n,
    slots,
    prizes,
    win,
    prizesLeft,
    expected: Math.min(prizesLeft, slots.reduce((t, x) => t + x.chance * x.prizes, 0)),
    winChance: win ? fix(win) : 0,
    calibrated: !!correct,
  };
}

export interface ThreatInput {
  state: GameState;
  me: PlayerId;
  plans: Plans;
  /** The opponent's deck slug, for its correction (calibration.ts); without it the chances are the raw shares. */
  theirDeck?: string;
  /** The action that ends your turn (default: ending it without attacking). */
  ending?: Step;
  /** Re-deals the hidden cards instead of determinize (diagnostics). */
  deal?: Deal;
}

/** Samples a position's next opponent turn, a few at a time (the play screen reports after each batch). */
export class ThreatSampler {
  readonly samples: TurnSample[] = [];
  private readonly correct: ((p: number) => number) | null;

  constructor(
    private readonly input: ThreatInput,
    private readonly seed: number,
  ) {
    this.correct = input.deal ? null : calibration(input.theirDeck);
  }

  /** Add `n` samples. */
  add(n: number): this {
    const { state, me, plans, ending, deal } = this.input;
    for (let k = 0; k < n; k++) this.samples.push(sampleNextTurn(state, me, plans, sampleSeed(this.seed, this.samples.length), ending, deal));
    return this;
  }

  report(): ThreatReport {
    return summarizeThreat(this.input.state, this.input.me, this.samples, this.correct);
  }
}

export interface ThreatOptions {
  samples?: number;
  seed?: number;
  theirDeck?: string;
  ending?: Step;
  deal?: Deal;
}

/** The whole report in one go (tests, scripts). The play screen samples in a worker, a batch at a time. */
export function threats(s: GameState, me: PlayerId, plans: Plans, opts: ThreatOptions = {}): ThreatReport {
  return new ThreatSampler({ state: s, me, plans, theirDeck: opts.theirDeck, ending: opts.ending, deal: opts.deal }, opts.seed ?? 1)
    .add(opts.samples ?? 32)
    .report();
}

/** Seed of the i-th sample: the same deals for every position analysed with the same base seed. */
export const sampleSeed = (seed: number, i: number) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + i * 0x27d4eb2f) >>> 0;
