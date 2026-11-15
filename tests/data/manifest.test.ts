import { describe, expect, it } from 'vitest';
import { loadDeckFiles } from '../../scripts/lib/decks';
import type { CardDef, CardManifest } from '../../src/data/cards';
import { printKey } from '../../src/data/decklist';
import manifestJson from '../../data/cards.manifest.json';

// Phase 0 gate, checked against the generated data (re-run `npm run cards` after editing decks).
const manifest = manifestJson as CardManifest;
const decks = loadDeckFiles('src/content/decks');
const cardOf = (name: string): CardDef => {
  const card = Object.values(manifest.cards).find((c) => c.name === name);
  if (!card) throw new Error(`${name} not in manifest`);
  return card;
};

describe('card manifest', () => {
  it.each(decks.map((d) => [d.slug, d] as const))('covers every print in %s', (_slug, deck) => {
    const missing = deck.list.entries.filter((e) => !manifest.prints[printKey(e)]).map(printKey);
    expect(missing).toEqual([]);
  });

  it('has playable text for every card', () => {
    const noText = Object.values(manifest.cards).filter((c) => {
      if (c.category === 'pokemon') return !(c.hp > 0 && c.attacks.length + c.abilities.length > 0);
      if (c.category === 'energy' && c.energyType === 'Basic') return !c.provides;
      return !c.effect;
    });
    expect(noText.map((c) => c.key)).toEqual([]);
  });

  it('gives every print both image sizes, or marks it for the text frame', () => {
    const broken = Object.values(manifest.prints).filter((p) =>
      p.image.source === 'none' ? p.image.high || p.image.low : !(p.image.high && p.image.low),
    );
    expect(broken.map((p) => p.key)).toEqual([]);
  });

  it('shows Basic Energy with the standard Scarlet & Violet Energy art when a print has no image', () => {
    const energyPrints = Object.values(manifest.prints).filter((p) => {
      const c = manifest.cards[p.card]!;
      return c.category === 'energy' && c.energyType === 'Basic';
    });
    for (const p of energyPrints.filter((p) => p.image.source !== 'tcgdex')) {
      expect(p.image.altOf, p.key).toMatch(/^sve-[1-8]$/);
    }
  });

  it('merges prints of the same card under one key', () => {
    expect(cardOf('Psychic Energy').prints).toEqual(expect.arrayContaining(['MEE-5', 'MEE-13']));
    expect(cardOf("Boss's Orders").prints).toEqual(expect.arrayContaining(['ASC-183', 'MEG-114']));
  });
});

describe('rules data the engine depends on', () => {
  it('gives Mega Pokémon ex 3 prizes and Pokémon ex 2', () => {
    expect(cardOf('Mega Kangaskhan ex')).toMatchObject({ prizes: 3 });
    expect(cardOf('Raging Bolt ex')).toMatchObject({ prizes: 2 });
    expect(cardOf('Chien-Pao')).toMatchObject({ prizes: 1 });
  });

  it('marks Tera Pokémon (Area Zero Underdepths needs this)', () => {
    expect(cardOf('Teal Mask Ogerpon ex')).toMatchObject({ tera: true });
    expect(cardOf('Mega Kangaskhan ex')).toMatchObject({ tera: false });
  });

  it('marks ACE SPEC cards', () => {
    expect(cardOf("Hero's Cape")).toMatchObject({ aceSpec: true });
    expect(cardOf('Ultra Ball')).toMatchObject({ aceSpec: false });
  });

  it('keeps Telepathic Psychic Energy as Special Energy', () => {
    expect(cardOf('Telepathic Psychic Energy')).toMatchObject({ category: 'energy', energyType: 'Special' });
  });
});
