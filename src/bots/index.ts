// The one bot. There are no difficulty levels: everywhere that needs "the bot" gets the strongest version
// measured so far (BOT-RESEARCH.md). With a trained network bundled (learn/weights.json) that is the
// policy/value network with look-ahead (learn/search.ts); without one, the hard bot (Monte Carlo over
// the rule-based bot). `fast` is the same network without look-ahead, for thousands of games
// (the simulator and its replays). A deck with a specialist (learn/specialists/<deck>.json: the network trained
// further playing only that deck, kept only if it beat the general one there) plays with it.
import { makeHardBot } from './hard';
import { loadModel, type Model, type ModelJson } from './learn/model';
import { makeNetBot } from './learn/netbot';
import { makeSearchNetBot, type NetSearchOptions } from './learn/search';
import weights from './learn/weights.json';
import dragapult from './learn/specialists/dragapult-ex.json';
import slowking from './learn/specialists/slowking.json';
import type { Bot, DeckPlan } from './types';

const load = (j: object): Model | null => ('tensors' in j ? loadModel(j as unknown as ModelJson) : null);

/** The bundled network, if one has been trained and has beaten the bot before it. */
export const MODEL: Model | null = load(weights);

/** Specialists by deck plan name (DeckPlan.name). */
const SPECIALISTS: Record<string, Model | null> = {
  'Dragapult ex': load(dragapult),
  'Slowking Seek Inspiration': load(slowking),
};

/** The network the bot plays `plan` with: its specialist if there is one, else the general network. */
export function modelFor(plan: DeckPlan): Model | null {
  return SPECIALISTS[plan.name] ?? MODEL;
}

/** Look-ahead settings of the strongest bot (measured with scripts/learn/gen.ts). */
export const SEARCH: Omit<NetSearchOptions, 'decks' | 'seed'> = { width: 4, samples: 6, horizon: 'reply', deadlineMs: 2500 };

export function createBot(plan: DeckPlan, seed: number, opponentPlan: DeckPlan, o: { fast?: boolean } = {}): Bot {
  const model = modelFor(plan);
  if (!model) return makeHardBot(plan, opponentPlan, { seed });
  const decks = [plan.name, opponentPlan.name] as const;
  return o.fast ? makeNetBot(model, { decks, seed }) : makeSearchNetBot(model, { decks, seed, plan, ...SEARCH });
}
