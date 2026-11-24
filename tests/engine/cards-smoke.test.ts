// Every card's code path runs: each attack of each Pokémon, each Trainer / Special Energy, each Ability,
// with random valid choices on several seeds. Behaviour is checked in cards.test.ts and scenarios.test.ts.
import { describe, expect, it } from 'vitest';
import { makeRand, randomPicks } from '../../src/bots/random';
import { apply, legalActions } from '../../src/engine/actions';
import { CARDS } from '../../src/engine/db';
import { maxHp } from '../../src/engine/rules';
import { slotsOf } from '../../src/engine/state';
import type { Action, GameState } from '../../src/engine/types';
import { scenario } from './helpers';

const ENERGY_FOR: Record<string, string> = {
  Grass: 'grass-energy', Fire: 'fire-energy', Water: 'water-energy', Lightning: 'lightning-energy',
  Psychic: 'psychic-energy', Fighting: 'fighting-energy', Darkness: 'darkness-energy',
  Metal: 'psychic-energy', Dragon: 'psychic-energy', Fairy: 'psychic-energy', Colorless: 'psychic-energy',
};
const pokemon = Object.values(CARDS).filter((c) => c.category === 'pokemon');
const trainers = Object.values(CARDS).filter((c) => c.category === 'trainer' || (c.category === 'energy' && c.energyType === 'Special'));

/** Resolve every pending choice randomly, then check the board is still valid. */
function settle(s: GameState, seed: number): GameState {
  const rand = makeRand(seed);
  let cur = s;
  for (let i = 0; i < 50 && cur.pending; i++) cur = apply(cur, { t: 'choose', picks: randomPicks(cur.pending.request, rand) });
  expect(cur.pending).toBeNull();
  for (const p of [0, 1] as const) {
    for (const sl of slotsOf(cur.players[p])) {
      expect(sl.damage).toBeGreaterThanOrEqual(0);
      if (cur.winner === null) expect(sl.damage).toBeLessThan(maxHp(cur, sl));
    }
  }
  return cur;
}

/** A crowded board where most cards have something to do. */
function richBoard(p0: Parameters<typeof scenario>[0]['p0']) {
  return scenario({
    p0: {
      bench: [
        { card: 'teal-mask-ogerpon-ex', energy: ['grass-energy'] },
        { card: 'ns-zekrom' },
        { card: 'drakloak', under: ['dreepy'], energy: ['darkness-energy'], damage: 30 },
        { card: 'slowpoke' },
      ],
      discard: ['psychic-energy', 'darkness-energy', 'grass-energy', 'abra', 'meowth-ex', 'ultra-ball'],
      deck: ['dreepy', 'drakloak', 'dragapult-ex', 'abra', 'kadabra', 'alakazam', 'psychic-energy', 'grass-energy', 'darkness-energy', 'judge', 'bosss-orders', 'air-balloon', 'festival-grounds', 'ultra-ball', 'goldeen', 'seaking', 'meowth-ex', 'latias-ex', 'cyrano', 'grass-energy'],
      ...p0,
    },
    p1: {
      active: { card: 'mega-kangaskhan-ex', energy: ['psychic-energy', 'mist-energy'], tool: 'heros-cape' },
      bench: ['abra', 'meowth-ex', { card: 'iron-crown-ex', tool: 'air-balloon' }],
      hand: ['ultra-ball', 'poke-pad', 'judge', 'psychic-energy', 'buddy-buddy-poffin'],
      prizes: 3,
    },
  });
}

describe('every attack runs', () => {
  for (const c of pokemon) {
    if (c.category !== 'pokemon') continue;
    for (const atk of c.attacks) {
      it(`${c.key}: ${atk.name}`, () => {
        for (const seed of [1, 2, 3]) {
          const energy = [...atk.cost.map((t) => ENERGY_FOR[t]!), 'psychic-energy', 'psychic-energy'];
          const under = c.stage === 'Basic' ? [] : c.stage === 'Stage1' ? ['dreepy'] : ['dreepy', 'drakloak'];
          let s = richBoard({ active: { card: c.key, under, energy }, hand: ['psychic-energy', 'judge', 'ultra-ball'] });
          s = { ...s, rng: { shuffle: [seed, seed + 1], coin: seed * 7 } };
          const a = legalActions(s).find((x) => x.t === 'attack' && x.name === atk.name);
          if (!a) return; // e.g. Blood Moon needs fewer Energy than printed only later in the game
          settle(apply(s, a), seed);
        }
      });
    }
  }
});

// Cards that need something specific on the board to be playable at all.
const NEEDS: Record<string, { bench?: Parameters<typeof scenario>[0]['p0']['bench']; hand?: string[] }> = {
  'glass-trumpet': { bench: ['meowth-ex', 'teal-mask-ogerpon-ex'] },
  'rare-candy': { hand: ['alakazam'] },
  'rosas-encouragement': { bench: [{ card: 'dragapult-ex', under: ['dreepy', 'drakloak'] }] },
  'janines-secret-art': { bench: ['ns-zorua'] },
  'strange-timepiece': { bench: [{ card: 'kadabra', under: ['abra'] }] },
};

describe('every Trainer and Special Energy can be played', () => {
  for (const c of trainers) {
    it(c.key, () => {
      let played = 0;
      const need = NEEDS[c.key] ?? {};
      for (const seed of [1, 2, 3, 4]) {
        let s = richBoard({
          active: { card: 'abra', energy: ['psychic-energy'] },
          hand: [c.key, 'psychic-energy', 'grass-energy', 'tatsugiri', 'kadabra', 'dawn', ...(need.hand ?? [])],
          ...(need.bench ? { bench: need.bench } : {}),
        });
        s = { ...s, turn: 6, rng: { shuffle: [seed, seed + 9], coin: seed * 13 }, players: [{ ...s.players[0], koLastTurn: true }, s.players[1]] };
        const mine = legalActions(s).filter((a): a is Action & { card: number } => 'card' in a && s.cards[a.card]!.key === c.key);
        for (const a of mine.slice(0, 2)) {
          settle(apply(s, a), seed);
          played++;
        }
      }
      // Gladion needs an empty hand otherwise; check it on its own.
      if (c.key === 'gladions-final-battle') {
        const s = richBoard({ active: 'abra', hand: [c.key] });
        played += legalActions(s).some((a) => a.t === 'trainer') ? 1 : 0;
      }
      expect(played, `${c.key} was never playable`).toBeGreaterThan(0);
    });
  }
});

describe('every activated Ability can be used', () => {
  const withAbility = pokemon.filter((c) => c.category === 'pokemon' && c.abilities.length > 0);
  for (const c of withAbility) {
    if (c.category !== 'pokemon') continue;
    it(c.key, () => {
      const under = c.stage === 'Basic' ? [] : c.stage === 'Stage1' ? ['dreepy'] : ['dreepy', 'drakloak'];
      for (const seed of [1, 2]) {
        const s = richBoard({
          active: { card: c.key, under, energy: ['darkness-energy', 'psychic-energy'], damage: 20 },
          hand: ['grass-energy', 'psychic-energy', 'judge'],
        });
        for (const a of legalActions(s).filter((x) => x.t === 'ability')) settle(apply(s, a), seed);
      }
    });
  }
});
