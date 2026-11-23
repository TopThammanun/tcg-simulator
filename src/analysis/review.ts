// Game review: each of your turns gets
// - your win% before and after it: the bot's networks judge the position (winrate.ts netWin; each side's positions
//   by the network its deck plays with, `Nets`), averaged over re-deals of what you couldn't see, so the opponent's
//   side is judged by the network it plays with, it takes moments, and gives the same answer every time (the
//   rule-based bots' played-out games when no network is bundled),
// - a check for clear mistakes: at the moment you chose how to end the turn (and at its start), the attack
//   planner finds a line that wins or takes more Prizes than you took, on every re-deal of what you couldn't
//   see ("พลาดชัด": engine-checked with fixed seeds, so it doesn't depend on luck or on how well bots play),
// - the bot's turn from the same start, played on the real cards, judged on the same re-deals; where it
//   parts from yours, and why (explain.ts). "น่าจะดีกว่า" when it gains at least BETTER_BY.
import { actor, apply } from '../engine/actions';
import { keyOf } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { choosePicks } from '../bots/choose';
import { explainAction, explainEnd } from '../bots/explain';
import { sureLine as sureLineFor, type Step } from '../bots/finisher';
import { createBot, MODEL } from '../bots/index';
import type { Model } from '../bots/learn/model';
import { describeAction } from '../ui/play';
import { isFree, type TurnSpan } from '../review/record';
import type { Plans } from './threat';
import { estimateWin, netWin, type WinEstimate } from './winrate';

export type Verdict = 'missed-win' | 'missed-ko' | 'better' | 'ok';

export interface Missed {
  kind: 'win' | 'ko';
  /** State index where the line was there. */
  at: number;
  /** Prizes the line takes on every re-deal, and what you took from that point. */
  prizes: number;
  took: number;
  /** The line, as button labels. */
  line: string[];
}

export interface TurnReview {
  turn: number;
  span: TurnSpan;
  /** Your actions this turn (labels), in order. */
  played: string[];
  /** Win% when the turn began, and after it. */
  before: number;
  win: { p: number; se: number };
  /** The bot's turn from the same start, when it played differently. */
  alt?: {
    played: string[];
    /** Every action of its turn from the start state (the opponent's answers too), to replay it on the board. */
    actions: Action[];
    win: { p: number; se: number };
    /** Its win% minus yours, on the same re-deals. */
    diff: number;
    /** The first of its actions that isn't yours (an index into `played` of both). */
    split: number;
    /** Why the bot plays that one (explain.ts). */
    why: string;
  };
  missed?: Missed;
  verdict: Verdict;
}

export interface ReviewOptions {
  /** Re-deals each win% averages over (16 by default; played-out games when no network is bundled). */
  deals?: number;
  /** Re-deals a missed line must work on. */
  checks?: number;
  seed?: number;
}

/**
 * The networks the bot plays each side's deck with (bots/experts.ts expertFor: the deck's expert, also for a list of
 * your own, by its plan); the bundled network for a side without one.
 */
export interface Nets {
  mine?: Model | null;
  theirs?: Model | null;
}

/** Smallest win% gain of the bot's turn over yours for "น่าจะดีกว่า". */
export const BETTER_BY = 0.1;
/** The bot's seed for the suggested turn (plus the turn number). */
const ALT_SEED = 7331;

/**
 * Win% of `me` in `s`, from what `me` could see: the chance if both sides play on like the bot, each side's
 * positions judged by the network that plays its deck.
 */
export function winOf(s: GameState, me: PlayerId, plans: Plans, opts: { deals?: number; seed?: number }, nets: Nets = {}): WinEstimate {
  const mine = nets.mine ?? MODEL;
  if (mine) return netWin(s, me, mine, [plans.mine.name, plans.theirs.name], opts, nets.theirs ?? MODEL ?? mine);
  return estimateWin(s, me, plans, { samples: 3 * (opts.deals ?? 16), seed: opts.seed });
}

/** `me`'s own actions (not answers to choices) between two state indices: their labels and where they were played. */
function moves(states: GameState[], actions: Action[], from: number, to: number, me: PlayerId): { label: string; at: number }[] {
  const out: { label: string; at: number }[] = [];
  for (let i = from; i < to; i++) if (actor(states[i]!) === me && actions[i]!.t !== 'choose') out.push({ label: describeAction(states[i]!, actions[i]!), at: i });
  return out;
}

/** The attack planner's surest line (finisher.ts sureLine), for your deck. */
export function sureLine(s: GameState, me: PlayerId, plans: Plans, checks: number): { prizes: number; wins: boolean; steps: Step[] } {
  return sureLineFor(s, me, plans.mine, checks);
}

/**
 * The bot (bots/index.ts, your deck's network without look-ahead so a whole game's review stays quick) plays
 * `me`'s turn from `s` on the real cards (the opponent answers its own choices); the state once the turn has passed.
 */
export function botTurn(s: GameState, me: PlayerId, plans: Plans, seed: number, nets: Nets = {}): { end: GameState; states: GameState[]; actions: Action[] } {
  const bot = createBot(plans.mine, seed, plans.theirs, { fast: true, model: nets.mine });
  const states = [s];
  const actions: Action[] = [];
  let st = s;
  for (let n = 0; n < 300 && st.winner === null; n++) {
    if (!st.pending && st.current !== me) break;
    const a: Action = actor(st) === me ? bot.act(st) : { t: 'choose', picks: choosePicks(st, st.pending!.request, plans.theirs) };
    actions.push(a);
    st = apply(st, a, { trusted: true });
    states.push(st);
  }
  return { end: st, states, actions };
}

/** The same moves (card names, not copies), ignoring answers to choices. */
function sameMoves(sa: GameState[], aa: Action[], sb: GameState[], ab: Action[], me: PlayerId): boolean {
  const key = (states: GameState[], actions: Action[]) =>
    actions
      .map((a, i) => (actor(states[i]!) === me && a.t !== 'choose' ? JSON.stringify('card' in a ? { ...a, card: keyOf(states[i]!, a.card) } : a) : ''))
      .filter(Boolean)
      .join('|');
  return key(sa, aa) === key(sb, ab);
}

export function reviewTurn(states: GameState[], actions: Action[], span: TurnSpan, plans: Plans, opts: ReviewOptions = {}, nets: Nets = {}): TurnReview {
  const me = actor(states[span.start]!);
  const checks = opts.checks ?? 4;
  const odds = { deals: opts.deals ?? 16, seed: (opts.seed ?? 1) * 1009 + span.turn };
  const start = states[span.start]!;
  const end = states[span.end]!;
  const mine = moves(states, actions, span.start, span.end, me);
  const played = mine.map((m) => m.label);

  // Clear mistakes: first at the moment you ended the turn, then at its start.
  let missed: Missed | undefined;
  const wonThisTurn = end.winner === me;
  for (const at of span.last === span.start ? [span.start] : [span.last, span.start]) {
    const s = states[at]!;
    if (!isFree(s, me)) continue;
    const took = s.players[me].prizes.length - end.players[me].prizes.length;
    const line = sureLine(s, me, plans, checks);
    const kind = line.wins && !wonThisTurn ? 'win' : !wonThisTurn && line.prizes > took && line.prizes > 0 ? 'ko' : null;
    if (kind) {
      missed = { kind, at, prizes: line.prizes, took, line: line.steps.map((st) => describeAction(s, st.action)) };
      break;
    }
  }

  const before = winOf(start, me, plans, odds, nets).p;
  const win = winOf(end, me, plans, odds, nets);

  // The bot's turn from the same start. Its seed is fixed, so a position always gets the same suggestion.
  let alt: TurnReview['alt'];
  const bot = botTurn(start, me, plans, ALT_SEED + span.turn, nets);
  if (!sameMoves(states.slice(span.start, span.end), actions.slice(span.start, span.end), bot.states, bot.actions, me)) {
    const theirs = winOf(bot.end, me, plans, odds, nets);
    const its = moves(bot.states, bot.actions, 0, bot.actions.length, me);
    let split = 0;
    while (split < its.length && split < mine.length && its[split]!.label === mine[split]!.label) split++;
    const at = its[split];
    const why = at
      ? bot.actions[at.at]!.t === 'end'
        ? explainEnd(bot.states[at.at]!, me).why
        : explainAction(bot.states[at.at]!, me, { action: bot.actions[at.at]! }, plans.mine).why
      : '';
    alt = { played: its.map((m) => m.label), actions: bot.actions, win: { p: theirs.p, se: theirs.se }, diff: theirs.p - win.p, split, why };
  }

  const verdict: Verdict = missed ? (missed.kind === 'win' ? 'missed-win' : 'missed-ko') : alt && alt.diff >= BETTER_BY ? 'better' : 'ok';
  return { turn: span.turn, span, played, before, win: { p: win.p, se: win.se }, alt, missed, verdict };
}
