// Web Worker for "ภัยเทิร์นหน้า": samples the opponent's next turn a batch at a time and posts the report
// after each batch, so the numbers appear quickly and firm up. A newer position replaces the one being
// sampled (the page asks again after every move).
import { planFor, type PlayerPolicy } from '../bots/plans';
import type { GameState, PlayerId } from '../engine/types';
import { ThreatSampler, type ThreatReport } from './threat';

export interface ThreatAsk {
  id: number;
  state: GameState;
  me: PlayerId;
  /** Deck slugs (src/content/decks) for your side and theirs. */
  mine: string;
  theirs: string;
  policy: PlayerPolicy;
  samples: number;
  seed: number;
}
export type ToThreat = { type: 'ask'; ask: ThreatAsk } | { type: 'stop' };
export type FromThreat =
  | { type: 'report'; id: number; report: ThreatReport; done: boolean }
  | { type: 'error'; id: number; message: string };

/** The first report goes out after this many samples, then one after every batch. */
const FIRST = 8;
const BATCH = 8;

let latest: ThreatAsk | null = null;
let running = false;
const post = (m: FromThreat) => (self as unknown as Worker).postMessage(m);
const yieldToMessages = () => new Promise<void>((r) => setTimeout(r, 0));

self.onmessage = (e: MessageEvent<ToThreat>) => {
  latest = e.data.type === 'ask' ? e.data.ask : null;
  if (!running) void loop();
};

async function loop() {
  running = true;
  while (latest) {
    const ask = latest;
    try {
      const plans = { mine: planFor(ask.mine, ask.policy), theirs: planFor(ask.theirs) };
      const sampler = new ThreatSampler({ state: ask.state, me: ask.me, plans, theirDeck: ask.theirs }, ask.seed);
      while (sampler.samples.length < ask.samples && latest === ask) {
        const have = sampler.samples.length;
        sampler.add(Math.min(ask.samples, have < FIRST ? FIRST : have + BATCH) - have);
        const done = sampler.samples.length >= ask.samples;
        post({ type: 'report', id: ask.id, report: sampler.report(), done });
        if (!done) await yieldToMessages();
      }
    } catch (err) {
      post({ type: 'error', id: ask.id, message: String((err as Error).message ?? err) });
    }
    if (latest === ask) latest = null;
    await yieldToMessages();
  }
  running = false;
}
