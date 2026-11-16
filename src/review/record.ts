// A finished game as the review page needs it: everything createGame() took plus the actions, so the
// engine replays it exactly (src/engine is deterministic from the seed). Kept in IndexedDB by store.ts.
import { actor, apply, createGame } from '../engine/actions';
import type { PlayerPolicy } from '../bots/plans';
import type { Action, GameState, PlayerId, Rules } from '../engine/types';

export interface SavedGame {
  /** Set by the store. */
  id?: number;
  savedAt: number;
  seed: number;
  /** Bot deck slug (src/content/decks) and its name. */
  opponent: string;
  opponentName: string;
  /** Bot difficulty of games saved before there was only one bot (unused). */
  level?: string;
  rules: Partial<Rules>;
  /** Your strategy (the plan your side is reviewed with). */
  policy: PlayerPolicy;
  /** Card keys: your list, the bot's list. */
  decks: [string[], string[]];
  actions: Action[];
  winner: PlayerId | 'draw' | null;
  reason: string;
  turns: number;
}

/** states[0] is the new game; states[i + 1] = apply(states[i], actions[i]). */
export function replay(g: SavedGame): GameState[] {
  const states = [
    createGame({
      seed: g.seed,
      decks: [
        { name: 'คุณ', cards: g.decks[0] },
        { name: 'บอท', cards: g.decks[1] },
      ],
      names: ['คุณ', 'บอท'],
      rules: g.rules,
    }),
  ];
  for (const a of g.actions) states.push(apply(states[states.length - 1]!, a, { trusted: true }));
  return states;
}

/** One of your turns, as indices into the replayed states. */
export interface TurnSpan {
  turn: number;
  /** Your first free position of the turn (after your draw). */
  start: number;
  /** Your last free position: where you chose the action that ended the turn. */
  last: number;
  /** The first settled position after the turn passed (the opponent's turn, after their draw), or the end of the game. */
  end: number;
}

/** A free position: `p` may play anything (main phase, nothing pending). */
export const isFree = (s: GameState, p: PlayerId) => s.winner === null && !s.pending && s.phase === 'main' && actor(s) === p;

/** Your turns in a replayed game, in order. A turn the game ended in has `end` = the last state. */
export function turnsOf(states: GameState[], me: PlayerId = 0): TurnSpan[] {
  const out: TurnSpan[] = [];
  let cur: TurnSpan | null = null;
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    if (isFree(s, me)) {
      if (!cur || cur.turn !== s.turn) {
        cur = { turn: s.turn, start: i, last: i, end: -1 };
        out.push(cur);
      } else cur.last = i;
    } else if (cur && cur.end < 0 && (s.winner !== null || (!s.pending && s.current !== me))) {
      cur.end = i;
    }
  }
  if (cur && cur.end < 0) cur.end = states.length - 1;
  return out;
}
