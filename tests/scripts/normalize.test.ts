import { describe, expect, it } from 'vitest';
import {
  cardSlug,
  compareSources,
  fromTcgdex,
  gameplaySignature,
  sameCardName,
  type PtcgCard,
  type TcgdexCard,
} from '../../scripts/lib/normalize';
import kangaskhan from '../fixtures/api/tcgdex-me01-104.json';
import ogerpon from '../fixtures/api/tcgdex-sv06-025.json';
import gladion from '../fixtures/api/tcgdex-me05-077.json';
import grassEnergy from '../fixtures/api/tcgdex-mee-001.json';
import mistEnergy from '../fixtures/api/tcgdex-sv05-161.json';
import basicPsychic from '../fixtures/api/tcgdex-mee-013.json';
import telepathic from '../fixtures/api/tcgdex-me03-088.json';
import ptcgCards from '../fixtures/api/ptcgio-cards.json';

const ptcg = (id: string) => (ptcgCards as PtcgCard[]).find((c) => c.id === id)!;

describe('fromTcgdex', () => {
  it('normalizes a Mega Pokémon ex, taking subtypes and rules from pokemontcg.io', () => {
    const card = fromTcgdex(kangaskhan as TcgdexCard, ptcg('me1-104'));
    expect(card).toMatchObject({
      category: 'pokemon',
      name: 'Mega Kangaskhan ex',
      hp: 300,
      types: ['Colorless'],
      stage: 'Basic',
      retreat: 3,
      prizes: 3,
      tera: false,
      subtypes: ['Basic', 'MEGA', 'ex'],
      weaknesses: [{ type: 'Fighting', value: '×2' }],
      resistances: [],
      regulationMark: 'I',
    });
    expect(card.category === 'pokemon' && card.abilities[0]?.name).toBe('Run Errand');
    expect(card.category === 'pokemon' && card.attacks).toEqual([
      {
        name: 'Rapid-Fire Combo',
        cost: ['Colorless', 'Colorless', 'Colorless'],
        damage: '200+',
        effect: 'Flip a coin until you get tails. This attack does 50 more damage for each heads.',
      },
    ]);
    expect(card.rules[0]).toMatch(/3 Prize cards/);
  });

  it('marks Tera from pokemontcg.io subtypes', () => {
    const card = fromTcgdex(ogerpon as TcgdexCard, ptcg('sv6-25'));
    expect(card).toMatchObject({ tera: true, prizes: 2 });
  });

  it('still derives Mega and ex prizes from the name when pokemontcg.io has no record', () => {
    expect(fromTcgdex(kangaskhan as TcgdexCard)).toMatchObject({ prizes: 3, subtypes: [] });
    expect(fromTcgdex(ogerpon as TcgdexCard)).toMatchObject({ prizes: 2, tera: false });
  });

  it('normalizes a Supporter', () => {
    expect(fromTcgdex(gladion as TcgdexCard, ptcg('me5-77'))).toMatchObject({
      category: 'trainer',
      trainerType: 'Supporter',
      aceSpec: false,
      effect: expect.stringMatching(/^You can use this card only when it is the last card/),
    });
  });

  it('normalizes Basic Energy with the type it provides', () => {
    expect(fromTcgdex(grassEnergy as TcgdexCard)).toMatchObject({
      category: 'energy',
      energyType: 'Basic',
      provides: 'Grass',
      effect: '',
    });
  });

  it('names "Basic Psychic Energy" prints the same as "Psychic Energy"', () => {
    expect(fromTcgdex(basicPsychic as TcgdexCard)).toMatchObject({
      name: 'Psychic Energy',
      energyType: 'Basic',
      provides: 'Psychic',
    });
  });

  it('treats an energy with its own effect as Special even when TCGdex labels it Normal', () => {
    expect(telepathic.energyType).toBe('Normal');
    expect(fromTcgdex(telepathic as TcgdexCard)).toMatchObject({
      name: 'Telepathic Psychic Energy',
      energyType: 'Special',
      provides: undefined,
      effect: expect.stringMatching(/search your deck for up to 2 Basic \{P\} Pokémon/),
    });
  });

  it('normalizes Special Energy with its effect text', () => {
    const card = fromTcgdex(mistEnergy as TcgdexCard, ptcg('sv5-161'));
    expect(card).toMatchObject({ category: 'energy', energyType: 'Special', aceSpec: false });
    expect(card.category === 'energy' && card.effect).toMatch(/Prevent all effects of attacks/);
  });
});

describe('gameplaySignature', () => {
  it('ignores print details such as set, illustrator and regulation mark', () => {
    const reprint = { ...kangaskhan, id: 'xxx-001', localId: '001', illustrator: 'Someone', regulationMark: 'J' };
    expect(gameplaySignature(fromTcgdex(reprint as TcgdexCard))).toBe(
      gameplaySignature(fromTcgdex(kangaskhan as TcgdexCard)),
    );
  });

  it('ignores blank lines between paragraphs of effect text', () => {
    const spaced = { ...gladion, effect: gladion.effect.replace('\n', '\n\n') };
    expect(gameplaySignature(fromTcgdex(spaced as TcgdexCard))).toBe(
      gameplaySignature(fromTcgdex(gladion as TcgdexCard)),
    );
  });

  it('changes when attack damage differs', () => {
    const other = structuredClone(kangaskhan);
    other.attacks[0]!.damage = '180+';
    expect(gameplaySignature(fromTcgdex(other as TcgdexCard))).not.toBe(
      gameplaySignature(fromTcgdex(kangaskhan as TcgdexCard)),
    );
  });
});

describe('compareSources', () => {
  it('finds no differences between TCGdex and pokemontcg.io for the same card', () => {
    expect(compareSources(fromTcgdex(kangaskhan as TcgdexCard), ptcg('me1-104'))).toEqual([]);
  });

  it('reports HP and attack damage that disagree', () => {
    const wrong = { ...ptcg('me1-104'), hp: '280' };
    wrong.attacks = [{ ...wrong.attacks![0]!, damage: '150+' }];
    expect(compareSources(fromTcgdex(kangaskhan as TcgdexCard), wrong)).toEqual([
      'hp: tcgdex 300 vs pokemontcg.io 280',
      'attack Rapid-Fire Combo damage: tcgdex 200+ vs pokemontcg.io 150+',
    ]);
  });
});

describe('card names', () => {
  it('builds a stable slug without accents or apostrophes', () => {
    expect(cardSlug("Lillie's Clefairy ex")).toBe('lillies-clefairy-ex');
    expect(cardSlug('Poké Pad')).toBe('poke-pad');
    expect(cardSlug("N's Zoroark ex")).toBe('ns-zoroark-ex');
  });

  it('matches names regardless of accents and apostrophe style', () => {
    expect(sameCardName('Poke Pad', 'Poké Pad')).toBe(true);
    expect(sameCardName('Boss’s Orders', "Boss's Orders")).toBe(true);
    expect(sameCardName('Seaking', 'Goldeen')).toBe(false);
  });

  it('matches "Basic Grass Energy" with "Grass Energy"', () => {
    expect(sameCardName('Basic Grass Energy', 'Grass Energy')).toBe(true);
    expect(sameCardName('Growing Grass Energy', 'Grass Energy')).toBe(false);
  });
});
