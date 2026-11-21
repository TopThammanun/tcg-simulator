// What players know without seeing hidden cards (BOT-NEXT.md N4): Prize cards after looking through the deck, the
// cards of a hand the opponent saw go there, and the turn before (cards played, the attack, Prizes taken).
// Re-deals for look-ahead keep all of it and nothing more.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/engine/actions';
import { revealedHand } from '../../src/engine/state';
import type { GameState } from '../../src/engine/types';
import { determinize, redeal } from '../../src/engine/view';
import { scenario } from './helpers';

const key = (s: GameState, c: number) => s.cards[c]!.key;
const handCard = (s: GameState, p: 0 | 1, k: string) => s.players[p].hand.find((c) => key(s, c) === k)!;

/** Play a Trainer from player 0's hand, answering each choice with `answer` (default: the first option). */
function play(s: GameState, k: string, answer: (s: GameState) => number[] = (st) => [st.pending!.request.options[0]!.value]): GameState {
  let st = apply(s, { t: 'trainer', card: handCard(s, 0, k) });
  for (let guard = 0; st.pending && guard < 10; guard++) st = apply(st, { t: 'choose', picks: answer(st) });
  return st;
}

const board = (hand: string[], deck: string[], discard: string[] = []) =>
  scenario({
    p0: { active: 'dreepy', hand, deck, discard },
    p1: { active: 'budew', deck: ['psychic-energy', 'judge', 'ultra-ball', 'dreepy', 'budew', 'night-stretcher'] },
  });

describe('knowledge of Prize cards', () => {
  it('a deck search tells the player which cards are Prizes; drawing does not', () => {
    const s = board(['poke-pad', 'judge'], ['dreepy', 'budew', 'psychic-energy']);
    expect(s.players[0].prizesKnown).toBeFalsy();
    const searched = play(s, 'poke-pad');
    expect(searched.players[0].prizesKnown).toBe(true);
    const s2 = board(['judge'], ['dreepy', 'budew', 'psychic-energy', 'psychic-energy', 'psychic-energy']);
    expect(play(s2, 'judge').players[0].prizesKnown).toBeFalsy();
  });

  it('look-ahead keeps known Prize cards and still deals the rest of the deck again', () => {
    const s = play(board(['poke-pad'], ['dreepy', 'budew', 'psychic-energy', 'judge', 'ultra-ball', 'drakloak']), 'poke-pad');
    const prizes = s.players[0].prizes.slice();
    const seeds = [1, 2, 3, 4, 5, 6].map((seed) => determinize(s, 0, seed));
    for (const d of seeds) expect(d.players[0].prizes).toEqual(prizes);
    expect(new Set(seeds.map((d) => d.players[0].deck.join())).size).toBeGreaterThan(1);
    // Unknown Prizes are dealt again with the deck.
    const blind = board([], ['dreepy', 'budew', 'psychic-energy', 'judge', 'ultra-ball', 'drakloak']);
    const deals = [1, 2, 3, 4, 5, 6].map((seed) => determinize(blind, 0, seed).players[0].prizes.join());
    expect(new Set(deals).size).toBeGreaterThan(1);
  });
});

describe('cards the opponent saw go to a hand', () => {
  it('a search for a kind of card reveals it; a search for any card does not', () => {
    const revealed = play(board(['poke-pad'], ['dreepy', 'psychic-energy', 'judge']), 'poke-pad');
    expect(revealedHand(revealed.players[0]).map((c) => key(revealed, c))).toEqual(['dreepy']);
    const secret = play(board(['ciphermaniacs-codebreaking'], ['dreepy', 'psychic-energy', 'judge']), 'ciphermaniacs-codebreaking', (st) =>
      st.pending!.request.options.slice(0, st.pending!.request.min || 1).map((o) => o.value),
    );
    expect(revealedHand(secret.players[0])).toEqual([]);
  });

  it('a card taken from the discard pile is known; it stops being known once it leaves the hand', () => {
    const s = play(board(['night-stretcher'], ['psychic-energy', 'judge'], ['dreepy']), 'night-stretcher');
    const dreepy = handCard(s, 0, 'dreepy');
    expect(revealedHand(s.players[0])).toEqual([dreepy]);
    const benched = apply(s, { t: 'bench', card: dreepy });
    expect(revealedHand(benched.players[0])).toEqual([]);
    expect(benched.players[0].revealed ?? []).not.toContain(dreepy);
  });

  it('look-ahead keeps the opponent’s known cards in their hand and deals the rest again', () => {
    const s = play(board(['night-stretcher'], ['psychic-energy', 'judge'], ['dreepy']), 'night-stretcher');
    const dreepy = handCard(s, 0, 'dreepy');
    for (const seed of [1, 2, 3, 4, 5]) {
      const d = determinize(s, 1, seed);
      expect(d.players[0].hand).toContain(dreepy);
      expect(d.players[0].hand.length).toBe(s.players[0].hand.length);
    }
    // The same for a saved game picked up again (the player is 1, the known cards are player 0's).
    expect(redeal(s, 1, 9).players[0].hand).toContain(dreepy);
  });
});

describe('the turn before', () => {
  /** Player 0 benches a Dreepy, attaches an Energy and attacks with Budew (Itchy Pollen, 10) into a Dreepy with `damage`. */
  function turn(damage: number): GameState {
    let s = scenario({
      p0: { active: { card: 'budew', energy: [] }, hand: ['dreepy', 'psychic-energy'] },
      p1: { active: { card: 'dreepy', damage }, bench: ['budew'] },
    });
    // As the start of the turn would have counted (the scenario begins mid-turn).
    s.players[0].turnPrizes = s.players[0].prizes.length;
    s = apply(s, { t: 'bench', card: handCard(s, 0, 'dreepy') });
    s = apply(s, { t: 'energy', card: handCard(s, 0, 'psychic-energy'), target: s.players[0].active!.uid });
    s = apply(s, { t: 'attack', name: 'Itchy Pollen' });
    while (s.pending) s = apply(s, { t: 'choose', picks: [s.pending.request.options[0]!.value] });
    return s;
  }

  it('records the cards played and the attack with its damage', () => {
    const s = turn(0);
    const me = s.players[0];
    expect((me.lastPlayed ?? []).map((c) => key(s, c))).toEqual(['dreepy', 'psychic-energy']);
    expect(me.lastAttack).toEqual({ name: 'Itchy Pollen', damage: 10 });
    expect(me.lastPrizes).toBe(0);
    // The opponent's turn has begun: their record of it is empty so far.
    expect(s.current).toBe(1);
    expect(s.players[1].played ?? []).toEqual([]);
  });

  it('a Knock Out counts the HP the Pokémon had left, and the Prize card taken', () => {
    const me = turn(60).players[0];
    expect(me.lastAttack).toEqual({ name: 'Itchy Pollen', damage: 10 });
    expect(me.lastPrizes).toBe(1);
  });
});
