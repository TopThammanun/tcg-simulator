// A bot that plays uniformly random legal moves. Used for fuzz tests and as the base of "easy".
import { apply, legalActions } from '../engine/actions';
import { next } from '../engine/rng';
import type { Action, ChoiceRequest, GameState } from '../engine/types';

export type Rand = () => number;

export function makeRand(seed: number): Rand {
  let st = seed | 0;
  return () => {
    const [r, ns] = next(st);
    st = ns;
    return r;
  };
}

export const pickOne = <T>(xs: readonly T[], rand: Rand): T => xs[Math.floor(rand() * xs.length)]!;

/** Random valid answer to a choice. */
export function randomPicks(req: ChoiceRequest, rand: Rand): number[] {
  const values = req.options.map((o) => o.value);
  const max = req.repeat ? req.max : Math.min(req.max, values.length);
  const n = req.min + Math.floor(rand() * (max - req.min + 1));
  if (req.repeat) return Array.from({ length: n }, () => pickOne(values, rand));
  const pool = values.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return out;
}

/** Random legal action; ends the turn less often so games reach attacks and Knock Outs. */
export function randomAction(s: GameState, rand: Rand): Action {
  if (s.pending) return { t: 'choose', picks: randomPicks(s.pending.request, rand) };
  const legal = legalActions(s);
  const attacks = legal.filter((a) => a.t === 'attack');
  if (attacks.length > 0 && rand() < 0.35) return pickOne(attacks, rand);
  const others = legal.filter((a) => a.t !== 'end' && a.t !== 'attack');
  if (others.length > 0 && rand() < 0.85) return pickOne(others, rand);
  return pickOne(legal, rand);
}

export function randomStep(s: GameState, rand: Rand): GameState {
  return apply(s, randomAction(s, rand));
}
