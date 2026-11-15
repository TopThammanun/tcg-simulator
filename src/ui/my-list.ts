// Your edited decklist, kept in this browser only (play and simulator pages both use it).
import { checkList } from './decklist';

const KEY = 'tcg-sim:my-list';

export function savedListText(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveListText(text: string | null): void {
  try {
    if (text === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, text);
  } catch {
    /* storage unavailable: the list applies to this page view only */
  }
}

/** Card keys of your saved list, or `fallback` when there is none (or it no longer validates). */
export function myCards(fallback: string[]): { cards: string[]; custom: boolean } {
  const text = savedListText();
  if (!text) return { cards: fallback, custom: false };
  const r = checkList(text);
  return r.cards ? { cards: r.cards, custom: true } : { cards: fallback, custom: false };
}
