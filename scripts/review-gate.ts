// Phase 8 gate (game review). Your deck (normal bot) plays every bot deck; then:
// 1. win% calibration: after each of your turns, the review's win% (winrate.ts, from what you could see) is
//    checked against how the game really ended (scripts/lib/calibration-table.ts).
// 2. stability: every turn of the first --stability games is reviewed twice with different seeds; the
//    verdict (missed-win / missed-ko / better / ok) should be the same at least 90% of the time.
// 3. time: a whole game's review on one thread (the review page splits turns over several workers).
//   npx tsx scripts/review-gate.ts --games 300 --stability 160 [--samples 48] [--seed 90000]
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { reviewTurn, type Verdict } from '../src/analysis/review';
import { estimateWin } from '../src/analysis/winrate';
import { makeBot } from '../src/bots/core';
import { DEFAULT_POLICY, planFor } from '../src/bots/plans';
import { deckKeys } from '../src/engine/db';
import { replay, turnsOf, type SavedGame } from '../src/review/record';
import { playGame } from '../src/sim/game';
import { calibrationTable, mean, pct, type Prediction } from './lib/calibration-table';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

interface Job {
  from: number;
  to: number;
  /** Games below this index are also reviewed twice (set per worker). */
  stability: number;
  samples: number;
  base: number;
}
interface Result {
  predictions: Prediction[];
  /** Verdicts of the two reviews of each turn. */
  verdicts: [Verdict, Verdict][];
  /** Whole-game review time (ms) and your turns in it. */
  times: [number, number][];
}

const files = loadDeckFiles('src/content/decks');
const spec = (slug: string) => ({ name: slug, cards: deckKeys(files.find((d) => d.slug === slug)!.list.entries) });
const opponents = files.filter((f) => f.meta.side === 'bot').map((f) => f.slug);

function run(job: Job): Result {
  const out: Result = { predictions: [], verdicts: [], times: [] };
  for (let i = job.from; i < job.to; i++) {
    const opp = opponents[i % opponents.length]!;
    const seed = job.base + i;
    const plans = { mine: planFor('player'), theirs: planFor(opp) };
    const r = playGame({ seed, decks: [spec('player'), spec(opp)], bots: [makeBot(plans.mine, { seed: seed + 1 }), makeBot(plans.theirs, { seed: seed + 2 })], record: true });
    const game: SavedGame = {
      savedAt: 0,
      seed,
      opponent: opp,
      opponentName: opp,
      rules: {},
      policy: DEFAULT_POLICY,
      decks: [spec('player').cards, spec(opp).cards],
      actions: r.history!,
      winner: r.winner,
      reason: r.reason,
      turns: r.turns,
    };
    const states = replay(game);
    const y = r.winner === 0 ? 1 : r.winner === 1 ? 0 : 0.5;
    const spans = turnsOf(states);
    for (const sp of spans) {
      const end = states[sp.end]!;
      if (end.winner !== null) continue; // a decided game says nothing about calibration
      out.predictions.push({ p: estimateWin(end, 0, plans, { samples: job.samples, seed: seed * 13 + sp.turn }).p, y, game: i });
    }
    if (i < job.stability) {
      const t0 = performance.now();
      const a = spans.map((sp) => reviewTurn(states, game.actions, sp, plans, { samples: job.samples, seed: 1, theirDeck: opp }));
      out.times.push([performance.now() - t0, spans.length]);
      const b = spans.map((sp) => reviewTurn(states, game.actions, sp, plans, { samples: job.samples, seed: 2, theirDeck: opp }));
      a.forEach((x, k) => out.verdicts.push([x.verdict, b[k]!.verdict]));
    }
  }
  return out;
}

if (!isMainThread) {
  parentPort!.postMessage(run(workerData as Job));
} else {
  const opt = (name: string, d: number) => {
    const k = process.argv.indexOf(`--${name}`);
    return k > 0 ? Number(process.argv[k + 1]) : d;
  };
  const games = opt('games', 300);
  const stability = Math.min(games, opt('stability', 160));
  const samples = opt('samples', 48);
  const base = opt('seed', 90000);
  const threads = cpus().length;
  const started = Date.now();
  const jobs: Job[] = [];
  const per = Math.ceil(games / threads);
  for (let t = 0; t < threads; t++) if (t * per < games) jobs.push({ from: t * per, to: Math.min(games, (t + 1) * per), stability, samples, base });
  // The twice-reviewed games are the slow ones: each worker takes an equal share of them, from its first game.
  const share = Math.ceil(stability / jobs.length);
  const parts = await Promise.all(jobs.map((j) => runTsWorker<Result>(import.meta.url, { ...j, stability: j.from + Math.min(share, j.to - j.from) })));
  const predictions = parts.flatMap((p) => p.predictions);
  const verdicts = parts.flatMap((p) => p.verdicts);
  const times = parts.flatMap((p) => p.times);

  console.log(`1. win% after your turns: ${games} games from seed ${base}, ${samples} played-out games each, ${predictions.length} positions`);
  const failed = calibrationTable(predictions);
  console.log(failed ? `   FAIL: ${failed} group(s) outside the 99.5% interval` : '   PASS: every group with n >= 50 inside the 99.5% interval (95% overall)');

  const same = verdicts.filter(([a, b]) => a === b).length;
  const flagged = verdicts.filter(([a, b]) => a !== 'ok' || b !== 'ok');
  const flaggedSame = flagged.filter(([a, b]) => a === b).length;
  console.log(`2. verdicts, two seeds: ${verdicts.length} turns of ${times.length} games, same ${pct(same / Math.max(1, verdicts.length))} → ${same / Math.max(1, verdicts.length) >= 0.9 ? 'PASS' : 'FAIL'} (gate: 90%)`);
  console.log(`   turns flagged by either review: ${flagged.length}, flagged the same by both ${pct(flaggedSame / Math.max(1, flagged.length))}`);
  for (const v of ['missed-win', 'missed-ko', 'better'] as const) {
    const either = verdicts.filter(([a, b]) => a === v || b === v);
    console.log(`   ${v.padEnd(10)} in either ${String(either.length).padEnd(4)} in both ${either.filter(([a, b]) => a === b).length}`);
  }
  const ms = times.map(([t]) => t).sort((a, b) => a - b);
  const perTurn = mean(times.map(([t, n]) => t / Math.max(1, n)));
  console.log(`3. one game's review on one thread: median ${(ms[Math.floor(ms.length / 2)]! / 1000).toFixed(1)} s, max ${(ms[ms.length - 1]! / 1000).toFixed(1)} s, ${(perTurn / 1000).toFixed(2)} s per turn of yours`);
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
}
