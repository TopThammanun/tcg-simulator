// Quick fuzz in the test suite; the full 10,000-game gate is `npm run fuzz`.
import { describe, expect, it } from 'vitest';
import { fuzzGame } from '../../src/sim/fuzz';
import { deck, DECK_SLUGS } from './helpers';

describe('fuzz: random legal moves keep every invariant', () => {
  const decks = DECK_SLUGS.map(deck);
  it('plays 240 games across every deck pairing', () => {
    const failures = [];
    let n = 0;
    for (let i = 0; i < decks.length; i++) {
      for (let j = 0; j < decks.length; j++) {
        for (let k = 0; k < 4 && n < 240; k++, n++) {
          const r = fuzzGame(1000 + n, [decks[i]!, decks[j]!]);
          if (r.failure) failures.push(r.failure);
        }
      }
    }
    expect(failures.slice(0, 1)).toEqual([]);
  }, 120_000);
});
