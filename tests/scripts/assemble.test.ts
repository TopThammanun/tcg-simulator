import { describe, expect, it } from 'vitest';
import {
  assignCardKeys,
  deckProblems,
  firstImage,
  indexSetsByCode,
  matchLocalId,
  type ResolvedPrint,
} from '../../scripts/lib/assemble';
import { fromTcgdex, type TcgdexCard } from '../../scripts/lib/normalize';
import type { CardManifest } from '../../src/data/cards';
import type { DeckEntry } from '../../src/data/decklist';
import kangaskhan from '../fixtures/api/tcgdex-me01-104.json';
import gladion from '../fixtures/api/tcgdex-me05-077.json';
import grassEnergy from '../fixtures/api/tcgdex-mee-001.json';

const NO_IMAGE = { source: 'none' } as const;

function resolved(key: string, raw: object, patch: Partial<TcgdexCard> = {}): ResolvedPrint {
  const [set, number] = key.split('-') as [string, string];
  const card = fromTcgdex({ ...(raw as TcgdexCard), ...patch });
  return { key, set, number, name: card.name, card, image: NO_IMAGE };
}

describe('indexSetsByCode', () => {
  it('maps Limitless codes to API set ids, keeping every set that shares a code', () => {
    const index = indexSetsByCode([
      { id: 'sv06', code: 'TWM' },
      { id: '30th', code: '30C' },
      { id: '30th-c', code: '30C' },
    ]);
    expect(index.get('TWM')).toEqual(['sv06']);
    expect(index.get('30C')).toEqual(['30th', '30th-c']);
  });
});

describe('matchLocalId', () => {
  it('matches numbers regardless of zero padding', () => {
    expect(matchLocalId(['051', '052', '053'], '52')).toBe('052');
    expect(matchLocalId(['1', '2'], '2')).toBe('2');
  });

  it('matches letter-suffixed numbers exactly, ignoring case', () => {
    expect(matchLocalId(['TG05', 'GG12'], 'tg05')).toBe('TG05');
  });

  it('returns undefined when the set has no such number', () => {
    expect(matchLocalId(['001'], '999')).toBeUndefined();
  });
});

describe('assignCardKeys', () => {
  it('gives reprints with identical text one card keyed by name', () => {
    const { cards, prints } = assignCardKeys([
      resolved('MEG-104', kangaskhan),
      resolved('XXX-001', kangaskhan, { id: 'xxx-001', regulationMark: 'J' }),
    ]);
    expect(Object.keys(cards)).toEqual(['mega-kangaskhan-ex']);
    expect(cards['mega-kangaskhan-ex']!.prints).toEqual(['MEG-104', 'XXX-001']);
    expect(prints['XXX-001']!.card).toBe('mega-kangaskhan-ex');
  });

  it('splits same-named cards whose text differs, suffixing each with its first print', () => {
    const weaker = structuredClone(kangaskhan);
    weaker.hp = 280;
    const { cards, variants } = assignCardKeys([resolved('MEG-104', kangaskhan), resolved('ABC-7', weaker)]);
    expect(Object.keys(cards).sort()).toEqual(['mega-kangaskhan-ex-abc-7', 'mega-kangaskhan-ex-meg-104']);
    expect(variants).toEqual([
      { name: 'Mega Kangaskhan ex', keys: ['mega-kangaskhan-ex-abc-7', 'mega-kangaskhan-ex-meg-104'] },
    ]);
  });
});

describe('deckProblems', () => {
  const { cards, prints } = assignCardKeys([
    resolved('MEG-104', kangaskhan),
    resolved('PBL-77', gladion),
    resolved('MEE-1', grassEnergy),
    resolved('ACE-1', gladion, { id: 'ace-1', name: 'Secret Box', rarity: 'ACE SPEC Rare', trainerType: 'Item' }),
    resolved('ACE-2', gladion, { id: 'ace-2', name: "Hero's Cape", rarity: 'ACE SPEC Rare', trainerType: 'Tool' }),
  ]);
  const manifest: CardManifest = { version: 1, generatedAt: '', cards, prints };
  const entry = (count: number, key: string, section: DeckEntry['section']): DeckEntry => {
    const p = prints[key]!;
    return { count, name: p.name, set: p.set, number: p.number, section };
  };

  it('accepts a deck within the rules (Basic Energy is exempt from the 4-copy limit)', () => {
    const deck = [entry(4, 'MEG-104', 'pokemon'), entry(1, 'ACE-1', 'trainer'), entry(55, 'MEE-1', 'energy')];
    expect(deckProblems(deck, manifest)).toEqual([]);
  });

  it('flags more than 4 copies of a name, a second ACE SPEC, and no Basic Pokémon', () => {
    const deck = [entry(5, 'PBL-77', 'trainer'), entry(1, 'ACE-1', 'trainer'), entry(1, 'ACE-2', 'trainer')];
    expect(deckProblems(deck, manifest)).toEqual([
      "5 copies of Gladion's Final Battle (max 4)",
      '2 ACE SPEC cards (max 1)',
      'no Basic Pokémon',
    ]);
  });

  it('flags prints missing from the manifest', () => {
    expect(deckProblems([{ count: 1, name: 'X', set: 'ZZZ', number: '1', section: 'trainer' }], manifest)).toContain(
      'ZZZ-1 (X) is not in the manifest',
    );
  });
});

describe('firstImage', () => {
  it('returns the first source that finds an image, skipping the rest', async () => {
    const calls: string[] = [];
    const step = (name: string, hit: boolean) => async () => {
      calls.push(name);
      return hit ? { source: 'pokemontcg.io' as const, high: 'h', low: 'l' } : undefined;
    };
    const image = await firstImage([step('tcgdex', false), step('ptcg', true), step('alt', true)]);
    expect(image.source).toBe('pokemontcg.io');
    expect(calls).toEqual(['tcgdex', 'ptcg']);
  });

  it('falls back to a text frame when no source has an image', async () => {
    expect(await firstImage([async () => undefined])).toEqual({ source: 'none' });
  });
});
