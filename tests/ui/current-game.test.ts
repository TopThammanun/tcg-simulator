// A game being played is kept in this browser after every move; picked up again it is the very same position.
import { afterEach, describe, expect, it } from 'vitest';
import { makeBot } from '../../src/bots/core';
import { DEFAULT_POLICY, planFor } from '../../src/bots/plans';
import { actor, apply, createGame } from '../../src/engine/actions';
import type { Action, GameState } from '../../src/engine/types';
import { clearCurrent, loadCurrent, saveCurrent } from '../../src/review/current';
import { replay, type SavedGame } from '../../src/review/record';
import { deck } from '../engine/helpers';

/** A localStorage for the test (Node has none). */
function fakeStorage() {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('the game in progress', () => {
  it('replays to the same state it was saved at, hidden cards and all', () => {
    fakeStorage();
    const decks = [deck('player'), deck('dragapult-ex')] as const;
    const rules = { pickPrizes: true };
    let s: GameState = createGame({ seed: 42, decks: [...decks], names: ['คุณ', 'บอท'], rules });
    const bots = [makeBot(planFor('player'), { seed: 3 }), makeBot(planFor('dragapult-ex'), { seed: 4 })];
    const actions: Action[] = [];
    for (let i = 0; i < 120 && s.winner === null; i++) {
      const a = bots[actor(s)]!.act(s);
      actions.push(a);
      s = apply(s, a, { trusted: true });
    }
    const game: SavedGame = {
      savedAt: 0,
      seed: 42,
      opponent: 'dragapult-ex',
      opponentName: 'Dragapult ex',
      mine: 'player',
      rules: { ...s.rules },
      policy: DEFAULT_POLICY,
      decks: [decks[0].cards, decks[1].cards],
      actions,
      winner: null,
      reason: '',
      turns: s.turn,
    };
    saveCurrent({ game, botSeed: 7, turn: s.turn });
    const back = loadCurrent()!;
    expect(back.botSeed).toBe(7);
    const states = replay(back.game);
    expect(JSON.stringify(states[states.length - 1])).toBe(JSON.stringify(s));
    clearCurrent();
    expect(loadCurrent()).toBeNull();
  });

  it('without storage nothing breaks: nothing is kept', () => {
    expect(() => saveCurrent({ game: {} as SavedGame, botSeed: 0, turn: 1 })).not.toThrow();
    expect(loadCurrent()).toBeNull();
  });
});
