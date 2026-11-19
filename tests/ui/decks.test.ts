// The play setup's deck helpers: the deck art, the meta deck nearest to your own list, the random opponent.
import { describe, expect, it } from 'vitest';
import { loadDeckFiles } from '../../scripts/lib/decks';
import { deckKeys } from '../../src/engine/db';
import { headline, nearestDeck, pickOpponent } from '../../src/ui/decks';

const decks = loadDeckFiles('src/content/decks')
  .filter((d) => d.meta.side === 'bot')
  .map((d) => ({ slug: d.slug, name: d.meta.name, metaShare: d.meta.metaShare, archetype: d.meta.limitless ?? d.slug, cards: deckKeys(d.list.entries) }));
const bySlug = (s: string) => decks.find((d) => d.slug === s)!;

describe('deck helpers', () => {
  it('puts the Pokémon a deck is named after first', () => {
    expect(headline(bySlug('dragapult-ex').cards, 'Dragapult ex')[0]).toBe('dragapult-ex');
    expect(headline(bySlug('alakazam').cards, 'Alakazam Powerful Hand')[0]).toBe('alakazam');
  });

  it('plays your list with the plan of the meta deck it is closest to', () => {
    const player = loadDeckFiles('src/content/decks').find((d) => d.slug === 'player')!;
    expect(nearestDeck(deckKeys(player.list.entries), decks).slug).toBe('basic-box');
    const pult = bySlug('dragapult-ex').cards.slice(0, 50).concat(Array(10).fill('psychic-energy'));
    expect(nearestDeck(pult, decks).slug).toBe('dragapult-ex');
  });

  it('picks opponents by archetype share, one archetype with two lists counting once', () => {
    const n = 20000;
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const d = pickOpponent(decks, ((i * 7919) % n) / n, ((i * 104729) % 9973) / 9973);
      seen.set(d.archetype, (seen.get(d.archetype) ?? 0) + 1);
    }
    const shares = new Map(decks.map((d) => [d.archetype, d.metaShare ?? 0]));
    const total = [...shares.values()].reduce((a, b) => a + b, 0);
    for (const [arch, share] of shares) expect(Math.abs(seen.get(arch)! / n - share / total)).toBeLessThan(0.01);
    // Both Festival Lead lists come up.
    const lists = new Set<string>();
    for (let i = 0; i < 200; i++) lists.add(pickOpponent(decks.filter((d) => d.archetype === 'festival-lead'), 0.5, i / 200).slug);
    expect(lists.size).toBe(2);
  });
});
