// N's Zoroark ex: bench N's Zekrom / N's Reshiram as attack sources for Night Joker; draw with Trade.
import { keyOf, slotsOf, topKey } from '../../engine/state';
import type { DeckPlan } from '../types';

const SOURCES = ['ns-zekrom', 'ns-reshiram'];

export const zoroarkPlan: DeckPlan = {
  name: "N's Zoroark ex",
  attackers: ['ns-zoroark-ex', 'pecharunt-ex', 'yveltal', 'munkidori', 'fezandipiti-ex', 'ns-zorua'],
  starters: ['tatsugiri', 'ns-purrloin', 'ns-zorua', 'munkidori'],
  benchTarget: () => 5,
  cardValue: (s, me, key) => {
    const inPlay = slotsOf(s.players[me]).map((sl) => topKey(s, sl));
    if (key === 'ns-zorua') return inPlay.filter((k) => k === 'ns-zorua' || k === 'ns-zoroark-ex').length < 3 ? 46 : 10;
    if (key === 'ns-zoroark-ex') return inPlay.includes('ns-zorua') ? 66 : 25;
    if (SOURCES.includes(key)) return inPlay.includes(key) ? 6 : 40;
    return undefined;
  },
  attackerBias: (s, _me, slot) => (SOURCES.includes(topKey(s, slot)) ? -80 : 0),
  adjust: (s, _me, a) => {
    if (a.t === 'energy') {
      const k = slotsOf(s.players[s.current]).find((sl) => sl.uid === a.target);
      if (k && SOURCES.includes(topKey(s, k))) return -100;
    }
    if (a.t === 'bench' && SOURCES.includes(keyOf(s, a.card))) return 20;
    return 0;
  },
};
