import { makeBot } from './core';
import { makeHardBot } from './hard';
import { makeProBot } from './pro';
import type { DeckPlan, Bot, Level } from './types';

/**
 * A bot at a difficulty: easy (40% random moves), normal (priorities + attack planner), hard (+ Monte
 * Carlo), pro (a wider, deeper version of that search; see pro.ts).
 */
export function createBot(plan: DeckPlan, level: Level, seed: number, opponentPlan: DeckPlan): Bot {
  if (level === 'pro') return makeProBot(plan, opponentPlan, { seed });
  return level === 'hard' ? makeHardBot(plan, opponentPlan, { seed }) : makeBot(plan, { level, seed });
}
