import { describe, expect, it } from 'vitest';
import { formatDecklist } from '../../src/data/decklist';
import { setLang } from '../../src/i18n';
import {
  addCard,
  cardOf,
  countOf,
  deckKeys,
  fromText,
  hints,
  problems,
  removeCard,
  searchCards,
  sections,
  setCount,
  sortDeck,
  toText,
  total,
  type BuildLine,
} from '../../src/ui/builder';
import { checkList } from '../../src/ui/decklist';
import { loadDeckFiles } from '../../scripts/lib/decks';

const files = loadDeckFiles('src/content/decks');
const listOf = (slug: string) => formatDecklist(files.find((d) => d.slug === slug)!.list.entries);

describe('the deck builder: counts and limits', () => {
  it('adds and removes copies, and a card at 0 leaves the deck', () => {
    let deck: BuildLine[] = [];
    deck = addCard(deck, 'dreepy', 3).deck;
    expect(countOf(deck, 'dreepy')).toBe(3);
    deck = removeCard(deck, 'dreepy').deck;
    expect(countOf(deck, 'dreepy')).toBe(2);
    deck = setCount(deck, 'dreepy', 0).deck;
    expect(deck).toEqual([]);
  });

  it('refuses a fifth copy and a second ACE SPEC, and says why', () => {
    setLang('en');
    const four = addCard([], 'dreepy', 6);
    expect(countOf(four.deck, 'dreepy')).toBe(4);
    expect(four.refused).toMatch(/4 copies of Dreepy/);
    const ace = addCard(addCard([], 'heros-cape').deck, 'secret-box');
    expect(countOf(ace.deck, 'secret-box')).toBe(0);
    expect(ace.refused).toMatch(/ACE SPEC/);
    setLang('th');
    expect(addCard(four.deck, 'dreepy').refused).toMatch(/ไม่เกิน 4/);
  });

  it('lets Basic Energy go past 4', () => {
    expect(countOf(addCard([], 'psychic-energy', 12).deck, 'psychic-energy')).toBe(12);
  });

  it('reports what keeps a deck from being played until it holds', () => {
    setLang('en');
    expect(problems([])).toEqual(['60 more cards needed (a deck is exactly 60)', 'At least 1 Basic Pokémon is needed']);
    const full = fromText(listOf('dragapult-ex')).deck;
    expect(total(full)).toBe(60);
    expect(problems(full)).toEqual([]);
    expect(problems(addCard(full, 'psychic-energy').deck)[0]).toMatch(/1 cards too many/);
    setLang('th');
  });

  it('points out an Evolution with nothing to evolve from', () => {
    setLang('en');
    expect(hints(addCard([], 'drakloak').deck)).toEqual(['Drakloak evolves from Dreepy, which isn\'t in the deck']);
    expect(hints(addCard(addCard([], 'drakloak').deck, 'dreepy').deck)).toEqual([]);
    setLang('th');
  });
});

describe('the deck builder: order and text', () => {
  it('sorts like Limitless: Pokémon by line (Basic first), Supporters before Items, Special Energy before Basic', () => {
    const deck = fromText(listOf('dragapult-ex')).deck;
    const [pokemon, trainer, energy] = sections(deck);
    expect(pokemon!.label).toBe('Pokémon');
    const names = pokemon!.lines.map((l) => l.key);
    expect(names.indexOf('dreepy')).toBeLessThan(names.indexOf('drakloak'));
    expect(names.indexOf('drakloak')).toBeLessThan(names.indexOf('dragapult-ex'));
    const ORDER = ['Supporter', 'Item', 'Tool', 'Stadium'];
    const kinds = trainer!.lines.map((l) => ORDER.indexOf((cardOf(l.key) as { trainerType: string }).trainerType));
    expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
    expect(deckKeys(deck)).toHaveLength(60);
    expect(energy!.count).toBe(9);
    expect(sortDeck([...deck].reverse())).toEqual(sortDeck(deck));
  });

  it('turns every meta list into a deck and back into the same cards', () => {
    for (const d of files.filter((f) => f.meta.side === 'bot')) {
      const text = listOf(d.slug);
      const r = fromText(text);
      expect(r.unsupported, d.slug).toEqual([]);
      expect(r.refused, d.slug).toEqual([]);
      expect(total(r.deck), d.slug).toBe(60);
      const again = checkList(toText(r.deck));
      expect(again.errors, d.slug).toEqual([]);
      expect([...again.cards!].sort(), d.slug).toEqual([...checkList(text).cards!].sort());
    }
  });

  it('reads Pokémon TCG Live exports and names what it cannot use', () => {
    setLang('en');
    const r = fromText(
      ['Pokémon: 2', '2 Dreepy TWM 128', '', 'Trainer: 2', '1 Iono PAL 185', '1 Rare Candy', 'Energy: 5', '5 Basic {P} Energy SVE 5', 'Total Cards: 9', 'not a card'].join('\n'),
    );
    expect(countOf(r.deck, 'dreepy')).toBe(2);
    expect(countOf(r.deck, 'rare-candy')).toBe(1);
    expect(countOf(r.deck, 'psychic-energy')).toBe(5);
    expect(r.unsupported).toEqual(['Iono']);
    expect(r.unreadable).toEqual(['not a card']);
    setLang('th');
  });
});

describe('the deck builder: card search', () => {
  it('finds cards by name first, then by their text', () => {
    const r = searchCards('dragapult');
    expect(r[0]!.name).toMatch(/Dragapult/);
    expect(searchCards('phantom dive').map((c) => c.key)).toContain('dragapult-ex');
  });

  it('filters by the chips picked (any of them) and by Pokémon type', () => {
    const sup = searchCards('', ['Supporter']);
    expect(sup.length).toBeGreaterThan(3);
    expect(sup.every((c) => c.category === 'trainer' && c.trainerType === 'Supporter')).toBe(true);
    const both = searchCards('', ['Supporter', 'basic']);
    expect(both.some((c) => c.category === 'energy')).toBe(true);
    const psychic = searchCards('', ['pokemon'], ['Psychic']);
    expect(psychic.every((c) => c.category === 'pokemon' && c.types.includes('Psychic'))).toBe(true);
    expect(searchCards('').length).toBeGreaterThan(100);
  });
});
