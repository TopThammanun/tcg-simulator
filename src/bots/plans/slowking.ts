// Slowking: Seek Inspiration discards the top card of the deck and copies its attack, so the deck is
// stacked first with Ciphermaniac's Codebreaking or Academy at Night (Kyurem, Metagross, Zeraora).
import { canAttackNow } from '../knowledge';
import { keyOf, opp, topKey } from '../../engine/state';
import type { GameState, PlayerId } from '../../engine/types';
import { hasRuleBox } from '../../engine/db';
import type { DeckPlan } from '../types';

const SOURCES = ['kyurem', 'metagross', 'zeraora'];

function sourceRank(s: GameState, me: PlayerId, key: string): number {
  if (key === 'zeraora') return s.players[opp(me)].bench.some((b) => hasRuleBox(topKey(s, b))) ? 3 : 0;
  if (key === 'kyurem') return 4;
  if (key === 'metagross') return 2;
  return -1;
}

const slowkingReady = (s: GameState, me: PlayerId) => {
  const a = s.players[me].active;
  return !!a && topKey(s, a) === 'slowking' && canAttackNow(s, a);
};

export const slowkingPlan: DeckPlan = {
  name: 'Slowking Seek Inspiration',
  attackers: ['slowking', 'mega-kangaskhan-ex', 'latias-ex', 'mew-ex', 'slowpoke'],
  starters: ['mega-kangaskhan-ex', 'slowpoke', 'mew-ex', 'latias-ex'],
  benchTarget: () => 5,
  cardValue: (s, me, key) => {
    if (SOURCES.includes(key)) return 28;
    if (key === 'slowking') return s.players[me].bench.some((b) => topKey(s, b) === 'slowpoke') || topKey(s, s.players[me].active!) === 'slowpoke' ? 64 : 30;
    if (key === 'slowpoke') return 42;
    return undefined;
  },
  adjust: (s, me, a) => {
    if (a.t === 'bench' && SOURCES.includes(keyOf(s, a.card))) return -100; // copy fodder stays in hand/deck
    if (a.t === 'stadium') {
      const hasSource = s.players[me].hand.some((c) => SOURCES.includes(keyOf(s, c)));
      return slowkingReady(s, me) && hasSource ? 62 : -100;
    }
    if (a.t === 'trainer' && keyOf(s, a.card) === 'ciphermaniacs-codebreaking') return slowkingReady(s, me) ? 30 : 0;
    return 0;
  },
  choose: (s, me, req) => {
    if (req.source === 'academy-at-night') {
      const best = req.options
        .map((o) => ({ v: o.value, r: sourceRank(s, me, keyOf(s, o.value)) }))
        .sort((a, b) => b.r - a.r)[0];
      return best && best.r > 0 ? [best.v] : undefined;
    }
    // Stack an attack source on top only when Slowking attacks this turn; otherwise the top card
    // is simply drawn next turn, so the generic "best cards" choice is right.
    if (req.source === 'ciphermaniacs-codebreaking' && (req.purpose === 'search' || req.purpose === 'order') && slowkingReady(s, me)) {
      const ranked = req.options
        .map((o) => ({ v: o.value, r: sourceRank(s, me, keyOf(s, o.value)) }))
        .sort((a, b) => b.r - a.r);
      if (req.purpose === 'order') return ranked.map((x) => x.v);
      const src = ranked.filter((x) => x.r > 0).slice(0, 1).map((x) => x.v);
      return src.length ? src : undefined;
    }
    return undefined;
  },
};
