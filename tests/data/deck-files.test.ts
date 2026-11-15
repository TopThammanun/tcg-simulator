import { describe, expect, it } from 'vitest';
import { loadDeckFiles } from '../../scripts/lib/decks';

const decks = loadDeckFiles('src/content/decks');

describe('deck files', () => {
  it('has the player deck and the 6 bot archetypes (Festival Lead in two variants)', () => {
    expect(decks.filter((d) => d.meta.side === 'player').map((d) => d.slug)).toEqual(['player']);
    const ranks = decks.filter((d) => d.meta.side === 'bot').map((d) => d.meta.rank);
    expect([...new Set(ranks)].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(decks.filter((d) => d.meta.rank === 6).every((d) => d.meta.optional)).toBe(true);
  });

  it.each(decks.map((d) => [d.slug, d] as const))('%s has 60 cards', (_slug, deck) => {
    expect(deck.list.total).toBe(60);
  });

  it('gives every bot deck a meta share and list source', () => {
    for (const d of decks.filter((d) => d.meta.side === 'bot')) {
      expect(d.meta.metaShare, d.slug).toBeGreaterThan(0);
      expect(d.meta.listUrl, d.slug).toMatch(/^https:\/\/limitlesstcg\.com\/decks\/list\/\d+$/);
    }
  });
});
