// The play screen's side of src/bots/worker.ts: ask the bot for its move without blocking the page.
// Without Worker support it runs the bot in the page instead.
import { lang } from '../i18n';
import { planFor } from './plans';
import type { Action, GameState } from '../engine/types';
import type { BotSetup, FromBot, ToBot } from './worker';

export interface RemoteBot {
  act(s: GameState): Promise<Action>;
  dispose(): void;
}

export function remoteBot(setup: BotSetup): RemoteBot {
  if (typeof Worker === 'undefined') {
    // Loaded only here, so the network's weights stay out of the page bundle.
    const made = import('./index').then(({ createBot }) => createBot(planFor(setup.slug), setup.seed, planFor(setup.oppSlug, setup.policy), { fast: setup.fast }));
    return { act: async (s) => (await made).act(s), dispose() {} };
  }
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: lang() });
  worker.postMessage({ type: 'init', setup } satisfies ToBot);
  let next = 0;
  const waiting = new Map<number, { resolve: (a: Action) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<FromBot>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.type === 'action') w.resolve(e.data.action);
    else w.reject(new Error(e.data.message));
  };
  return {
    act(s) {
      const id = next++;
      return new Promise<Action>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        // Game states are plain data (the play screen keeps them in $state.raw), so they post as they are.
        worker.postMessage({ type: 'act', id, state: s } satisfies ToBot);
      });
    },
    dispose() {
      worker.terminate();
      for (const w of waiting.values()) w.reject(new Error('bot stopped'));
      waiting.clear();
    },
  };
}
