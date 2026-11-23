// Card pictures fetched before they are needed, so on a slow connection a deck's cards are there by the time
// they are drawn. A few at a time at low priority, so the pictures already on screen still come first; the
// latest batch asked for goes to the front (the decks picked last, then the game's).
import { def, imageFor } from '../engine/db';
import { CARD_BACK } from './card-back';

const PARALLEL = 4;
/** Pictures this page has loaded: shown at once, without the text frame first (CardFace.svelte). */
const loaded = new Set<string>();
/** Pictures being fetched or fetched (loaded or failed). */
const started = new Set<string>();
let queue: string[] = [];
let running = 0;

export const isLoaded = (url: string | undefined): boolean => !!url && loaded.has(url);

export function markLoaded(url: string): void {
  loaded.add(url);
}

function next(): void {
  while (running < PARALLEL && queue.length) {
    const url = queue.shift()!;
    started.add(url);
    running++;
    const img = new Image();
    img.fetchPriority = 'low';
    const done = () => {
      running--;
      next();
    };
    img.onload = () => {
      loaded.add(url);
      done();
    };
    img.onerror = done;
    img.src = url;
  }
}

/** Fetch these pictures in the background, in this order, ahead of any still waiting. */
export function preload(urls: Iterable<string | undefined>): void {
  const batch = [...new Set(urls)].filter((u): u is string => !!u && !started.has(u));
  if (!batch.length) return;
  const first = new Set(batch);
  queue = [...batch, ...queue.filter((u) => !first.has(u))];
  next();
}

/**
 * The card back, then the small picture of each card in these lists (card keys), the first list first, then the large
 * picture of their Trainers: a played Trainer is shown large in the middle of the table (anim/fx.ts).
 */
export function preloadDecks(...decks: string[][]): void {
  const keys = decks.flat();
  preload([CARD_BACK, ...keys.map((k) => imageFor(k).low), ...keys.filter((k) => def(k).category === 'trainer').map((k) => imageFor(k).high)]);
}
