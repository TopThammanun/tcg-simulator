// The one bot. There are no difficulty levels: everywhere that needs "the bot" gets the strongest version
// measured so far (BOT-RESEARCH.md). With a trained network bundled (learn/weights.json) that is the
// policy/value network with look-ahead (learn/search.ts); without one, the hard bot (Monte Carlo over
// the rule-based bot). `fast` is the same network without look-ahead, for thousands of games
// (the simulator and its replays).
import { makeHardBot } from './hard';
import { loadModel, type Model, type ModelJson } from './learn/model';
import { makeNetBot } from './learn/netbot';
import { makeSearchNetBot, type NetSearchOptions } from './learn/search';
import weights from './learn/weights.json';
import type { Bot, DeckPlan } from './types';

/** The bundled network, if one has been trained and has beaten the bot before it. */
export const MODEL: Model | null = 'tensors' in weights ? loadModel(weights as unknown as ModelJson) : null;

/** Look-ahead settings of the strongest bot (measured with scripts/learn/gen.ts). */
export const SEARCH: Omit<NetSearchOptions, 'decks' | 'seed'> = { width: 4, samples: 6, horizon: 'reply', deadlineMs: 2500 };

export function createBot(plan: DeckPlan, seed: number, opponentPlan: DeckPlan, o: { fast?: boolean } = {}): Bot {
  if (!MODEL) return makeHardBot(plan, opponentPlan, { seed });
  const decks = [plan.name, opponentPlan.name] as const;
  return o.fast ? makeNetBot(MODEL, { decks, seed }) : makeSearchNetBot(MODEL, { decks, seed, plan, ...SEARCH });
}
