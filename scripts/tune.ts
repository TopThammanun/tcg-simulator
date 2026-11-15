// Self-play tuning of the bots' weights (src/bots/params.ts) with SPSA, the way chess engines tune theirs:
// two bots whose weights differ by a small random nudge (+ and −) play the same deal from both seats, and
// every weight moves a little towards the side that won. Many chains run in parallel and are averaged;
// then the tuned weights play the old ones on fresh deals to show whether they really are stronger.
//   npx tsx scripts/tune.ts --iterations 3000 --validate 4000 [--hard 480]
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeBot } from '../src/bots/core';
import { makeHardBot } from '../src/bots/hard';
import { DEFAULT_PARAMS, withParams, type ParamName, type Params } from '../src/bots/params';
import { planFor } from '../src/bots/plans';
import { deckKeys } from '../src/engine/db';
import { playGame } from '../src/sim/game';
import { wilson } from '../src/sim/stats';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

const NAMES = Object.keys(DEFAULT_PARAMS) as ParamName[];
const files = loadDeckFiles('src/content/decks');
const decks = files.map((f) => ({ slug: f.slug, cards: deckKeys(f.list.entries) }));

/** Weights as log-ratios to the defaults (u = 0 is the default; ±0.7 is about ×2 / ÷2). */
const toParams = (u: number[]): Params =>
  Object.fromEntries(NAMES.map((n, i) => [n, DEFAULT_PARAMS[n] * Math.exp(u[i]!)])) as Params;

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One deal played from both seats: points (0–2) for weights `a` against weights `b`. */
function pair(seed: number, a: Params, b: Params, hard: boolean): number {
  const x = decks[seed % decks.length]!;
  const y = decks[Math.floor(seed / decks.length) % decks.length]!;
  let points = 0;
  for (const seatA of [0, 1] as const) {
    const make = (slug: string, other: string, p: Params, s: number) =>
      withParams(hard ? makeHardBot(planFor(slug), planFor(other), { seed: s }) : makeBot(planFor(slug), { seed: s }), p);
    const [d0, d1] = seatA === 0 ? [x, y] : [y, x];
    const bots = seatA === 0 ? [make(d0.slug, d1.slug, a, seed + 1), make(d1.slug, d0.slug, b, seed + 2)] : [make(d0.slug, d1.slug, b, seed + 1), make(d1.slug, d0.slug, a, seed + 2)];
    // The same deal both times: each weight set plays each deck from the same opening.
    const r = playGame({
      seed,
      decks: [
        { name: 'a', cards: d0.cards },
        { name: 'b', cards: d1.cards },
      ],
      bots: bots as [ReturnType<typeof makeBot>, ReturnType<typeof makeBot>],
    });
    if (r.winner === seatA) points += 1;
    else if (r.winner === 'draw' || r.winner === null) points += 0.5;
  }
  return points;
}

type Job =
  | { mode: 'spsa'; seed: number; iterations: number; u: number[] }
  | { mode: 'match'; from: number; to: number; u: number[]; hard: boolean };

function spsa(job: Extract<Job, { mode: 'spsa' }>): number[] {
  const r = rng(job.seed);
  const u = job.u.slice();
  const c = 0.15;
  const A = job.iterations / 10;
  const a = 0.02 * (A + 1) ** 0.602;
  for (let k = 0; k < job.iterations; k++) {
    const delta = u.map(() => (r() < 0.5 ? -1 : 1));
    const plus = toParams(u.map((x, i) => x + c * delta[i]!));
    const minus = toParams(u.map((x, i) => x - c * delta[i]!));
    const score = (pair(job.seed * 7919 + k, plus, minus, false) - 1) / 1; // −1 … +1
    const ak = a / (k + 1 + A) ** 0.602;
    for (let i = 0; i < u.length; i++) u[i] = Math.max(-1.2, Math.min(1.2, u[i]! + (ak * score * delta[i]!) / (2 * c)));
  }
  return u;
}

function match(job: Extract<Job, { mode: 'match' }>): { points: number; games: number } {
  const tuned = toParams(job.u);
  let points = 0;
  for (let i = job.from; i < job.to; i++) points += pair(i, tuned, DEFAULT_PARAMS, job.hard);
  return { points, games: 2 * (job.to - job.from) };
}

if (!isMainThread) {
  const job = workerData as Job;
  parentPort!.postMessage(job.mode === 'spsa' ? spsa(job) : match(job));
} else {
  const opt = (name: string, d: number) => {
    const k = process.argv.indexOf(`--${name}`);
    return k > 0 ? Number(process.argv[k + 1]) : d;
  };
  const threads = cpus().length;
  const iterations = opt('iterations', 3000);
  const t0 = Date.now();
  const chains = await Promise.all(
    Array.from({ length: threads }, (_, t) => runTsWorker<number[]>(import.meta.url, { mode: 'spsa', seed: 1000 + t, iterations, u: NAMES.map(() => 0) } satisfies Job)),
  );
  const u = NAMES.map((_, i) => chains.reduce((sum, ch) => sum + ch[i]!, 0) / chains.length);
  const tuned = toParams(u);
  console.log(`SPSA: ${threads} chains × ${iterations} iterations (${threads * iterations * 2} games) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const [i, n] of NAMES.entries()) {
    const spread = Math.sqrt(chains.reduce((s, ch) => s + (ch[i]! - u[i]!) ** 2, 0) / chains.length);
    console.log(`  ${n.padEnd(22)} ${String(DEFAULT_PARAMS[n]).padStart(6)} → ${tuned[n].toFixed(3).padStart(8)}  (×${Math.exp(u[i]!).toFixed(2)}, chains ±${spread.toFixed(2)})`);
  }

  const measure = async (pairs: number, hard: boolean, base: number) => {
    const per = Math.ceil(pairs / threads);
    const jobs: Job[] = [];
    for (let t = 0; t * per < pairs; t++) jobs.push({ mode: 'match', from: base + t * per, to: base + Math.min(pairs, (t + 1) * per), u, hard });
    const parts = await Promise.all(jobs.map((j) => runTsWorker<{ points: number; games: number }>(import.meta.url, j)));
    const points = parts.reduce((s, p) => s + p.points, 0);
    const games = parts.reduce((s, p) => s + p.games, 0);
    const [lo, hi] = wilson(points, games);
    return `${points}/${games} = ${((points / games) * 100).toFixed(1)}% (95% CI ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)})`;
  };
  console.log(`tuned vs default (ปกติ, fresh deals): ${await measure(opt('validate', 4000) / 2, false, 5_000_000)}`);
  const hardGames = opt('hard', 0);
  if (hardGames) console.log(`tuned vs default (ยาก, fresh deals): ${await measure(hardGames / 2, true, 6_000_000)}`);
  console.log(`\nTuned weights (paste into DEFAULT_PARAMS if they win):\n${JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, Number(tuned[n].toPrecision(3))])), null, 2)}`);
}
