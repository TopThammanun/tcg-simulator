// Web Worker: the play screen's bot thinks here, so its search never freezes the page.
import { asLang, setLang } from '../i18n';
import { createBot } from './index';
import { planFor, type PlayerPolicy } from './plans';
import type { Bot } from './types';
import type { Action, GameState } from '../engine/types';

// The page's language, passed as the worker's name (remote.ts): its text (logs, the review's words) follows it.
setLang(asLang((self as unknown as { name?: string }).name));

export interface BotSetup {
  slug: string;
  oppSlug: string;
  seed: number;
  /** The player's strategy (the bot uses it to model your deck). */
  policy: PlayerPolicy;
  /** The bot without look-ahead, as the simulator plays it (watching a simulator game). */
  fast?: boolean;
}
export type ToBot = { type: 'init'; setup: BotSetup } | { type: 'act'; id: number; state: GameState };
export type FromBot = { type: 'action'; id: number; action: Action } | { type: 'error'; id: number; message: string };

let bot: Bot | null = null;

self.onmessage = (e: MessageEvent<ToBot>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const { slug, oppSlug, seed, policy, fast } = msg.setup;
    bot = createBot(planFor(slug), seed, planFor(oppSlug, policy), { fast });
    return;
  }
  try {
    if (!bot) throw new Error('bot not set up');
    (self as unknown as Worker).postMessage({ type: 'action', id: msg.id, action: bot.act(msg.state) } satisfies FromBot);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: msg.id, message: String((err as Error).message ?? err) } satisfies FromBot);
  }
};
