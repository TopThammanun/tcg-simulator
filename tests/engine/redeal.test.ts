// Undo in practice mode deals the hidden cards again (engine/view.ts redeal()), so going back never shows the
// cards still to come; a saved game records each re-deal and replays to the same states.
import { describe, expect, it } from 'vitest';
import { makeBot } from '../../src/bots/core';
import { DEFAULT_POLICY, planFor } from '../../src/bots/plans';
import { actor, apply, createGame } from '../../src/engine/actions';
import { knownTopCards } from '../../src/engine/state';
import type { Action, GameState } from '../../src/engine/types';
import { redeal } from '../../src/engine/view';
import { isFree, replay, type Redeal, type SavedGame } from '../../src/review/record';
import { deck, scenario } from './helpers';

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** Bots play both sides from `s` until `stop` (or the game ends); returns the states and actions. */
function playUntil(s: GameState, stop: (s: GameState, n: number) => boolean, seed = 5) {
  const bots = [makeBot(planFor('dragapult-ex'), { seed }), makeBot(planFor('basic-box'), { seed: seed + 1 })];
  const states = [s];
  const actions: Action[] = [];
  for (let n = 0; s.winner === null && n < 3000 && !stop(s, n); n++) {
    const a = bots[actor(s)]!.act(s);
    s = apply(s, a, { trusted: true });
    states.push(s);
    actions.push(a);
  }
  return { states, actions };
}

const newGame = (seed: number) => createGame({ seed, decks: [deck('dragapult-ex'), deck('basic-box')], names: ['คุณ', 'บอท'] });
/** Your first main-phase decision of turn 3 or later. */
const midGame = (seed: number) => {
  const { states } = playUntil(newGame(seed), (s) => s.turn >= 3 && isFree(s, 0));
  return states[states.length - 1]!;
};

describe('redeal (undo in practice mode)', () => {
  it('deals what you cannot see again and keeps everything you can', () => {
    const s = midGame(41);
    const r = redeal(s, 0, 99);
    const [me, them] = [s.players[0], s.players[1]];
    const [me2, them2] = [r.players[0], r.players[1]];
    expect(me2.hand).toEqual(me.hand);
    expect(me2.discard).toEqual(me.discard);
    expect(me2.active).toEqual(me.active);
    expect(me2.bench).toEqual(me.bench);
    expect(them2.active).toEqual(them.active);
    expect(them2.discard).toEqual(them.discard);
    expect(them2.hand.length).toBe(them.hand.length);
    expect(me2.prizes.length).toBe(me.prizes.length);
    expect(sorted([...me2.deck, ...me2.prizes])).toEqual(sorted([...me.deck, ...me.prizes]));
    expect(sorted([...them2.hand, ...them2.deck, ...them2.prizes])).toEqual(sorted([...them.hand, ...them.deck, ...them.prizes]));
    // The cards to come are different: the order of your deck and the coins.
    expect(me2.deck).not.toEqual(me.deck);
    expect(r.rng).not.toEqual(s.rng);
    expect(r.quiet).toBe(s.quiet);
  });

  it('is the same for the same seed and different for another', () => {
    const s = midGame(42);
    expect(redeal(s, 0, 7)).toEqual(redeal(s, 0, 7));
    expect(redeal(s, 0, 7).players[0].deck).not.toEqual(redeal(s, 0, 8).players[0].deck);
  });

  it('keeps the cards each player knows on top of their own deck', () => {
    let s = scenario({
      p0: { active: 'slowking', hand: ['ciphermaniacs-codebreaking'], deck: ['psychic-energy', 'judge', 'paldean-tauros', 'budew', 'ultra-ball'] },
      p1: { active: 'dreepy', deck: ['dreepy', 'drakloak', 'bosss-orders', 'rare-candy'] },
    });
    const card = s.players[0].hand[0]!;
    s = apply(s, { t: 'trainer', card });
    const offered = s.pending!.request.options.map((o) => o.value);
    s = apply(s, { t: 'choose', picks: offered.slice(0, 2) });
    if (s.pending) s = apply(s, { t: 'choose', picks: [offered[1]!, offered[0]!] });
    const top = knownTopCards(s.players[0]);
    expect(top.length).toBe(2);
    for (const seed of [1, 2, 3]) expect(knownTopCards(redeal(s, 0, seed).players[0])).toEqual(top);
  });

  it('a saved game with re-deals replays to the same states', () => {
    // Play to turn 3, "undo" to the first decision of turn 3 by dealing again, play on, re-deal once more later.
    const first = playUntil(newGame(43), (s) => s.turn >= 3 && isFree(s, 0));
    const at1 = first.actions.length;
    const again = redeal(first.states[at1]!, 0, 1234);
    const second = playUntil(again, (s, n) => n > 0 && s.turn >= 5 && isFree(s, 0), 9);
    const at2 = at1 + second.actions.length;
    const third = playUntil(redeal(second.states[second.states.length - 1]!, 0, 5678), () => false, 13);
    const redeals: Redeal[] = [
      { at: at1, seed: 1234 },
      { at: at2, seed: 5678 },
    ];
    const g: SavedGame = {
      savedAt: 0,
      seed: 43,
      opponent: 'basic-box',
      opponentName: 'Basic Box',
      mine: 'dragapult-ex',
      rules: {},
      policy: DEFAULT_POLICY,
      decks: [deck('dragapult-ex').cards, deck('basic-box').cards],
      actions: [...first.actions, ...second.actions, ...third.actions],
      redeals,
      winner: null,
      reason: '',
      turns: 0,
    };
    const states = replay(g);
    const end = third.states[third.states.length - 1]!;
    expect(states[at1]).toEqual(again);
    expect(states[states.length - 1]).toEqual(end);
    // Without the re-deals the same actions don't get there (or don't even fit the cards).
    let differs = true;
    try {
      const plain = replay({ ...g, redeals: [] });
      differs = JSON.stringify(plain[plain.length - 1]) !== JSON.stringify(end);
    } catch {
      /* an action that needs a card the other deal didn't give */
    }
    expect(differs).toBe(true);
  });
});
