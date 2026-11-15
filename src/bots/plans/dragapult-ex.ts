// Dragapult ex: evolve several Dreepy quickly, then Phantom Dive to spread damage counters on the Bench.
import { keyOf, slotsOf, topDef } from '../../engine/state';
import type { GameState, PlayerId } from '../../engine/types';
import type { DeckPlan } from '../types';

const count = (s: GameState, me: PlayerId, names: string[]) =>
  slotsOf(s.players[me]).filter((sl) => names.includes(topDef(s, sl).name)).length;

export const dragapultPlan: DeckPlan = {
  name: 'Dragapult ex',
  attackers: ['dragapult-ex', 'drakloak', 'munkidori', 'dudunsparce', 'fezandipiti-ex', 'dreepy'],
  starters: ['budew', 'dreepy', 'dunsparce-tef-128', 'munkidori'],
  benchTarget: () => 5,
  cardValue: (s, me, key) => {
    const line = count(s, me, ['Dreepy', 'Drakloak', 'Dragapult ex']);
    switch (key) {
      case 'dreepy':
        return line < 3 ? 48 : 12;
      case 'drakloak':
        return count(s, me, ['Dreepy']) > 0 ? 62 : 18;
      case 'dragapult-ex':
        return count(s, me, ['Drakloak']) > 0 ? 72 : count(s, me, ['Dreepy']) > 0 ? 30 : 15;
      case 'munkidori':
        return count(s, me, ['Munkidori']) === 0 ? 30 : 8;
      case 'budew':
        return s.turn <= 2 ? 25 : 4;
    }
    return undefined;
  },
  adjust: (s, me, a) => {
    if (a.t === 'trainer' && keyOf(s, a.card) === 'risky-ruins') {
      // Risky Ruins hurts our own non-{D} Basics too: play it once our Bench is built.
      return s.players[me].bench.length >= 4 ? 15 : -100;
    }
    if (a.t === 'bench' && keyOf(s, a.card) === 'budew') return s.turn <= 2 ? 0 : -25;
    return 0;
  },
};
