// Chance to win from a position, as `me` sees it: re-deal what `me` can't see (determinize), then either
// play the rest of the game with the rule-based bot (core.ts, quick) on both sides and count the wins
// (a draw is half), or ask the bot's network (netWin, the review page's win%).
import { actor, apply } from '../engine/actions';
import type { GameState, PlayerId } from '../engine/types';
import { determinize } from '../engine/view';
import { makeBot } from '../bots/core';
import { encode } from '../bots/learn/encode';
import { run, type Model } from '../bots/learn/model';
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

/**
 * Chance to win as the bot's network judges it (its value head, learn/model.ts): the position re-dealt
 * `deals` times from what `me` could see, each judged by whoever acts next. One forward pass per deal, so a
 * whole game's review takes moments, and the same deals (`seed`) give the same answer. `decks` are the plan
 * names [mine, theirs] the network is told. `theirs` judges the deals where the other side acts (its deck's
 * expert: an expert has only learned the positions of its own deck); `model` by default.
 */
export function netWin(s: GameState, me: PlayerId, model: Model, decks: readonly [string, string], opts: { deals?: number; seed?: number } = {}, theirs: Model = model): WinEstimate {
  if (s.winner !== null) return summarize([s.winner === me ? 1 : s.winner === 'draw' ? 0.5 : 0]);
  const n = s.pending ? 1 : (opts.deals ?? 16);
  const results = Array.from({ length: n }, (_, i) => {
    const d = s.pending ? s : determinize(s, me, rolloutSeed(opts.seed ?? 1, i));
    const who = actor(d);
    const v = run(who === me ? model : theirs, encode(d, { decks: who === me ? decks : [decks[1], decks[0]] }), false).value;
    return who === me ? v : 1 - v;
  });
  return summarize(results);
}
