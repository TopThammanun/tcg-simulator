// The one bot. There are no difficulty levels: everywhere that needs "the bot" gets the strongest version
// measured so far (BOT-RESEARCH.md). With a trained network bundled (learn/weights.json) that is the
// policy/value network with look-ahead (learn/search.ts); without one, the hard bot (Monte Carlo over
// the rule-based bot). `fast` is the same network without look-ahead, for thousands of games
// (the simulator and its replays). The network is version 2 (learn/model.ts): one network for every deck,
// reading cards by their printed features, so lists can change and new cards still mean something.
import { makeHardBot } from './hard';
import { loadModel, type Model, type ModelJson } from './learn/model';
import { makeNetBot } from './learn/netbot';
import { makeSearchNetBot, type NetSearchOptions } from './learn/search';
import weights from './learn/weights.json';
import type { Bot, DeckPlan } from './types';

const load = (j: object): Model | null => ('tensors' in j ? loadModel(j as unknown as ModelJson) : null);

/** The bundled network, if one has been trained and has beaten the bot before it. */
export const MODEL: Model | null = load(weights);

/**
 * Look-ahead settings of the strongest bot (measured with scripts/learn/gen.ts). `ties`: a random one of the moves
 * within 2% of the best, so a player who plays the same matchup again doesn't meet the same moves (BOT-NEXT.md N6:
 * 49.2% against always taking the best, 1,920 games).
 */
export const SEARCH: Omit<NetSearchOptions, 'decks' | 'seed'> = { width: 4, samples: 6, horizon: 'reply', deadlineMs: 2500, ties: 0.02 };

/**
 * A network's own look-ahead settings, from its file (`meta.search`, written by ml/experts.py ship --no-look-ahead):
 * an expert whose deck the look-ahead helps by under 3 points plays without it, at once (BOT-NEXT.md N5).
 */
function ownSearch(model: Model): Partial<typeof SEARCH> {
  const s = model.meta.search as { samples?: unknown } | undefined;
  return s?.samples === 0 ? { samples: 0 } : {};
}

/** `model`: the network this deck plays from (its expert, experts.ts); the bundled network by default. */
export function createBot(plan: DeckPlan, seed: number, opponentPlan: DeckPlan, o: { fast?: boolean; model?: Model | null } = {}): Bot {
  const model = o.model ?? MODEL;
  if (!model) return makeHardBot(plan, opponentPlan, { seed });
  const decks = [plan.name, opponentPlan.name] as const;
  return o.fast ? makeNetBot(model, { decks, seed }) : makeSearchNetBot(model, { decks, seed, plan, ...SEARCH, ...ownSearch(model) });
}
