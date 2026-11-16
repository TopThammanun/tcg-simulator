// The review page's side of review-worker.ts: every turn of a game reviewed on a few workers at once,
// each turn reported as soon as it is done. Without Worker support the turns run in the page, one per frame.
import { planFor } from '../bots/plans';
import { replay, type SavedGame, type TurnSpan } from '../review/record';
import { reviewTurn, type ReviewOptions, type TurnReview } from './review';
import type { FromReview, ToReview } from './review-worker';

export interface ReviewRun {
  cancel(): void;
}

export function reviewGame(
  game: SavedGame,
  spans: TurnSpan[],
  opts: ReviewOptions,
  onturn: (r: TurnReview) => void,
  ondone: (errors: string[]) => void,
): ReviewRun {
  const queue = spans.slice();
  const errors: string[] = [];
  let left = spans.length;
  let stopped = false;
  let cleanup = () => {};
  const finish = () => {
    if (--left > 0 || stopped) return;
    cleanup();
    ondone(errors);
  };
  if (!left) {
    queueMicrotask(() => ondone(errors));
    return { cancel() {} };
  }

  if (typeof Worker === 'undefined') {
    const states = replay(game);
    const plans = { mine: planFor('player', game.policy), theirs: planFor(game.opponent) };
    const step = () => {
      const span = queue.shift();
      if (!span || stopped) return;
      try {
        onturn(reviewTurn(states, game.actions, span, plans, { ...opts, theirDeck: game.opponent }));
      } catch (e) {
        errors.push((e as Error).message);
      }
      finish();
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
    return { cancel: () => void (stopped = true) };
  }

  const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, spans.length));
  const workers = Array.from({ length: count }, () => new Worker(new URL('./review-worker.ts', import.meta.url), { type: 'module' }));
  cleanup = () => workers.forEach((w) => w.terminate());
  let job = 0;
  const give = (w: Worker) => {
    const span = queue.shift();
    if (span) w.postMessage({ type: 'turn', job: job++, game, span, opts } satisfies ToReview);
  };
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<FromReview>) => {
      if (stopped) return;
      if (e.data.type === 'turn') onturn(e.data.review);
      else errors.push(e.data.message);
      finish();
      give(w);
    };
    give(w);
  }
  return {
    cancel() {
      stopped = true;
      cleanup();
    },
  };
}
