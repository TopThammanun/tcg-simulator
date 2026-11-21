// Your own decklists, kept in this browser only (localStorage). Each is checked again when it is used
// (checkList), so a list that stops validating is shown as such instead of breaking the game.
import { tx } from '../i18n';
import { checkList } from './decklist';

export interface MyDeck {
  id: string;
  name: string;
  /** The list as pasted (Limitless export format). */
  text: string;
  updated: number;
}

const KEY = 'tcg-sim:my-decks';
/** The single edited list of earlier versions; moved into the deck list on first load. */
const OLD_KEY = 'tcg-sim:my-list';

function read(): MyDeck[] {
  try {
    const old = localStorage.getItem(OLD_KEY);
    const decks = JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyDeck[];
    if (old !== null) {
      decks.push({ id: newId(), name: tx('list ที่แก้ไว้', 'Edited list'), text: old, updated: Date.now() });
      write(decks);
      localStorage.removeItem(OLD_KEY);
    }
    return Array.isArray(decks) ? decks : [];
  } catch {
    return []; // storage blocked or broken: no saved decks
  }
}

function write(decks: MyDeck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch {
    /* storage unavailable: the change lasts for this page view only */
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function loadMyDecks(): MyDeck[] {
  return read().sort((a, b) => b.updated - a.updated);
}

/** Add a deck (no id) or replace the one with that id; returns it. */
export function saveMyDeck(d: { id?: string; name: string; text: string }): MyDeck {
  const decks = read();
  const deck: MyDeck = { id: d.id ?? newId(), name: d.name.trim() || tx('เด็คไม่มีชื่อ', 'Untitled deck'), text: d.text, updated: Date.now() };
  const i = decks.findIndex((x) => x.id === deck.id);
  if (i >= 0) decks[i] = deck;
  else decks.push(deck);
  write(decks);
  return deck;
}

export function deleteMyDeck(id: string): void {
  write(read().filter((d) => d.id !== id));
}

/** The deck's 60 card keys, or null when the list no longer validates. */
export function myDeckCards(d: MyDeck): string[] | null {
  return checkList(d.text).cards ?? null;
}
