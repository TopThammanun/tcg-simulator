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

/** The decks anyone can play and play against: the meta decks the bots use (the player deck is the scripts' own list). */
export const metaDecks = (decks: DeckView[]) => decks.filter((d) => d.meta.side === 'bot');

/** The bots' archetypes by meta share; an archetype with several lists (Festival Lead) is one row. */
export function archetypes(decks: DeckView[]) {
  const rows = new Map<string, { name: string; metaShare: number; slugs: string[] }>();
  for (const d of metaDecks(decks)) {
    const id = d.meta.limitless ?? d.slug;
    const row = rows.get(id) ?? { name: d.meta.name.replace(/ \(.*\)$/, ''), metaShare: d.meta.metaShare ?? 0, slugs: [] };
    row.slugs.push(d.slug);
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.metaShare - a.metaShare);
}

export function sectionCount(deck: DeckView, section: DeckSection): number {
  return deck.lines.filter((l) => l.entry.section === section).reduce((n, l) => n + l.entry.count, 0);
}

/**
 * A deck's Pokémon lines with an image, its headline first: the one the deck is named after, then rule-box Pokémon
 * (by Prize cards given up), then the most copies.
 */
export function headlines(deck: DeckView): DeckLine[] {
  const score = (l: DeckLine) =>
    (deck.meta.name.includes(l.card.name.replace(/^Mega | ex$/g, '')) ? 1000 : 0) +
    (l.card.category === 'pokemon' ? l.card.prizes * 10 : 0) +
    l.entry.count;
  return deck.lines
    .filter((l) => l.entry.section === 'pokemon' && l.print.image.source !== 'none')
    .sort((a, b) => score(b) - score(a));
}

/** A Gym Leader: one of the bots' archetypes, by meta share, with its badge (GymBadge.svelte: shape by rank). */
export interface GymLeader {
  name: string;
  slugs: string[];
  metaShare: number;
  /** The badge's shape (its rank, 0 first) and colour (the headline Pokémon's type). */
  shape: number;
  type: string;
}

/** The Gym Leaders you train against: the meta decks' archetypes, most played first. */
export function gymLeaders(decks: DeckView[]): GymLeader[] {
  return archetypes(decks).map((a, i) => {
    const head = headlines(decks.find((d) => d.slug === a.slugs[0])!)[0]?.card;
    return { ...a, shape: i, type: head?.category === 'pokemon' ? (head.types[0] ?? 'Colorless') : 'Colorless' };
  });
}

/** The Gym Leader a deck belongs to. */
export const gymOf = (gyms: GymLeader[], slug: string): GymLeader | undefined => gyms.find((g) => g.slugs.includes(slug));
