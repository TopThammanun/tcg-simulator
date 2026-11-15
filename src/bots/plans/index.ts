import type { DeckPlan } from '../types';
import { alakazamPlan } from './alakazam';
import { basicBoxPlan, DEFAULT_POLICY, type PlayerPolicy } from './basic-box';
import { dragapultPlan } from './dragapult-ex';
import { festivalPlan } from './festival-lead';
import { zoroarkPlan } from './ns-zoroark-ex';
import { slowkingPlan } from './slowking';

export { DEFAULT_POLICY, type PlayerPolicy };

/** Plan for a deck in src/content/decks by slug. The player deck takes a policy. */
export function planFor(slug: string, policy: PlayerPolicy = DEFAULT_POLICY): DeckPlan {
  switch (slug) {
    case 'player':
      return basicBoxPlan('player', policy);
    case 'basic-box':
      return basicBoxPlan('basic-box', { ...DEFAULT_POLICY, areaZero: 'early' });
    case 'dragapult-ex':
      return dragapultPlan;
    case 'slowking':
      return slowkingPlan;
    case 'ns-zoroark-ex':
      return zoroarkPlan;
    case 'alakazam':
      return alakazamPlan;
    case 'festival-lead-seaking':
      return festivalPlan('seaking');
    case 'festival-lead-dipplin':
      return festivalPlan('dipplin');
  }
  // Decks edited in the browser fall back to a generic plan.
  return { name: slug, attackers: [] };
}
