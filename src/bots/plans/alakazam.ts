// Alakazam: Powerful Hand places 2 damage counters per card in hand, so once Alakazam can attack the
// bot stops spending cards that don't draw more.
import { canAttackNow } from '../knowledge';
import { keyOf, slotsOf, topDef, topKey } from '../../engine/state';
import type { GameState, PlayerId } from '../../engine/types';
import type { DeckPlan } from '../types';

const DRAWS = new Set(['dawn', 'hilda', 'lillies-determination', 'eri', 'unfair-stamp', 'special-red-card']);

const ready = (s: GameState, me: PlayerId) => {
  const a = s.players[me].active;
  return !!a && topKey(s, a) === 'alakazam' && canAttackNow(s, a);
};

export const alakazamPlan: DeckPlan = {
  name: 'Alakazam Powerful Hand',
  attackers: ['alakazam', 'dudunsparce', 'kadabra', 'lillies-clefairy-ex', 'fezandipiti-ex', 'genesect', 'flutter-mane'],
  starters: ['abra', 'flutter-mane', 'dunsparce-jtg-120', 'elgyem'],
  benchTarget: () => 5,
  cardValue: (s, me, key) => {
    const names = slotsOf(s.players[me]).map((sl) => topDef(s, sl).name);
    if (key === 'abra') return names.filter((n) => ['Abra', 'Kadabra', 'Alakazam'].includes(n)).length < 3 ? 46 : 12;
    if (key === 'kadabra') return names.includes('Abra') ? 58 : 18;
    if (key === 'alakazam') return names.includes('Kadabra') || names.includes('Abra') ? 66 : 25;
    return undefined;
  },
  adjust: (s, me, a) => {
    if (!ready(s, me)) return 0;
    // Every card kept in hand is 20 more damage.
    if (a.t === 'ability') return 0;
    if (a.t === 'evolve') return 0;
    if (a.t === 'trainer' && DRAWS.has(keyOf(s, a.card))) return 0;
    if (a.t === 'trainer' && keyOf(s, a.card) === 'rare-candy') return 0;
    return -100;
  },
};
