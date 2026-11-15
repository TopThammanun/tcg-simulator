// Random-move games with invariants checked after every action (PLAN.md: fuzz test).
import { makeRand, randomAction } from '../bots/random';
import { apply, createGame } from '../engine/actions';
import { checkInvariants } from '../engine/invariants';
import type { Action, DeckSpec, GameState } from '../engine/types';

export interface FuzzFailure {
  seed: number;
  decks: [string, string];
  actions: Action[];
  problems: string[];
  error?: string;
}

export interface FuzzResult {
  winner: GameState['winner'];
  turns: number;
  actions: number;
  failure?: FuzzFailure;
}

const MAX_ACTIONS = 20000;

export function fuzzGame(seed: number, decks: [DeckSpec, DeckSpec]): FuzzResult {
  const rand = makeRand(seed ^ 0x5bd1e995);
  const actions: Action[] = [];
  const fail = (problems: string[], error?: string): FuzzResult => ({
    winner: null,
    turns: 0,
    actions: actions.length,
    failure: { seed, decks: [decks[0].name, decks[1].name], actions, problems, error },
  });
  let s: GameState;
  try {
    s = createGame({ seed, decks, quiet: true });
  } catch (e) {
    return fail([], String((e as Error).stack ?? e));
  }
  while (s.winner === null) {
    if (actions.length > MAX_ACTIONS) return fail([`no winner after ${MAX_ACTIONS} actions`]);
    const a = randomAction(s, rand);
    actions.push(a);
    try {
      s = apply(s, a);
    } catch (e) {
      return fail([], String((e as Error).stack ?? e));
    }
    // A pending state is part-way through an action; check once the action has finished.
    if (s.pending) continue;
    const problems = checkInvariants(s);
    if (problems.length) return fail(problems);
  }
  return { winner: s.winner, turns: s.turn, actions: actions.length };
}

/** Rebuild the state a failure ended in (for regression tests). */
export function replay(seed: number, decks: [DeckSpec, DeckSpec], actions: Action[]): GameState {
  let s = createGame({ seed, decks, quiet: true });
  for (const a of actions) s = apply(s, a);
  return s;
}
