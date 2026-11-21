// The game being played, kept in this browser after every move so a reload, a slip of the back button or a closed
// tab doesn't lose it: the same record as a saved game (seed, lists, moves, re-deals), so replay() rebuilds the very
// same position (nothing is dealt again). Cleared when the game ends (it is then saved for the review) or is left.
import type { SavedGame } from './record';

const KEY = 'tcg-sim:current-game';

/** A game not finished yet, and what the play screen needs to go on with it. */
export interface CurrentGame {
  game: SavedGame;
  /** The bot deck's seed for its moves. */
  botSeed: number;
  /** The turn it was at (shown on the match sheet). */
  turn: number;
  /** Picked up from a saved game at this turn (play.ts: "เล่นต่อจากเกมที่บันทึกไว้"). */
  resumedFrom?: { id: number; turn: number } | null;
}

export function saveCurrent(c: CurrentGame): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage blocked or full: the game just isn't kept */
  }
}

export function loadCurrent(): CurrentGame | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as CurrentGame | null;
    if (!c || typeof c.game?.seed !== 'number' || !Array.isArray(c.game.actions) || !Array.isArray(c.game.decks)) return null;
    return c;
  } catch {
    return null;
  }
}

export function clearCurrent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
