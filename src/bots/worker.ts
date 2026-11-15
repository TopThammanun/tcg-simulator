// Web Worker: the play screen's bot thinks here, so a long search ("ยาก", "โปร") never freezes the page.
import { createBot } from './index';
import { planFor, type PlayerPolicy } from './plans';
import type { Bot, Level } from './types';
import type { Action, GameState } from '../engine/types';

export interface BotSetup {
  slug: string;
  oppSlug: string;
  level: Level;
  seed: number;
  /** The player's strategy (the bot uses it to model your deck). */
  policy: PlayerPolicy;
}
export type ToBot = { type: 'init'; setup: BotSetup } | { type: 'act'; id: number; state: GameState };
export type FromBot = { type: 'action'; id: number; action: Action } | { type: 'error'; id: number; message: string };

let bot: Bot | null = null;

self.onmessage = (e: MessageEvent<ToBot>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const { slug, oppSlug, level, seed, policy } = msg.setup;
    bot = createBot(planFor(slug), level, seed, planFor(oppSlug, policy));
    return;
  }
  try {
    if (!bot) throw new Error('bot not set up');
    (self as unknown as Worker).postMessage({ type: 'action', id: msg.id, action: bot.act(msg.state) } satisfies FromBot);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: msg.id, message: String((err as Error).message ?? err) } satisfies FromBot);
  }
};
