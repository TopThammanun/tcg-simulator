// What the bot did on its last turn, in its own log lines (shown when your turn starts: on a phone the log is in a
// drawer and the animations are quick). The turn's header and its opening draw are left out.
import type { GameState } from '../engine/types';

const HEADER = /^— เทิร์น \d+/;
const DRAW_ONE = / จั่ว 1 ใบ$/;

export function turnRecap(s: GameState, turn: number): string[] {
  const lines = s.log.filter((l) => l.turn === turn && !HEADER.test(l.text));
  const first = lines.findIndex((l) => DRAW_ONE.test(l.text));
  const texts = lines.filter((_, i) => i !== first || first !== 0).map((l) => l.text);
  // The same line in a row once, with a count ("บอท วาง Dreepy บน Bench ×3").
  const out: { text: string; n: number }[] = [];
  for (const t of texts) {
    const last = out[out.length - 1];
    if (last?.text === t) last.n++;
    else out.push({ text: t, n: 1 });
  }
  return out.map((x) => (x.n > 1 ? `${x.text} ×${x.n}` : x.text));
}

/**
 * At most `max` lines: the turn's start and its end (the attack and its Knock Outs come last), what is left out
 * counted in between.
 */
export function shortRecap(lines: string[], max: number): { head: string[]; skipped: number; tail: string[] } {
  if (lines.length <= max) return { head: lines, skipped: 0, tail: [] };
  const tail = Math.ceil(max / 2);
  const head = max - tail;
  return { head: lines.slice(0, head), skipped: lines.length - max, tail: lines.slice(lines.length - tail) };
}

/** The recap to show now: the opponent's turn just before yours, when it is your turn. */
export function lastOpponentTurn(s: GameState, me: 0 | 1 = 0): string[] {
  if (s.phase !== 'main' || s.current !== me || s.turn <= 1) return [];
  return turnRecap(s, s.turn - 1);
}
