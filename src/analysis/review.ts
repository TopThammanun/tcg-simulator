// Game review (PLAN.md phase 8): each of your turns gets
// - the win% after it (winrate.ts, from what you could see then),
// - a check for clear mistakes: at the moment you chose how to end the turn (and at its start), the attack
//   planner finds a line that wins or takes more Prizes than you took, on every re-deal of what you couldn't
//   see ("พลาดชัด": engine-checked with fixed seeds, so it doesn't depend on luck or on how well bots play),
// - the bot's turn (bots/index.ts) from the same position, played on the real cards, and both turns' outcomes
//   compared on the same deals ("น่าจะดีกว่า": an estimate, shown with its error; close calls get three
//   times the games before they are decided),
// - "ภัยเทิร์นหน้า" after your turn and after the bot's (threat.ts), so exposure shows in numbers.
import { actor, apply } from '../engine/actions';
import { keyOf } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { determinize } from '../engine/view';
import { choosePicks } from '../bots/choose';
import { planFinish, runStep, type Step } from '../bots/finisher';
import { createBot } from '../bots/index';
import { describeAction } from '../ui/play';
import { isFree, type TurnSpan } from '../review/record';
import { threats, type Plans } from './threat';
import { estimateWin, merge, pairedDiff } from './winrate';

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
  /** Win% after your turn. */
  win: { p: number; se: number };
  /** Prizes the opponent is expected to take next turn after your turn (threat.ts). */
  exposure: number;
  /** The bot's turn from the same start, when it played differently. */
  alt?: {
    played: string[];
    win: { p: number; se: number };
    exposure: number;
    /** Its win% minus yours, on the same deals, and the error of that difference. */
    diff: number;
    se: number;
  };
  missed?: Missed;
  verdict: Verdict;
}

export interface ReviewOptions {
  /** Played-out games per win% (each side of a comparison uses the same deals); 48 by default. */
  samples?: number;
  /** Re-deals a missed line must work on. */
  checks?: number;
  /** Threat samples. */
  threatSamples?: number;
  seed?: number;
  /** Opponent deck slug, for the threat correction. */
  theirDeck?: string;
}

/** Smallest win% gain, and how many standard errors, for "น่าจะดีกว่า". */
export const BETTER_BY = 0.08;
export const BETTER_SE = 2.5;
/** The attack planner searches with these seeds (several, as its search is cut short), the same for every review. */
const SEARCH_SEEDS = [1, 2, 3];
/** The bot's seed for the suggested turn (plus the turn number). */
const ALT_SEED = 7331;

/** Labels of `me`'s own actions (not answers to choices) between two state indices. */
function labels(states: GameState[], actions: Action[], from: number, to: number, me: PlayerId): string[] {
  const out: string[] = [];
  for (let i = from; i < to; i++) if (actor(states[i]!) === me && actions[i]!.t !== 'choose') out.push(describeAction(states[i]!, actions[i]!));
  return out;
}

/**
 * The attack planner's best line from `s` checked on `checks` re-deals of what `me` can't see: the Prizes
 * it takes on all of them (the least), and whether it wins on all of them. The search and the re-deals use
 * fixed seeds, so the same position always gets the same answer.
 */
export function sureLine(s: GameState, me: PlayerId, plans: Plans, checks: number): { prizes: number; wins: boolean; steps: Step[] } {
  let best: { prizes: number; wins: boolean; steps: Step[] } = { prizes: 0, wins: false, steps: [] };
  for (const seed of SEARCH_SEEDS) {
    const fin = planFinish(s, me, plans.mine, seed);
    if (!fin.steps.length) continue;
    let prizes = Infinity;
    let wins = true;
    try {
      for (let k = 0; k < checks; k++) {
        let st = determinize(s, me, 7919 * (k + 1));
        for (const step of fin.steps) {
          if (st.winner !== null || st.current !== me || st.pending) break;
          st = runStep(st, step, plans.mine);
        }
        prizes = Math.min(prizes, s.players[me].prizes.length - st.players[me].prizes.length);
        if (st.winner !== me) wins = false;
      }
    } catch {
      continue;
    }
    if (prizes === Infinity) continue;
    if (Number(wins) > Number(best.wins) || (wins === best.wins && prizes > best.prizes)) best = { prizes, wins, steps: fin.steps };
  }
  return best;
}

/**
 * The bot (bots/index.ts, without look-ahead so a whole game's review stays quick) plays `me`'s turn from `s`
 * on the real cards (the opponent answers its own choices); the state once the turn has passed.
 */
export function botTurn(s: GameState, me: PlayerId, plans: Plans, seed: number): { end: GameState; states: GameState[]; actions: Action[] } {
  const bot = createBot(plans.mine, seed, plans.theirs, { fast: true });
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

export function reviewTurn(states: GameState[], actions: Action[], span: TurnSpan, plans: Plans, opts: ReviewOptions = {}): TurnReview {
  const me = actor(states[span.start]!);
  const samples = opts.samples ?? 48;
  const checks = opts.checks ?? 4;
  const seed = (opts.seed ?? 1) * 1009 + span.turn;
  const start = states[span.start]!;
  const end = states[span.end]!;
  const played = labels(states, actions, span.start, span.end, me);

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

  // Prizes the opponent is expected to take next turn: from the last free position, ending the turn the way
  // it was ended (the attack and its choices), so the board the opponent faces is the one that was left.
  const exposureOf = (ss: GameState[], aa: Action[], last: number, to: number) => {
    const s = ss[last]!;
    if (!isFree(s, me) || !aa[last]) return 0;
    const picks = aa.slice(last + 1, to).flatMap((a, i) => (a.t === 'choose' && actor(ss[last + 1 + i]!) === me ? [a.picks] : []));
    const r = threats(s, me, plans, { samples: opts.threatSamples ?? 32, seed, theirDeck: opts.theirDeck, ending: { action: aa[last]!, picks } });
    return r.expected;
  };
  let mine = estimateWin(end, me, plans, { samples, seed });
  const exposure = end.winner === null ? exposureOf(states, actions, span.last, span.end) : 0;

  // The bot's turn from the same start. Its seed is fixed, so a position always gets the same suggestion.
  let alt: TurnReview['alt'];
  const bot = botTurn(start, me, plans, ALT_SEED + span.turn);
  if (!sameMoves(states.slice(span.start, span.end), actions.slice(span.start, span.end), bot.states, bot.actions, me)) {
    let theirs = estimateWin(bot.end, me, plans, { samples, seed });
    let { diff, se } = pairedDiff(mine, theirs);
    // Close to the line: twice as many more games on both sides before deciding.
    if (diff >= BETTER_BY / 2) {
      mine = merge(mine, estimateWin(end, me, plans, { samples: 2 * samples, seed, offset: samples }));
      theirs = merge(theirs, estimateWin(bot.end, me, plans, { samples: 2 * samples, seed, offset: samples }));
      ({ diff, se } = pairedDiff(mine, theirs));
    }
    // Its exposure, the same way: from the bot's last free position of the turn.
    let last = 0;
    bot.states.forEach((st, i) => {
      if (i < bot.actions.length && isFree(st, me) && st.turn === start.turn) last = i;
    });
    alt = {
      played: labels(bot.states, bot.actions, 0, bot.actions.length, me),
      win: { p: theirs.p, se: theirs.se },
      exposure: bot.end.winner === null ? exposureOf(bot.states, bot.actions, last, bot.actions.length) : 0,
      diff,
      se,
    };
  }

  const verdict: Verdict = missed
    ? missed.kind === 'win'
      ? 'missed-win'
      : 'missed-ko'
    : alt && alt.diff >= BETTER_BY && alt.diff > BETTER_SE * alt.se
      ? 'better'
      : 'ok';
  return { turn: span.turn, span, played, win: { p: mine.p, se: mine.se }, exposure, alt, missed, verdict };
}
