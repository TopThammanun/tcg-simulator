// "โปร" (experimental, not offered on the play screen yet): the hard bot's search made wider and deeper
// (more candidates, twice the deals, capped at 2.5 s). Positions are scored with the hard bot's
// evaluate() unless a value network trained from self-play (scripts/train.ts, AlphaZero style) has
// beaten it in a gate match and been saved to learn/weights.json. So far neither the wider search nor
// a network has beaten the hard bot on fresh deals (data/training-log.md), so it isn't shown.
import { opp } from '../engine/state';
import type { GameState, PlayerId } from '../engine/types';
import { features } from './learn/features';
import { fromJson, predict, type Net, type NetJson } from './learn/net';
import weights from './learn/weights.json';
import { evaluate, makeSearchBot } from './hard';
import type { Bot, DeckPlan } from './types';

/** The network shipped with the site (src/bots/learn/weights.json), if one has been trained. */
export const BUNDLED_NET: Net | null = (weights as NetJson).sizes.length ? fromJson(weights as NetJson) : null;

/**
 * Chance that `me` wins from `s`, by the network (1 / 0 / ½ once the game is over). With `blend` > 0,
 * mixed with the hard bot's hand-made score squashed to 0–1.
 */
export function netValue(net: Net, decks: readonly [string, string], blend = 0) {
  return (s: GameState, me: PlayerId): number => {
    if (s.winner === me) return 1;
    if (s.winner === opp(me)) return 0;
    if (s.winner === 'draw') return 0.5;
    const v = predict(net, features(s, me, decks));
    return blend ? (1 - blend) * v + (blend * (Math.tanh(evaluate(s, me) / 300) + 1)) / 2 : v;
  };
}

export interface ProOptions {
  seed?: number;
  /** A network to use instead of the bundled one (training compares versions). */
  net?: Net | null;
  samples?: number;
  breadth?: number;
  /** Weight of the hand-made score mixed into the network's (0 = network only). */
  blend?: number;
  horizon?: 'reply' | 'turn';
}

export function makeProBot(plan: DeckPlan, oppPlan: DeckPlan, opts: ProOptions = {}): Bot {
  const net = opts.net === undefined ? BUNDLED_NET : opts.net;
  const search = { seed: opts.seed, samples: opts.samples ?? 8, breadth: opts.breadth ?? 3, horizon: opts.horizon, deadlineMs: 2500 };
  if (!net) return makeSearchBot(plan, oppPlan, { ...search, value: evaluate, failValue: -1e4 });
  return makeSearchBot(plan, oppPlan, { ...search, value: netValue(net, [plan.name, oppPlan.name], opts.blend ?? 0), failValue: -1 });
}
