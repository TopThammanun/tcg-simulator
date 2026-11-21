// The play screen's side of src/analysis/worker.ts: ask for the threat report of a position and get it
// back a batch at a time. Only the newest position matters; reports for older ones are dropped.
// Without Worker support the samples run in the page, in small batches between frames (threat.ts and the
// bot's network are then loaded on first use, so they stay out of the page bundle otherwise).
import { lang } from '../i18n';
import { planFor } from '../bots/plans';
import type { ThreatReport } from './threat';
import type { FromThreat, ThreatAsk, ToThreat } from './worker';

export interface ThreatClient {
  /** Analyse a position; `onreport` gets each update for it (`done` on the last). */
  ask(ask: Omit<ThreatAsk, 'id'>): void;
  stop(): void;
  dispose(): void;
}

export function threatClient(onreport: (r: ThreatReport, done: boolean, state: ThreatAsk['state']) => void, onerror?: (message: string) => void): ThreatClient {
  let next = 0;
  let current: ThreatAsk | null = null;

  if (typeof Worker === 'undefined') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      ask(a) {
        clearTimeout(timer);
        const ask = (current = { ...a, id: next++ });
        const plans = { mine: planFor(ask.mine, ask.policy), theirs: planFor(ask.theirs) };
        const made = import('./threat').then(({ ThreatSampler }) => new ThreatSampler({ state: ask.state, me: ask.me, plans, theirDeck: ask.theirs }, ask.seed));
        const batch = async () => {
          const sampler = await made;
          if (current !== ask) return;
          sampler.add(Math.min(4, ask.samples - sampler.samples.length));
          const done = sampler.samples.length >= ask.samples;
          onreport(sampler.report(), done, ask.state);
          if (!done) timer = setTimeout(batch, 16);
        };
        timer = setTimeout(batch, 0);
      },
      stop() {
        clearTimeout(timer);
        current = null;
      },
      dispose() {
        this.stop();
      },
    };
  }

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: lang() });
  worker.onmessage = (e: MessageEvent<FromThreat>) => {
    const m = e.data;
    if (!current || m.id !== current.id) return;
    if (m.type === 'report') onreport(m.report, m.done, current.state);
    else onerror?.(m.message);
  };
  return {
    ask(a) {
      current = { ...a, id: next++ };
      // Game states are plain data (the play screen keeps them in $state.raw), so they post as they are.
      worker.postMessage({ type: 'ask', ask: current } satisfies ToThreat);
    },
    stop() {
      current = null;
      worker.postMessage({ type: 'stop' } satisfies ToThreat);
    },
    dispose() {
      current = null;
      worker.terminate();
    },
  };
}
