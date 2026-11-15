import { makeBot } from './core';
import { makeHardBot } from './hard';
import type { DeckPlan, Bot, Level } from './types';

/** A bot at a difficulty: easy (40% random moves), normal (priorities + attack planner), hard (+ Monte Carlo). */
export function createBot(plan: DeckPlan, level: Level, seed: number, opponentPlan: DeckPlan): Bot {
  return level === 'hard' ? makeHardBot(plan, opponentPlan, { seed }) : makeBot(plan, { level, seed });
}
