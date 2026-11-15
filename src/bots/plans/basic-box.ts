// Basic Box style decks: your list (configurable policy, PLAN.md "บอทฝั่งคุณ") and the Basic Box bot.
import { def, hasRuleBox } from '../../engine/db';
import { stadiumIs } from '../../engine/rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../../engine/state';
import type { Action, GameState, PlayerId } from '../../engine/types';
import type { DeckPlan } from '../types';

export interface PlayerPolicy {
  /** Area Zero Underdepths: keep it to replace the opponent's Stadium (Festival Grounds), or play it early. */
  areaZero: 'hold' | 'early';
  /** How many Benched Pokémon to aim for when Area Zero allows 8. */
  benchMax: 5 | 8;
  /** Meowth ex after its Ability: first to go when the Bench shrinks, or keep it. */
  meowth: 'discard' | 'keep';
  mainAttacker: 'auto' | 'teal-mask-ogerpon-ex' | 'paldean-tauros' | 'raging-bolt-ex';
  /** Mega Kangaskhan ex + Hero's Cape (400 HP) as the wall. */
  capeWall: boolean;
}

export const DEFAULT_POLICY: PlayerPolicy = {
  areaZero: 'hold',
  benchMax: 8,
  meowth: 'discard',
  mainAttacker: 'auto',
  capeWall: true,
};

const AUTO_ATTACKERS = [
  'mega-kangaskhan-ex',
  'teal-mask-ogerpon-ex',
  'raging-bolt-ex',
  'latias-ex',
  'iron-leaves-ex',
  'koraidon-ex',
  'bloodmoon-ursaluna-ex',
  'paldean-tauros',
  'wellspring-mask-ogerpon-ex',
  'lillies-clefairy-ex',
  'chien-pao',
  'iron-crown-ex',
  'fezandipiti-ex',
];

const hasTera = (s: GameState, me: PlayerId) => slotsOf(s.players[me]).some((sl) => topDef(s, sl).tera);

export function basicBoxPlan(name: string, policy: PlayerPolicy): DeckPlan {
  const attackers =
    policy.mainAttacker === 'auto'
      ? AUTO_ATTACKERS
      : [policy.mainAttacker, ...AUTO_ATTACKERS.filter((k) => k !== policy.mainAttacker)];

  return {
    name,
    attackers,
    starters: ['mega-kangaskhan-ex', 'latias-ex', 'teal-mask-ogerpon-ex', 'chien-pao', 'paldean-tauros'],
    benchTarget: (s, me) =>
      policy.benchMax === 8 && stadiumIs(s, 'area-zero-underdepths') && hasTera(s, me) ? 7 : 4,
    cardValue: (s, me, key) => {
      if (key === 'meowth-ex' && slotsOf(s.players[me]).some((sl) => topKey(s, sl) === 'meowth-ex')) {
        return policy.meowth === 'discard' ? 3 : 22;
      }
      if (key === 'area-zero-underdepths') return 18;
      if (key === 'heros-cape') return 24;
      return undefined;
    },
    attackerBias: (s, me, slot) => {
      const k = topKey(s, slot);
      let b = policy.mainAttacker === k ? 40 : 0;
      const d = s.players[opp(me)].active;
      if (k === 'paldean-tauros' && d && topDef(s, d).stage === 'Stage1') b += 60;
      if (k === 'meowth-ex' || k === 'fezandipiti-ex') b -= 30;
      return b;
    },
    adjust: (s, me, a) => adjustBasicBox(s, me, a, policy),
  };
}

function adjustBasicBox(s: GameState, me: PlayerId, a: Action, policy: PlayerPolicy): number {
  if (a.t === 'trainer' && keyOf(s, a.card) === 'area-zero-underdepths') {
    const theirs = s.stadium && s.stadium.owner !== me;
    const replacesFestival = stadiumIs(s, 'festival-grounds');
    if (!hasTera(s, me)) return -100;
    if (policy.areaZero === 'hold') return replacesFestival || theirs ? 25 : -100;
    return 15;
  }
  if (a.t === 'tool' && keyOf(s, a.card) === 'heros-cape') {
    const sl = slotsOf(s.players[me]).find((x) => x.uid === a.target)!;
    const k = topKey(s, sl);
    if (policy.capeWall) return k === 'mega-kangaskhan-ex' ? 30 : -25;
    return hasRuleBox(k) && s.players[me].active?.uid === sl.uid ? 10 : -10;
  }
  if (a.t === 'bench') {
    const k = keyOf(s, a.card);
    // Liabilities that only help in specific spots.
    if (k === 'fezandipiti-ex') return s.players[me].koLastTurn ? 25 : -25;
    if (k === 'iron-crown-ex') return slotsOf(s.players[me]).some((sl) => topKey(s, sl) === 'iron-leaves-ex') ? 0 : -10;
    if (k === 'iron-leaves-ex') return -30; // played from hand when it can switch in and attack (finisher)
    if (def(k).category === 'pokemon' && k === 'latias-ex') return 12;
  }
  return 0;
}
