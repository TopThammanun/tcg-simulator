// Run batches of your deck (with a strategy) vs a bot deck. Shared by the Node CLI and Web Workers.
// Your side plays the chosen strategy (the rule-based bot with your policy); the bot side is the one
// bot without look-ahead (createBot fast), so thousands of games stay quick. Bot seeds are derived from
// the game seed exactly as the play page's watch mode does, so any game can be replayed from its seed.
import { makeBot } from '../bots/core';
import { createBot } from '../bots/index';
import { planFor } from '../bots/plans';
import type { DeckSpec, Rules } from '../engine/types';
import { applyEdit, type PlayerConfig } from './experiments';
import { playGame } from './game';
import { seedsFor } from './seeds';
import type { GameRecord } from './stats';

export interface BatchJob {
  config: PlayerConfig;
  playerCards: string[];
  opp: { slug: string; cards: string[] };
  seeds: number[];
  rules?: Partial<Rules>;
  checkInvariants?: boolean;
}

export const PLAYER_BOT_SALT = 0x1b873593;
export const OPP_BOT_SALT = 0x2545f491;

export function runBatch(job: BatchJob, onGame?: (g: GameRecord) => void): GameRecord[] {
  const me: DeckSpec = { name: 'คุณ', cards: applyEdit(job.playerCards, job.config.edit) };
  const them: DeckSpec = { name: 'บอท', cards: job.opp.cards };
  const out: GameRecord[] = [];
  for (const seed of job.seeds) {
    const r = playGame({
      seed,
      decks: [me, them],
      bots: [
        makeBot(planFor('player', job.config.policy), { seed: seed ^ PLAYER_BOT_SALT }),
        createBot(planFor(job.opp.slug), seed ^ OPP_BOT_SALT, planFor('player', job.config.policy), { fast: true }),
      ],
      rules: job.rules,
      checkInvariants: job.checkInvariants,
    });
    const { final: _f, history: _h, thinkMsByTurn: _t, ...stats } = r;
    const rec: GameRecord = { ...stats, seed, opp: job.opp.slug };
    out.push(rec);
    onGame?.(rec);
  }
  return out;
}

export { seedsFor };
