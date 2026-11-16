// Chance to win from a position, as `me` sees it: re-deal what `me` can't see (determinize), play the rest
// of the game with the rule-based bot (core.ts, quick) on both sides, count the wins (a draw is half).
// The review page's win%.
import { actor, apply } from '../engine/actions';
import type { GameState, PlayerId } from '../engine/types';
import { determinize } from '../engine/view';
import { makeBot } from '../bots/core';
import type { Plans } from './threat';

const MAX_ACTIONS = 3000;

/** One played-out game: 1 = `me` won, 0 = lost, ½ = draw or too long. */
export function rollout(s: GameState, me: PlayerId, plans: Plans, seed: number): number {
  let st = determinize(s, me, seed);
  const bots = me === 0 ? [makeBot(plans.mine, { seed: seed + 1 }), makeBot(plans.theirs, { seed: seed + 2 })] : [makeBot(plans.theirs, { seed: seed + 2 }), makeBot(plans.mine, { seed: seed + 1 })];
  for (let n = 0; st.winner === null && n < MAX_ACTIONS; n++) st = apply(st, bots[actor(st)]!.act(st), { trusted: true });
  return st.winner === me ? 1 : st.winner === null || st.winner === 'draw' ? 0.5 : 0;
}

export interface WinEstimate {
  /** Share of the played-out games won. */
  p: number;
  /** Its standard error. */
  se: number;
  /** Each game's result, by seed (to compare two positions on the same deals). */
  results: number[];
}

/** Seed of the i-th game out of `seed`: the same deals for every position estimated with the same seed. */
export const rolloutSeed = (seed: number, i: number) => (Math.imul(seed ^ 0x51ed270b, 0x2c1b3c6d) + i * 0x165667b1) >>> 0;

/** `samples` played-out games, from the `offset`-th deal of `seed` on (to add games to an earlier estimate). */
export function estimateWin(s: GameState, me: PlayerId, plans: Plans, opts: { samples?: number; seed?: number; offset?: number } = {}): WinEstimate {
  const n = opts.samples ?? 32;
  const from = opts.offset ?? 0;
  const results = Array.from({ length: n }, (_, i) => rollout(s, me, plans, rolloutSeed(opts.seed ?? 1, from + i)));
  return summarize(results);
}

/** Two estimates of the same position as one (results in deal order). */
export const merge = (a: WinEstimate, b: WinEstimate) => summarize([...a.results, ...b.results]);

export function summarize(results: number[]): WinEstimate {
  const n = results.length;
  const p = results.reduce((t, x) => t + x, 0) / Math.max(1, n);
  const v = results.reduce((t, x) => t + (x - p) ** 2, 0) / Math.max(1, n - 1);
  return { p, se: Math.sqrt(v / Math.max(1, n)), results };
}

/** Mean and standard error of b − a over the same deals (paired). */
export function pairedDiff(a: WinEstimate, b: WinEstimate): { diff: number; se: number } {
  const d = b.results.map((x, i) => x - (a.results[i] ?? 0));
  const s = summarize(d);
  return { diff: s.p, se: s.se };
}
