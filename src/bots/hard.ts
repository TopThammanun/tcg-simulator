// "ยาก": Monte Carlo at key decisions (PLAN.md v3). The normal bot proposes a few candidates; each is
// played forward on several determinized states (unknown cards re-dealt) with normal bots on both sides
// until the end of the opponent's next turn, and the candidate with the best average outcome is taken.
// The search is shared: "ยาก" scores the end position with evaluate() below, "โปร" (pro.ts) with the
// value network trained from self-play.
import { actor, apply, legalActions } from '../engine/actions';
import { def, isTrainerType } from '../engine/db';
import { hpLeft, maxHp } from '../engine/rules';
import { keyOf, opp, slotsOf, topDef } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { determinize } from '../engine/view';
import { choosePicks } from './choose';
import { decide, finishStep, makeBot, rankDevelopment, type Scored } from './core';
import { planFinish, runStep } from './finisher';
import { makeRand } from './random';
import type { Bot, DeckPlan } from './types';

const MAX_ROLLOUT_ACTIONS = 160;

export interface SearchOptions {
  seed?: number;
  /** Value of a position from `me`'s side, higher is better. */
  value: (s: GameState, me: PlayerId) => number;
  /** Score for a line that broke while being played out (below any real position). */
  failValue: number;
  /** Determinized deals per candidate. */
  samples?: number;
  /** How many of the best development moves to try besides the normal choice and the attack plan. */
  breadth?: number;
  /**
   * Where a line is scored: after the opponent's reply (start of my next turn, default) or as soon as
   * my turn ends (needs a value that foresees the reply, like the network).
   */
  horizon?: 'reply' | 'turn';
  /** Extra deals for the two best candidates after the first round (0 = one round only). */
  refine?: number;
  /** Stop adding deals after this many ms (at least two deals each), so slow devices don't wait long. */
  deadlineMs?: number;
}

/** Static evaluation from `me`'s side: prizes, board health, resources. */
export function evaluate(s: GameState, me: PlayerId): number {
  if (s.winner === me) return 1e5;
  if (s.winner === opp(me)) return -1e5;
  const side = (p: PlayerId) => {
    const ps = s.players[p];
    let v = (6 - ps.prizes.length) * 100;
    for (const sl of slotsOf(ps)) {
      const d = topDef(s, sl);
      // A damaged Pokémon is a Prize the other side is closer to taking.
      v -= (sl.damage / maxHp(s, sl)) * 40 * d.prizes;
      v += sl.energy.length * 6 + (sl.stack.length - 1) * 12 + (hpLeft(s, sl) > 0 ? 4 : 0);
    }
    v += Math.min(ps.hand.length, 10) * 3;
    if (ps.deck.length < 6) v -= (6 - ps.deck.length) * 15;
    return v;
  };
  return side(me) - side(opp(me));
}

/** Is this a decision worth simulating (Supporter, gust, attack, Stadium)? */
function isKey(s: GameState, a: Action): boolean {
  if (a.t === 'attack' || a.t === 'retreat' || a.t === 'end') return true;
  if (a.t === 'trainer') {
    const k = keyOf(s, a.card);
    return isTrainerType(k, 'Supporter') || isTrainerType(k, 'Stadium') || def(k).name === 'Ultra Ball';
  }
  return false;
}

export function makeHardBot(plan: DeckPlan, oppPlan: DeckPlan, opts: { seed?: number } = {}): Bot {
  return makeSearchBot(plan, oppPlan, { seed: opts.seed, value: evaluate, failValue: -1e4 });
}

export function makeSearchBot(plan: DeckPlan, oppPlan: DeckPlan, opts: SearchOptions): Bot {
  const samples = opts.samples ?? 4;
  const breadth = opts.breadth ?? 2;
  const normal = makeBot(plan, { seed: opts.seed });
  const rand = makeRand((opts.seed ?? 1) ^ 0x68e31da4);
  let queue: number[][] = [];

  return {
    act(s: GameState): Action {
      if (s.pending) {
        const forced = queue.shift();
        const req = s.pending.request;
        if (forced && forced.every((v) => req.options.some((o) => o.value === v)) && forced.length >= req.min && forced.length <= req.max) {
          return { t: 'choose', picks: forced };
        }
        queue = [];
        return normal.act(s);
      }
      const me = actor(s);
      const first = decide(s, me, plan, rand);
      if (!isKey(s, first.action)) {
        queue = first.picks?.slice() ?? [];
        return first.action;
      }
      // Candidates: the normal choice, the planner's line, the best development moves, and ending the turn.
      const fin = planFinish(s, me, plan, Math.floor(rand() * 2 ** 31));
      const cands = [first, finishStep(s, fin), ...rankDevelopment(s, me, plan).slice(0, breadth), { action: { t: 'end' } as Action, score: 0, reason: '' }];
      const seen = new Set<string>();
      const unique = cands.filter((c) => {
        const k = JSON.stringify('card' in c.action ? { ...c.action, card: keyOf(s, c.action.card) } : c.action);
        if (seen.has(k)) return false;
        seen.add(k);
        return legalActions(s).some((x) => JSON.stringify('card' in x ? { ...x, card: keyOf(s, x.card) } : x) === k);
      });
      if (unique.length <= 1) {
        queue = first.picks?.slice() ?? [];
        return first.action;
      }
      // Every candidate on the same deals; then, with `refine`, more deals for the two best only
      // (the close calls are where more samples change the answer).
      const deals = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 2 ** 31));
      const score = (c: Scored, seeds: number[]) => seeds.reduce((t, seed) => t + rollout(s, me, c.action, c.picks, seed, plan, oppPlan, opts), 0);
      const rated = unique.map((c) => ({ c, total: 0, n: 0 }));
      const started = performance.now();
      for (const seed of deals(samples)) {
        for (const r of rated) {
          r.total += score(r.c, [seed]);
          r.n++;
        }
        if (opts.deadlineMs && rated[0]!.n >= 2 && performance.now() - started > opts.deadlineMs) break;
      }
      rated.sort((a, b) => b.total - a.total);
      const refine = opts.refine ?? 0;
      if (refine > 0 && rated.length > 1) {
        const more = deals(refine);
        for (const r of rated.slice(0, 2)) {
          r.total += score(r.c, more);
          r.n += refine;
        }
        rated.sort((a, b) => b.total / b.n - a.total / a.n);
      }
      const best = rated[0]!.c;
      queue = best.picks?.slice() ?? [];
      return best.action;
    },
  };
}

function rollout(
  s: GameState,
  me: PlayerId,
  action: Action,
  picks: number[][] | undefined,
  seed: number,
  plan: DeckPlan,
  oppPlan: DeckPlan,
  opts: SearchOptions,
): number {
  const mineBot = makeBot(plan, { seed: seed + 1 });
  const theirBot = makeBot(oppPlan, { seed: seed + 2 });
  let st: GameState;
  try {
    st = runStep(determinize(s, me, seed), { action, picks }, plan);
    // Finish this turn and the opponent's next one; stop when it is our turn again (or, with the
    // 'turn' horizon, when the opponent's turn starts).
    let n = 0;
    while (st.winner === null && n++ < MAX_ROLLOUT_ACTIONS) {
      if (!st.pending && st.current === me && st.turn > s.turn) break;
      if (opts.horizon === 'turn' && !st.pending && st.current !== me) break;
      const p = actor(st);
      const a: Action = st.pending
        ? { t: 'choose', picks: choosePicks(st, st.pending.request, p === me ? plan : oppPlan) }
        : (p === me ? mineBot : theirBot).act(st);
      st = apply(st, a, { trusted: true });
    }
  } catch {
    return opts.failValue;
  }
  return opts.value(st, me);
}
