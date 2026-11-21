// Cards a player knows are on top of their own deck (Ciphermaniac's Codebreaking, Academy at Night): the
// engine keeps them, re-deals keep them for that player only, and the network sees them only for its own deck.
import { describe, expect, it } from 'vitest';
import { BAGS, VOCAB, CARD_KEYS, encode } from '../../src/bots/learn/encode';
import { apply } from '../../src/engine/actions';
import { knownTopCards } from '../../src/engine/state';
import type { GameState } from '../../src/engine/types';
import { determinize } from '../../src/engine/view';
import { scenario } from './helpers';

const DECKS = ['Slowking Seek Inspiration', 'Dragapult ex'] as const;

const board = () =>
  scenario({
    p0: {
      active: 'slowking',
      hand: ['ciphermaniacs-codebreaking'],
      deck: ['psychic-energy', 'judge', 'paldean-tauros', 'budew', 'psychic-energy', 'ultra-ball'],
    },
    p1: { active: 'dreepy', deck: ['dreepy', 'drakloak', 'bosss-orders', 'rare-candy'] },
  });

/** Play Ciphermaniac's Codebreaking, taking the first two cards offered, the second one on top. */
function codebreak(s: GameState): { s: GameState; top: number[] } {
  const card = s.players[0].hand.find((c) => s.cards[c]!.key === 'ciphermaniacs-codebreaking')!;
  let st = apply(s, { t: 'trainer', card });
  const offered = st.pending!.request.options.map((o) => o.value);
  st = apply(st, { t: 'choose', picks: offered.slice(0, 2) });
  const top = [offered[1]!, offered[0]!];
  if (st.pending) st = apply(st, { t: 'choose', picks: top });
  return { s: st, top };
}

describe('known deck top', () => {
  it('Ciphermaniac’s Codebreaking puts the two cards on top, in the chosen order, and the player knows them', () => {
    const { s, top } = codebreak(board());
    expect(s.players[0].deck.slice(0, 2)).toEqual(top);
    expect(knownTopCards(s.players[0])).toEqual(top);
  });

  it('a card taken off the top drops out; a shuffle forgets everything', () => {
    const { s, top } = codebreak(board());
    const ps = structuredClone(s.players[0]);
    ps.deck.shift();
    expect(knownTopCards(ps)).toEqual([top[1]]);
    ps.deck.reverse();
    expect(knownTopCards(ps)).toEqual([]);
  });

  it('a re-deal keeps my known top cards for me, and hides them from the opponent', () => {
    const { s, top } = codebreak(board());
    for (const seed of [1, 2, 3]) {
      const mine = determinize(s, 0, seed);
      expect(mine.players[0].deck.slice(0, 2)).toEqual(top);
      expect(knownTopCards(mine.players[0])).toEqual(top);
      expect(determinize(s, 1, seed).players[0].knownTop).toEqual([]);
    }
  });

  it('the network sees my known top card, and not the opponent’s', () => {
    const { s, top } = codebreak(board());
    const at = (b: number, key: string) => b * VOCAB + CARD_KEYS.indexOf(key) + 1;
    const mine = encode({ ...s, current: 0 }, { decks: DECKS });
    expect(mine.bags[at(6, s.cards[top[0]!]!.key)]).toBeGreaterThan(0);
    expect(mine.bags[at(7, s.cards[top[1]!]!.key)]).toBeGreaterThan(0);
    const theirs = encode({ ...s, current: 1 }, { decks: [DECKS[1], DECKS[0]] });
    for (let v = 0; v < VOCAB; v++) {
      expect(theirs.bags[6 * VOCAB + v]).toBe(0);
      expect(theirs.bags[7 * VOCAB + v]).toBe(0);
    }
    expect(BAGS).toBe(11);
  });
});
