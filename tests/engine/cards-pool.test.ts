// Cards of the card pool (data/card-pool.txt): played by real lists of our archetypes, not by the deck files.
import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../../src/engine/actions';
import { maxHp } from '../../src/engine/rules';
import { keyOf } from '../../src/engine/state';
import type { GameState } from '../../src/engine/types';
import { active, bench, choose, handCard, optionFor, scenario } from './helpers';

const attack = (s: GameState, name: string) => apply(s, { t: 'attack', name });
const keys = (s: GameState, ids: number[]) => ids.map((c) => keyOf(s, c));
/** The same position with the coin set to each value in turn, until `pred` holds after `f`. */
function withCoin(s: GameState, f: (x: GameState) => GameState, pred: (x: GameState) => boolean): GameState {
  for (let coin = 0; coin < 64; coin++) {
    const t = f({ ...s, rng: { ...s.rng, coin } });
    if (pred(t)) return t;
  }
  throw new Error('no coin value gives that result');
}

describe('Annihilape', () => {
  it('Destined Fight Knocks Out both Active Pokémon; each side takes its Prizes', () => {
    const s = attack(
      scenario({
        p0: { active: { card: 'annihilape-ssp-100', energy: ['fighting-energy', 'psychic-energy'] }, bench: ['slowpoke'] },
        p1: { active: 'mega-kangaskhan-ex', bench: ['dreepy'] },
      }),
      'Destined Fight',
    );
    expect(s.players[0].prizes).toHaveLength(3);
    expect(s.players[1].prizes).toHaveLength(5);
  });

  it("Slowking's Seek Inspiration copies Destined Fight: Slowking (1 Prize) for their Mega Kangaskhan ex (3 Prizes)", () => {
    let s = scenario({
      p0: { active: { card: 'slowking', under: ['slowpoke'], energy: ['psychic-energy', 'psychic-energy'] }, bench: ['slowpoke'], deck: ['annihilape-ssp-100', 'psychic-energy'] },
      p1: { active: 'mega-kangaskhan-ex', bench: ['dreepy'] },
    });
    s = attack(s, 'Seek Inspiration');
    s = choose(s, optionFor(s, 'Destined Fight'));
    // Both promoted their Bench; each took the Prizes of what it Knocked Out.
    expect(s.players[0].prizes).toHaveLength(3);
    expect(s.players[1].prizes).toHaveLength(5);
    expect(keys(s, active(s, 1).stack)).toEqual(['dreepy']);
  });

  it('Tantrum does 130 and leaves Annihilape Confused', () => {
    const s = scenario({
      p0: { active: { card: 'annihilape-ssp-100', energy: ['fighting-energy'] } },
      p1: { active: 'metagross' },
    });
    const t = attack(s, 'Tantrum');
    expect(active(t, 1).damage).toBe(130);
    expect(active(t, 0).conditions).toContain('confused');
  });

  it('Ghostly Blow does 100 and places 5 damage counters on a Benched Pokémon', () => {
    let s = scenario({
      p0: { active: { card: 'annihilape-pbl-41', energy: ['psychic-energy', 'psychic-energy'] } },
      p1: { active: 'mega-kangaskhan-ex', bench: ['dreepy', 'drakloak'] },
    });
    s = attack(s, 'Ghostly Blow');
    s = choose(s, optionFor(s, 'Drakloak'));
    expect(active(s, 1).damage).toBe(100);
    expect(bench(s, 1, 1).damage).toBe(50);
  });

  it('Durable Body: Knocked Out by attack damage, it stays at 10 HP on heads and is Knocked Out on tails', () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] } },
      p1: { active: 'annihilape-pbl-41', bench: ['slowpoke'] },
    });
    const survived = withCoin(s, (x) => attack(x, 'Rapid-Fire Combo'), (x) => x.players[1].active?.stack.some((c) => keyOf(x, c) === 'annihilape-pbl-41') ?? false);
    expect(maxHp(survived, active(survived, 1)) - active(survived, 1).damage).toBe(10);
    const knocked = withCoin(s, (x) => attack(x, 'Rapid-Fire Combo'), (x) => x.players[0].prizes.length === 5);
    expect(keys(knocked, knocked.players[1].discard)).toContain('annihilape-pbl-41');
  });
});

describe('Dudunsparce ex', () => {
  it('Tenacious Tail does 60 for each Pokémon ex the opponent has in play', () => {
    const s = scenario({
      p0: { active: { card: 'dudunsparce-ex', under: ['dunsparce-tef-128'], energy: ['psychic-energy'] } },
      p1: { active: 'mega-kangaskhan-ex', bench: ['latias-ex', 'dreepy'] },
    });
    expect(active(attack(s, 'Tenacious Tail'), 1).damage).toBe(120);
  });
});

describe("N's Darmanitan", () => {
  it('Back Draft does 30 for each Basic Energy in the opponent\'s discard pile', () => {
    const s = scenario({
      p0: { active: { card: 'ns-darmanitan', under: ['ns-darumaka'], energy: ['psychic-energy', 'psychic-energy'] } },
      p1: { active: 'mega-kangaskhan-ex', discard: ['psychic-energy', 'grass-energy', 'boomerang-energy', 'judge'] },
    });
    expect(active(attack(s, 'Back Draft'), 1).damage).toBe(60);
  });

  it('Flamebody Cannon discards its Energy and also does 90 to a Benched Pokémon', () => {
    let s = scenario({
      p0: { active: { card: 'ns-darmanitan', under: ['ns-darumaka'], energy: ['fire-energy', 'fire-energy', 'psychic-energy'] } },
      p1: { active: 'mega-kangaskhan-ex', bench: ['latias-ex'] },
    });
    s = attack(s, 'Flamebody Cannon');
    expect(active(s, 0).energy).toEqual([]);
    expect(active(s, 1).damage).toBe(90);
    expect(bench(s, 1, 0).damage).toBe(90);
  });
});

describe('Talonflame ex', () => {
  it('Excited Dive puts it from the hand onto the Bench only with a {C} Mega Evolution Pokémon ex in play', () => {
    const benchable = (s: GameState) => legalActions(s).some((a) => a.t === 'bench' && keyOf(s, a.card) === 'talonflame-ex');
    expect(benchable(scenario({ p0: { active: 'mega-kangaskhan-ex', hand: ['talonflame-ex'] }, p1: { active: 'abra' } }))).toBe(true);
    expect(benchable(scenario({ p0: { active: 'latias-ex', hand: ['talonflame-ex'] }, p1: { active: 'abra' } }))).toBe(false);
    const s = apply(scenario({ p0: { active: 'mega-kangaskhan-ex', hand: ['talonflame-ex'] }, p1: { active: 'abra' } }), {
      t: 'bench',
      card: handCard(scenario({ p0: { active: 'mega-kangaskhan-ex', hand: ['talonflame-ex'] }, p1: { active: 'abra' } }), 0, 'talonflame-ex'),
    });
    expect(keys(s, bench(s, 0, 0).stack)).toEqual(['talonflame-ex']);
  });

  it('Talon Hunt does 150 and takes up to 2 cards from the deck', () => {
    let s = scenario({
      p0: { active: { card: 'talonflame-ex', energy: ['psychic-energy', 'psychic-energy'] }, deck: ['judge', 'ultra-ball', 'dreepy'] },
      p1: { active: 'mega-kangaskhan-ex' },
    });
    s = attack(s, 'Talon Hunt');
    s = choose(s, optionFor(s, 'Judge'), optionFor(s, 'Ultra Ball'));
    expect(active(s, 1).damage).toBe(150);
    expect(keys(s, s.players[0].hand).sort()).toEqual(['judge', 'ultra-ball']);
  });
});

describe('Passimian, Enamorus', () => {
  it('Coordinated Throwing does 20 for each of your Basic Pokémon in play', () => {
    const s = scenario({
      p0: { active: { card: 'passimian', energy: ['fighting-energy', 'psychic-energy'] }, bench: ['latias-ex', 'slowpoke', { card: 'slowking', under: ['slowpoke'] }] },
      p1: { active: 'metagross' },
    });
    expect(active(attack(s, 'Coordinated Throwing'), 1).damage).toBe(60);
  });

  it('Love Resonance does 120 more when a type is shared across the two sides', () => {
    const at = (theirs: string) =>
      active(attack(scenario({ p0: { active: { card: 'enamorus', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] } }, p1: { active: theirs } }), 'Love Resonance'), 1).damage;
    expect(at('mega-kangaskhan-ex')).toBe(80);
    expect(at('latias-ex')).toBe(200);
  });
});

describe('Tools, Items and Stadiums', () => {
  it('Punk Helmet puts 4 damage counters on the attacker when its Darkness Pokémon is damaged in the Active Spot', () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] } },
      p1: { active: { card: 'ns-zoroark-ex', under: ['ns-zorua'], tool: 'punk-helmet' } },
    });
    expect(active(attack(s, 'Rapid-Fire Combo'), 0).damage).toBe(40);
  });

  it('Enhanced Hammer discards a Special Energy from an opponent\'s Pokémon, and needs one to be there', () => {
    const none = scenario({ p0: { active: 'abra', hand: ['enhanced-hammer'] }, p1: { active: { card: 'abra', energy: ['psychic-energy'] } } });
    expect(legalActions(none).some((a) => a.t === 'trainer')).toBe(false);
    let s = scenario({ p0: { active: 'abra', hand: ['enhanced-hammer'] }, p1: { active: { card: 'abra', energy: ['psychic-energy', 'boomerang-energy'] } } });
    s = apply(s, { t: 'trainer', card: handCard(s, 0, 'enhanced-hammer') });
    expect(keys(s, active(s, 1).energy)).toEqual(['psychic-energy']);
    expect(keys(s, s.players[1].discard)).toContain('boomerang-energy');
  });

  it('Forest of Vitality: a {G} Pokémon can evolve into a {G} Pokémon the turn it was played, not otherwise', () => {
    const base = { p0: { active: 'abra', bench: ['grookey-twm-14'], hand: ['thwackey'] }, p1: { active: 'abra' } };
    const fresh = (st: GameState) => ({ ...st, players: [{ ...st.players[0], bench: [{ ...st.players[0].bench[0]!, enteredTurn: st.turn }] }, st.players[1]] }) as GameState;
    const evolves = (st: GameState) => legalActions(st).some((a) => a.t === 'evolve');
    expect(evolves(fresh(scenario(base)))).toBe(false);
    expect(evolves(fresh(scenario({ ...base, stadium: { card: 'forest-of-vitality', owner: 0 } })))).toBe(true);
    // Not in the first turns.
    expect(evolves(fresh(scenario({ ...base, stadium: { card: 'forest-of-vitality', owner: 0 }, turn: 2 })))).toBe(false);
  });
});
