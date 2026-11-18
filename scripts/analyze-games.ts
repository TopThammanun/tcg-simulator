// The bot's side of games people played against it (the review page's "ดาวน์โหลดทุกเกม" file): every bot turn
// with win% before and after it (the bot's own turn should not lose much), a won game or Prizes it left on
// the table (the attack planner's sure lines), and the whole game log, for finding where the bot plays badly.
//   npx tsx scripts/analyze-games.ts <tcg-sim-games-....json> [--samples 48] [--out report.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { sureLine as sureLineFor } from '../src/bots/finisher';
import { planFor } from '../src/bots/plans';
import { estimateWin } from '../src/analysis/winrate';
import { describeAction } from '../src/ui/play';
import { readGamesFile, replay, turnsOf, type SavedGame } from '../src/review/record';
import type { GameState } from '../src/engine/types';

const args = process.argv.slice(2);
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : d;
};
const file = args.find((a) => a.endsWith('.json'));
if (!file) throw new Error('usage: analyze-games.ts <games.json> [--samples 48] [--out report.md]');
const SAMPLES = Number(opt('samples', '48'));
const OUT = opt('out', file.replace(/\.json$/, '.report.md'));
/** A drop of the bot's win% over its own turn bigger than this is listed as a likely mistake. */
const DROP = 0.15;

const pct = (p: number) => `${Math.round(p * 100)}%`;
const out: string[] = [`# The bot in ${file}`, ''];
let flagged = 0;
let turnsSeen = 0;

function analyze(g: SavedGame, n: number) {
  const states = replay(g);
  const plans = { mine: planFor(g.opponent), theirs: planFor('player', g.policy) };
  const result = g.winner === 1 ? 'bot won' : g.winner === 0 ? 'bot lost' : 'draw';
  out.push(`## Game ${n}: you vs ${g.opponentName} (${result}, ${g.reason}, ${g.turns} turns, seed ${g.seed})`, '');
  out.push('| Turn | Bot played | Win% before → after | Note |', '|---|---|---|---|');
  for (const span of turnsOf(states, 1)) {
    turnsSeen++;
    const start = states[span.start]!;
    const end = states[span.end]!;
    const seed = g.seed * 31 + span.turn;
    const before = estimateWin(start, 1, plans, { samples: SAMPLES, seed }).p;
    const after = end.winner !== null ? (end.winner === 1 ? 1 : 0) : estimateWin(end, 1, plans, { samples: SAMPLES, seed }).p;
    const notes: string[] = [];
    const line = sureLineFor(start, 1, plans.mine, 4);
    const took = start.players[1].prizes.length - end.players[1].prizes.length;
    if (line.wins && end.winner !== 1) notes.push(`**missed a win**: ${line.steps.map((s) => describeAction(start, s.action)).join(' → ')}`);
    else if (line.prizes > took) notes.push(`**left Prizes**: a line takes ${line.prizes}, took ${took}: ${line.steps.map((s) => describeAction(start, s.action)).join(' → ')}`);
    if (before - after > DROP) notes.push(`**win% fell ${pct(before - after)}**`);
    if (notes.length) flagged++;
    const played = g.actions
      .slice(span.start, span.end)
      .map((a, i) => ({ a, s: states[span.start + i]! }))
      .filter(({ a, s }) => a.t !== 'choose' && s.current === 1)
      .map(({ a, s }) => describeAction(s, a));
    out.push(`| ${span.turn} | ${played.join(' · ') || '—'} | ${pct(before)} → ${pct(after)} | ${notes.join('<br>')} |`);
  }
  const last = states[states.length - 1] as GameState;
  out.push('', '<details><summary>Game log</summary>', '', '```');
  for (const e of last.log) out.push(`${String(e.turn).padStart(2)} ${e.text}`);
  out.push('```', '</details>', '');
}

const games = readGamesFile(readFileSync(file, 'utf8'));
games.forEach((g, i) => {
  process.stdout.write(`game ${i + 1}/${games.length}\r`);
  analyze(g, i + 1);
});
out.splice(2, 0, `${games.length} games, ${turnsSeen} bot turns, ${flagged} flagged (missed win, Prizes left, or win% down more than ${pct(DROP)} over the bot's own turn).`, '');
writeFileSync(OUT, out.join('\n'));
console.log(`\n${flagged} of ${turnsSeen} bot turns flagged → ${OUT}`);
