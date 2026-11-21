// Saved games and their reviews, in this browser's IndexedDB. Without IndexedDB (private windows, blocked
// storage) everything is kept in memory for the page's life instead, and `persistent` says so.
import type { TurnReview } from '../analysis/review';
import type { SavedGame } from './record';

/** Bump when the review's analysis changes: older stored reviews are then redone. */
export const REVIEW_VERSION = 4;

export interface StoredReview {
  id: number;
  version: number;
  turns: TurnReview[];
}

const DB = 'tcg-sim';
const GAMES = 'games';
const REVIEWS = 'reviews';

let opening: Promise<IDBDatabase | null> | null = null;
const memory = { games: new Map<number, SavedGame>(), reviews: new Map<number, StoredReview>(), next: 1 };
export let persistent = true;

function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(GAMES, { keyPath: 'id', autoIncrement: true });
        req.result.createObjectStore(REVIEWS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((d) => {
    if (!d) persistent = false;
    return d;
  });
  return opening!;
}

function run<T>(d: IDBDatabase, store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = f(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Store a finished game; returns its id. */
export async function saveGame(g: SavedGame): Promise<number> {
  const d = await db();
  const { id: _, ...copy } = structuredClone(g);
  if (!d) {
    const id = memory.next++;
    memory.games.set(id, { ...copy, id });
    return id;
  }
  return Number(await run(d, GAMES, 'readwrite', (s) => s.add(copy)));
}

/** Every saved game, newest first. */
export async function listGames(): Promise<SavedGame[]> {
  const d = await db();
  const all = d ? await run<SavedGame[]>(d, GAMES, 'readonly', (s) => s.getAll()) : [...memory.games.values()];
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function getGame(id: number): Promise<SavedGame | undefined> {
  const d = await db();
  return d ? run<SavedGame | undefined>(d, GAMES, 'readonly', (s) => s.get(id)) : memory.games.get(id);
}

/** A deleted game and its stored review, to put back (the review page's "เลิกทำ"). */
export interface Deleted {
  game: SavedGame;
  review?: StoredReview;
}

/** Delete a game and its review; returns them, so the delete can be undone (restoreGame). */
export async function deleteGame(id: number): Promise<Deleted | undefined> {
  const d = await db();
  if (!d) {
    const game = memory.games.get(id);
    const review = memory.reviews.get(id);
    memory.games.delete(id);
    memory.reviews.delete(id);
    return game && { game, review };
  }
  const game = await run<SavedGame | undefined>(d, GAMES, 'readonly', (s) => s.get(id));
  const review = await run<StoredReview | undefined>(d, REVIEWS, 'readonly', (s) => s.get(id));
  await run(d, GAMES, 'readwrite', (s) => s.delete(id));
  await run(d, REVIEWS, 'readwrite', (s) => s.delete(id));
  return game && { game, review };
}

/** Put a deleted game back under its own id (links to it keep working), with its review. */
export async function restoreGame(x: Deleted): Promise<void> {
  const d = await db();
  if (!d) {
    memory.games.set(x.game.id!, x.game);
    if (x.review) memory.reviews.set(x.review.id, x.review);
    return;
  }
  await run(d, GAMES, 'readwrite', (s) => s.put(x.game));
  if (x.review) await run(d, REVIEWS, 'readwrite', (s) => s.put(x.review!));
}

/** The stored review of a game, if it was made by this version of the analysis. */
export async function getReview(id: number): Promise<StoredReview | undefined> {
  const d = await db();
  const r = d ? await run<StoredReview | undefined>(d, REVIEWS, 'readonly', (s) => s.get(id)) : memory.reviews.get(id);
  return r && r.version === REVIEW_VERSION ? r : undefined;
}

/** Every stored review made by this version of the analysis, by game id (the game list's badges). */
export async function listReviews(): Promise<Map<number, StoredReview>> {
  const d = await db();
  const all = d ? await run<StoredReview[]>(d, REVIEWS, 'readonly', (s) => s.getAll()) : [...memory.reviews.values()];
  return new Map(all.filter((r) => r.version === REVIEW_VERSION).map((r) => [r.id, r]));
}

export async function saveReview(id: number, turns: TurnReview[]): Promise<void> {
  const r: StoredReview = { id, version: REVIEW_VERSION, turns: structuredClone(turns) };
  const d = await db();
  if (!d) memory.reviews.set(id, r);
  else await run(d, REVIEWS, 'readwrite', (s) => s.put(r));
}
