// Run batches of your deck (with a strategy) vs a bot deck. Shared by the Node CLI and Web Workers.
// Bot seeds are derived from the game seed exactly as the play page's watch mode does, so any game
// can be replayed in the browser from its seed.
import { makeBot } from '../bots/core';
import { planFor } from '../bots/plans';
import type { Level } from '../bots/types';
import type { DeckSpec, Rules } from '../engine/types';
import { applyEdit, type PlayerConfig } from './experiments';
import { playGame } from './game';
import type { GameRecord } from './stats';

export interface BatchJob {
  config: PlayerConfig;
  playerCards: string[];
  opp: { slug: string; cards: string[] };
  seeds: number[];
  level?: Level;
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
        makeBot(planFor('player', job.config.policy), { level: 'normal', seed: seed ^ PLAYER_BOT_SALT }),
        makeBot(planFor(job.opp.slug), { level: job.level ?? 'normal', seed: seed ^ OPP_BOT_SALT }),
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

/** Seeds shared by both sides of an experiment (paired comparison). */
export function seedsFor(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (base + i * 7919) | 0);
}
