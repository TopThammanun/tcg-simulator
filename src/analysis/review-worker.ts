// Web Worker for the review page: reviews one of your turns at a time (review.ts). The page runs a few of
// these and hands each the next turn as soon as it is free (review-remote.ts).
import { asLang, setLang } from '../i18n';
import { planFor } from '../bots/plans';
import type { GameState } from '../engine/types';
import { replay, type SavedGame, type TurnSpan } from '../review/record';
import { reviewTurn, type ReviewOptions, type TurnReview } from './review';

// The page's language, passed as the worker's name (remote.ts): its text (logs, the review's words) follows it.
setLang(asLang((self as unknown as { name?: string }).name));

export type ToReview = { type: 'turn'; job: number; game: SavedGame; span: TurnSpan; opts: ReviewOptions };
export type FromReview = { type: 'turn'; job: number; review: TurnReview } | { type: 'error'; job: number; message: string };

// The game replayed once per worker (every turn of it needs the same states).
let cached: { key: string; states: GameState[] } | null = null;

self.onmessage = (e: MessageEvent<ToReview>) => {
  const { job, game, span, opts } = e.data;
  try {
    const key = `${game.id}:${game.seed}:${game.actions.length}`;
    if (cached?.key !== key) cached = { key, states: replay(game) };
    const plans = { mine: planFor(game.mine ?? 'player', game.policy), theirs: planFor(game.opponent) };
    const review = reviewTurn(cached.states, game.actions, span, plans, opts);
    (self as unknown as Worker).postMessage({ type: 'turn', job, review } satisfies FromReview);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', job, message: String((err as Error).message ?? err) } satisfies FromReview);
  }
};
