import { getCollection } from 'astro:content';
import type { CardDef, CardPrint } from '../data/cards';
import { parseDecklist, type DeckEntry, type DeckSection } from '../data/decklist';
import { lookup } from '../data/manifest';

export interface DeckLine {
  entry: DeckEntry;
  print: CardPrint;
  card: CardDef;
}

export const SECTION_LABEL: Record<DeckSection, string> = {
  pokemon: 'Pokémon',
  trainer: 'Trainer',
  energy: 'Energy',
};

// Player deck first, then bots by meta rank (Festival Lead variants share rank 6).
export async function loadDecks() {
  const entries = await getCollection('decks');
  return entries
    .map((e) => {
      const list = parseDecklist(e.body ?? '');
      const lines: DeckLine[] = list.entries.map((entry) => ({ entry, ...lookup(entry) }));
      return { slug: e.id, meta: e.data, lines };
    })
    .sort((a, b) => {
      if (a.meta.side !== b.meta.side) return a.meta.side === 'player' ? -1 : 1;
      return (a.meta.rank ?? 0) - (b.meta.rank ?? 0) || a.slug.localeCompare(b.slug);
    });
}

export type DeckView = Awaited<ReturnType<typeof loadDecks>>[number];

export function sectionCount(deck: DeckView, section: DeckSection): number {
  return deck.lines.filter((l) => l.entry.section === section).reduce((n, l) => n + l.entry.count, 0);
}
