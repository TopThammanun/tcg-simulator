// A finished game as the review page needs it: everything createGame() took plus the actions, so the
// engine replays it exactly (src/engine is deterministic from the seed). Kept in IndexedDB by store.ts.
import { botName, tx, youName } from '../i18n';
import { actor, apply, createGame } from '../engine/actions';
import type { PlayerPolicy } from '../bots/plans';
import type { Action, GameState, PlayerId, Rules } from '../engine/types';
import { redeal } from '../engine/view';

/** Practice mode (hints, the threat panel, undo) or a real game (none of them). */
export type PlayMode = 'practice' | 'real';

/** An undo in practice mode: state `at` was dealt again with `seed` (engine/view.ts redeal()). */
export interface Redeal {
  at: number;
  seed: number;
}

export interface SavedGame {
  /** Set by the store. */
  id?: number;
  savedAt: number;
  seed: number;
  /** Bot deck slug (src/content/decks) and its name. */
  opponent: string;
  opponentName: string;
  /** The deck plan your side is reviewed with (a deck slug; your own lists use the nearest meta deck's), and your deck's name. Games saved before you could pick a deck: 'player'. */
  mine?: string;
  mineName?: string;
  mode?: PlayMode;
  /** Undos that dealt the hidden cards again, in order (the actions after each one follow the new deal). */
  redeals?: Redeal[];
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

/** A file of saved games (the review page's export; scripts/analyze-games.ts reads it). */
export interface GamesFile {
  format: 'tcg-sim-games';
  version: 1;
  exported: string;
  games: SavedGame[];
}

export const gamesFile = (games: SavedGame[]): GamesFile => ({
  format: 'tcg-sim-games',
  version: 1,
  exported: new Date().toISOString(),
  games: games.map(({ id: _, ...g }) => g),
});

/** A saved game's end reason (kept in the words of the language it was played in) in the page's language. */
export function reasonText(reason: string): string {
  const pairs: [string, string][] = [
    ['เก็บ Prize ครบ', 'took every Prize card'],
    ['อีกฝั่งไม่มี Pokémon ในสนาม', 'the other side has no Pokémon in play'],
    ['ทั้งสองฝั่งชนะพร้อมกัน', 'both sides won at once'],
    ['คุณ ไม่มีการ์ดให้จั่ว', 'You had no card to draw'],
    ['บอท ไม่มีการ์ดให้จั่ว', 'Bot had no card to draw'],
  ];
  const pair = pairs.find((p) => p.includes(reason));
  const text = pair ? tx(...pair) : reason;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The games in a file made by gamesFile(); throws on anything else. */
export function readGamesFile(text: string): SavedGame[] {
  const f = JSON.parse(text) as Partial<GamesFile>;
  if (f.format !== 'tcg-sim-games' || f.version !== 1 || !Array.isArray(f.games)) throw new Error(tx('ไม่ใช่ไฟล์เกมของโปรแกรมนี้', 'Not a game file from this site'));
  for (const g of f.games) {
    if (typeof g.seed !== 'number' || !Array.isArray(g.actions) || !Array.isArray(g.decks)) throw new Error(tx('ไฟล์เกมเสียหาย', 'The game file is damaged'));
  }
  return f.games;
}

/** states[0] is the new game; states[i + 1] = apply(states[i], actions[i]), each dealt again where `g.redeals` says. */
export function replay(g: SavedGame): GameState[] {
  const states = [
    createGame({
      seed: g.seed,
      decks: [
        { name: youName(), cards: g.decks[0] },
        { name: botName(), cards: g.decks[1] },
      ],
      names: [youName(), botName()],
      // Games saved before rules had a version replay under version 1's (engine/types.ts Rules.version).
      rules: { version: 1, ...g.rules },
    }),
  ];
  const redeals = g.redeals ?? [];
  const dealt = (i: number) => {
    for (const r of redeals) if (r.at === i) states[i] = redeal(states[i]!, 0, r.seed);
  };
  dealt(0);
  for (const a of g.actions) {
    states.push(apply(states[states.length - 1]!, a, { trusted: true }));
    dealt(states.length - 1);
  }
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
