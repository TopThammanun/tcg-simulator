// Web Worker: runs one batch of games and reports progress (PLAN.md: กระจายเกมไป Web Worker หลายตัว).
import { runBatch, type BatchJob } from './runner';
import type { GameRecord } from './stats';

export type ToWorker = { type: 'run'; id: number; job: BatchJob };
export type FromWorker =
  | { type: 'progress'; id: number; done: number }
  | { type: 'done'; id: number; games: GameRecord[] }
  | { type: 'error'; id: number; message: string };

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const { id, job } = e.data;
  let done = 0;
  try {
    const games = runBatch(job, () => {
      done++;
      if (done % 5 === 0) (self as unknown as Worker).postMessage({ type: 'progress', id, done } satisfies FromWorker);
    });
    (self as unknown as Worker).postMessage({ type: 'done', id, games } satisfies FromWorker);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id, message: String((err as Error).message ?? err) } satisfies FromWorker);
  }
};
