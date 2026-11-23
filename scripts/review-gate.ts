// Game review gate. Bot games between the meta decks (every pairing, both seats); then:
// 1. win% calibration: after each of your turns, the review's win% (the network's value, review.ts winOf,
//    from what you could see) is checked against how the game really ended (scripts/lib/calibration-table.ts).
//    Two kinds of games: your side played by your deck's network (its expert, as strong as the opponent's), and by
//    the rule-based bot (a weaker player than the network expects).
// 2. stability: every turn of the first --stability games is reviewed twice with different re-deals; the
//    verdict (missed-win / missed-ko / better / ok) should be the same at least 90% of the time.
// 3. time: a whole game's review on one thread (the review page splits turns over several workers).
//   npx tsx scripts/review-gate.ts --games 600 --stability 120 [--deals 16] [--seed 90000]
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { reviewTurn, winOf, type Verdict } from '../src/analysis/review';
import { makeBot } from '../src/bots/core';
import { createBot } from '../src/bots/index';
import { expertModel } from './lib/experts';
import { DEFAULT_POLICY, planFor } from '../src/bots/plans';
import { deckKeys } from '../src/engine/db';
import { RULES_VERSION } from '../src/engine/state';
import { replay, turnsOf, type SavedGame } from '../src/review/record';
import { playGame } from '../src/sim/game';
import { calibrationTable, mean, pct, type Prediction } from './lib/calibration-table';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

type Side = 'net' | 'rules';
interface Job {
  from: number;
  to: number;
  /** Games below this index are also reviewed twice (set per worker). */
  stability: number;
  deals: number;
  base: number;
}
interface Result {
  predictions: Record<Side, Prediction[]>;
  /** Verdicts of the two reviews of each turn. */
  verdicts: [Verdict, Verdict][];
  /** Whole-game review time (ms) and your turns in it. */
  times: [number, number][];
}

const files = loadDeckFiles('src/content/decks');
const spec = (slug: string) => ({ name: slug, cards: deckKeys(files.find((d) => d.slug === slug)!.list.entries) });
const decks = files.filter((f) => f.meta.side === 'bot').map((f) => f.slug);

function run(job: Job): Result {
  const out: Result = { predictions: { net: [], rules: [] }, verdicts: [], times: [] };
  for (let i = job.from; i < job.to; i++) {
    // Even games: your side is the network; odd: the rule-based bot. Decks cycle through every pairing.
    const side: Side = i % 2 === 0 ? 'net' : 'rules';
    const k = Math.floor(i / 2);
    const mine = decks[k % decks.length]!;
    const opp = decks[Math.floor(k / decks.length) % decks.length]!;
    const seed = job.base + i;
    const plans = { mine: planFor(mine), theirs: planFor(opp) };
    // Each deck played and judged by its expert, as on the review page.
    const nets = { mine: expertModel(mine), theirs: expertModel(opp) };
    const me = side === 'net' ? createBot(plans.mine, seed + 1, plans.theirs, { fast: true, model: nets.mine }) : makeBot(plans.mine, { seed: seed + 1 });
    const r = playGame({ seed, decks: [spec(mine), spec(opp)], bots: [me, createBot(plans.theirs, seed + 2, plans.mine, { fast: true, model: nets.theirs })], record: true });
    const game: SavedGame = {
      savedAt: 0,
      seed,
      opponent: opp,
      opponentName: opp,
      mine,
      // Played under today's rules: without a version, replay() would play it on under version 1's.
      rules: { version: RULES_VERSION },
      policy: DEFAULT_POLICY,
      decks: [spec(mine).cards, spec(opp).cards],
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
      out.predictions[side].push({ p: winOf(end, 0, plans, { deals: job.deals, seed: seed * 13 + sp.turn }, nets).p, y, game: i });
    }
    if (i < job.stability) {
      const t0 = performance.now();
      const a = spans.map((sp) => reviewTurn(states, game.actions, sp, plans, { deals: job.deals, seed: 1 }, nets));
      out.times.push([performance.now() - t0, spans.length]);
      const b = spans.map((sp) => reviewTurn(states, game.actions, sp, plans, { deals: job.deals, seed: 2 }, nets));
      a.forEach((x, n) => out.verdicts.push([x.verdict, b[n]!.verdict]));
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
  const games = opt('games', 600);
  const stability = Math.min(games, opt('stability', 120));
  const deals = opt('deals', 16);
  const base = opt('seed', 90000);
  const threads = cpus().length;
  const started = Date.now();
  const jobs: Job[] = [];
  const per = Math.ceil(games / threads);
  for (let t = 0; t < threads; t++) if (t * per < games) jobs.push({ from: t * per, to: Math.min(games, (t + 1) * per), stability, deals, base });
  // The twice-reviewed games are the slow ones: each worker takes an equal share of them, from its first game.
  const share = Math.ceil(stability / jobs.length);
  const parts = await Promise.all(jobs.map((j) => runTsWorker<Result>(import.meta.url, { ...j, stability: j.from + Math.min(share, j.to - j.from) })));
  const verdicts = parts.flatMap((p) => p.verdicts);
  const times = parts.flatMap((p) => p.times);

  let failed = 0;
  for (const side of ['net', 'rules'] as const) {
    const predictions = parts.flatMap((p) => p.predictions[side]);
    const who = side === 'net' ? 'your side played by the network' : 'your side played by the rule-based bot';
    console.log(`1${side === 'net' ? 'a' : 'b'}. win% after your turns, ${who}: ${predictions.length} positions, ${deals} re-deals each`);
    const f = calibrationTable(predictions);
    failed += f;
    console.log(f ? `   FAIL: ${f} group(s) outside the 99.5% interval` : '   PASS: every group with n >= 50 inside the 99.5% interval (95% overall)');
  }

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
