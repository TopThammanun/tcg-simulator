// The hand shown sorted: Pokémon by stage, Supporters, Items, Tools, Stadiums, Energy; by name; copies together.
import { describe, expect, it } from 'vitest';
import { sortedHand } from '../../src/ui/play';
import { scenario } from '../engine/helpers';

describe('hand order', () => {
  it('groups by kind, then name, keeping the drawn order between copies', () => {
    const s = scenario({
      p0: {
        active: 'abra',
        hand: ['psychic-energy', 'ultra-ball', 'drakloak', 'judge', 'dreepy', 'mist-energy', 'heros-cape', 'bosss-orders', 'ultra-ball', 'dragapult-ex', 'budew'],
      },
      p1: { active: 'abra' },
    });
    const hand = s.players[0].hand;
    const keys = sortedHand(s, hand).map((c) => s.cards[c]!.key);
    expect(keys).toEqual([
      'budew',
      'dreepy',
      'drakloak',
      'dragapult-ex',
      'bosss-orders',
      'judge',
      'ultra-ball',
      'ultra-ball',
      'heros-cape',
      'psychic-energy',
      'mist-energy',
    ]);
    const balls = sortedHand(s, hand).filter((c) => s.cards[c]!.key === 'ultra-ball');
    expect(balls).toEqual(hand.filter((c) => s.cards[c]!.key === 'ultra-ball'));
    expect(hand.map((c) => s.cards[c]!.key)[0]).toBe('psychic-energy'); // the hand itself is untouched
  });
});
