import { describe, expect, it } from 'vitest';
import { parseDecklist, printKey } from '../../src/data/decklist';

const SAMPLE = `Pokémon: 2
1 Mega Kangaskhan ex MEG 104
1 Lillie's Clefairy ex ASC 76

Trainer: 1
1 Poké Pad POR 81

Energy: 1
1 Grass Energy MEE 1
`;

describe('parseDecklist', () => {
  it('reads count, name, set and number for each line', () => {
    const deck = parseDecklist(SAMPLE, { expectedTotal: 4 });
    expect(deck.entries).toEqual([
      { count: 1, name: 'Mega Kangaskhan ex', set: 'MEG', number: '104', section: 'pokemon' },
      { count: 1, name: "Lillie's Clefairy ex", set: 'ASC', number: '76', section: 'pokemon' },
      { count: 1, name: 'Poké Pad', set: 'POR', number: '81', section: 'trainer' },
      { count: 1, name: 'Grass Energy', set: 'MEE', number: '1', section: 'energy' },
    ]);
    expect(deck.total).toBe(4);
  });

  it('accepts the "Pokémon (19)" heading style from Limitless pages', () => {
    const deck = parseDecklist('Pokemon (1)\n1 Dreepy TWM 128\n', { expectedTotal: 1 });
    expect(deck.entries[0]).toMatchObject({ name: 'Dreepy', section: 'pokemon' });
  });

  it('requires 60 cards by default', () => {
    expect(() => parseDecklist(SAMPLE)).toThrow(/60/);
  });

  it('rejects a section whose heading count does not match its cards', () => {
    expect(() => parseDecklist('Trainer: 3\n2 Ultra Ball MEG 131\n', { expectedTotal: 2 })).toThrow(
      /Trainer.*3.*2/,
    );
  });

  it('rejects lines it cannot read, naming the line number', () => {
    expect(() =>
      parseDecklist('Trainer: 1\n1 Ultra Ball\n', { expectedTotal: 1 }),
    ).toThrow(/line 2/);
  });

  it('rejects cards listed before any section heading', () => {
    expect(() => parseDecklist('1 Ultra Ball MEG 131\n', { expectedTotal: 1 })).toThrow(/heading/);
  });
});

describe('printKey', () => {
  it('joins set code and number', () => {
    expect(printKey({ set: 'TWM', number: '130' })).toBe('TWM-130');
  });
});
