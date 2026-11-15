// Festival Lead (PLAN.md "บอท Festival: ลำดับใน 1 เทิร์น"): fill the Bench, get Thwackey early, keep
// Festival Grounds in play, search what's missing with Boom Boom Groove, and empty the hand for Gladion
// when Gladion makes a Knock Out.
import { def, hasRuleBox } from '../../engine/db';
import { hpLeft, stadiumIs } from '../../engine/rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../../engine/state';
import type { GameState, PlayerId } from '../../engine/types';
import { roughDamage } from '../knowledge';
import type { DeckPlan } from '../types';

const FESTIVAL = ['seaking', 'dipplin', 'goldeen'];

/** Would Gladion (+80 per attack, two attacks) Knock Out the opponent's Active? */
function gladionKO(s: GameState, me: PlayerId): boolean {
  const a = s.players[me].active;
  const d = s.players[opp(me)].active;
  if (!a || !d || !FESTIVAL.includes(topKey(s, a))) return false;
  const per = Math.max(...topDef(s, a).attacks.map((x) => roughDamage(s, a, x)));
  const bangle = a.tool !== null && keyOf(s, a.tool) === 'brave-bangle' && hasRuleBox(topKey(s, d)) ? 30 : 0;
  const twice = stadiumIs(s, 'festival-grounds') ? 2 : 1;
  const without = (per + bangle) * twice;
  return without < hpLeft(s, d) && (per + bangle + 80) * twice >= hpLeft(s, d);
}

const inHand = (s: GameState, me: PlayerId, key: string) => s.players[me].hand.some((c) => keyOf(s, c) === key);

export function festivalPlan(variant: 'seaking' | 'dipplin'): DeckPlan {
  const main = variant === 'seaking' ? 'seaking' : 'dipplin';
  return {
    name: `Festival Lead (${variant === 'seaking' ? 'Seaking' : 'Dipplin'})`,
    attackers: variant === 'seaking'
      ? ['seaking', 'moltres', 'thwackey', 'goldeen', 'grookey-mep-52']
      : ['dipplin', 'seaking', 'thwackey', 'applin-twm-17', 'goldeen'],
    starters: ['goldeen', 'applin-twm-126', 'applin-twm-17', 'rellor', 'shaymin', 'psyduck', 'grookey-twm-14', 'grookey-mep-52'],
    benchTarget: () => 5,
    cardValue: (s, me, key) => {
      const names = slotsOf(s.players[me]).map((sl) => topDef(s, sl).name);
      const n = (x: string) => names.filter((y) => y === x).length;
      switch (key) {
        case 'festival-grounds':
          return !stadiumIs(s, 'festival-grounds') && !inHand(s, me, key) ? 70 : 12;
        case 'goldeen':
          return n('Goldeen') + n('Seaking') < (variant === 'seaking' ? 3 : 2) ? 44 : 10;
        case 'applin-twm-17':
        case 'applin-twm-126':
          return n('Applin') + n('Dipplin') < 3 ? 44 : 10;
        case 'seaking':
          return names.includes('Goldeen') ? 68 : 22;
        case 'dipplin':
          return names.includes('Applin') ? 70 : 22;
        case 'grookey-twm-14':
        case 'grookey-mep-52':
          return n('Grookey') + n('Thwackey') < 2 ? 42 : 8;
        case 'thwackey':
          return names.includes('Grookey') ? 66 : 20;
        case 'rellor':
          return n('Rellor') + n('Rabsca') === 0 ? 30 : 4;
        case 'rabsca':
          return names.includes('Rellor') ? 45 : 10;
        case 'gladions-final-battle':
          return gladionKO(s, me) && !inHand(s, me, key) ? 60 : 24;
        case 'brave-bangle': {
          const a = s.players[me].active;
          return a && a.tool === null && FESTIVAL.includes(topKey(s, a)) && !inHand(s, me, key) ? 45 : 14;
        }
      }
      return undefined;
    },
    attackerBias: (s, _me, slot) => (topKey(s, slot) === main ? 30 : 0),
    adjust: (s, me, a) => {
      if (a.t === 'trainer' && keyOf(s, a.card) === 'festival-grounds') return 40;
      // Empty the hand so Gladion becomes playable (it must be the last card).
      if (inHand(s, me, 'gladions-final-battle') && gladionKO(s, me) && !s.players[me].supporterPlayed) {
        if (a.t === 'bench' || a.t === 'tool' || a.t === 'energy' || a.t === 'evolve') return 25;
        if (a.t === 'trainer' && def(keyOf(s, a.card)).category === 'trainer' && keyOf(s, a.card) !== 'gladions-final-battle') {
          const k = keyOf(s, a.card);
          // Draw Supporters would refill the hand.
          return ['lillies-determination', 'judge', 'surfer'].includes(k) ? -100 : 25;
        }
      }
      return 0;
    },
    choose: (s, me, req) => {
      if (req.source !== 'thwackey' || req.purpose !== 'search') return undefined;
      const want = (k: string) => req.options.find((o) => keyOf(s, o.value) === k)?.value;
      const order: string[] = [];
      if (!stadiumIs(s, 'festival-grounds') && !inHand(s, me, 'festival-grounds')) order.push('festival-grounds');
      if (gladionKO(s, me) && !inHand(s, me, 'gladions-final-battle')) order.push('gladions-final-battle');
      const twoPrize = s.players[opp(me)].bench.some((b) => topDef(s, b).prizes >= 2 && hpLeft(s, b) <= 180);
      if (twoPrize && !inHand(s, me, 'bosss-orders')) order.push('bosss-orders');
      order.push('brave-bangle', main === 'seaking' ? 'goldeen' : 'applin-twm-17', main, 'thwackey', 'mist-energy', 'grass-energy', 'fire-energy');
      for (const k of order) {
        const v = want(k);
        if (v !== undefined) return [v];
      }
      return undefined;
    },
  };
}
