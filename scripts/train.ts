// Train the "โปร" bot the way AlphaZero trained Go: the best bot so far plays itself, every position is
// labelled with who went on to win, a value network learns from the latest games, and the new network
// replaces the old one only if a search bot using it beats the current best by a significant margin.
//   npx tsx scripts/train.ts --generations 4 --games 1600 --gate 480
// Games and data go to .cache/train (not committed); the accepted network to src/bots/learn/weights.json,
// one line per generation to data/training-log.md.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { actor, apply, createGame } from '../src/engine/actions';
import { deckKeys } from '../src/engine/db';
import type { GameState, PlayerId } from '../src/engine/types';
import { makeBot } from '../src/bots/core';
import { makeHardBot } from '../src/bots/hard';
import { FEATURES, features } from '../src/bots/learn/features';
import { createNet, fit, fromJson, predict, toJson, type Net, type NetJson } from '../src/bots/learn/net';
import { planFor } from '../src/bots/plans';
import { makeProBot } from '../src/bots/pro';
import type { Bot } from '../src/bots/types';
import { wilson } from '../src/sim/stats';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

// --smoke: a quick run of the whole loop that keeps nothing (own folder, no weights, no log).
const SMOKE = process.argv.includes('--smoke');
const DIR = SMOKE ? '.cache/train-smoke' : '.cache/train';
const WEIGHTS = 'src/bots/learn/weights.json';
const LOG = 'data/training-log.md';
const SIZES = [FEATURES, 48, 24, 1];

/** `pro` with `net: null` is the shipped pro bot (search scored by the hand-made evaluation). */
type Spec = { kind: 'normal' } | { kind: 'hard' } | { kind: 'pro'; net: NetJson | null };
interface Match {
  seed: number;
  decks: [string, string];
  specs: [Spec, Spec];
}
interface Job {
  matches: Match[];
  record: boolean;
}
interface Played {
  winner: PlayerId | 'draw' | null;
  /** Features + label (1 = that side won) for each turn start, both sides' views. */
  rows: number[][];
  maxThink: number;
}

const files = loadDeckFiles('src/content/decks');
const deckCards = new Map(files.map((f) => [f.slug, deckKeys(f.list.entries)]));
const slugs = files.map((f) => f.slug);

function makeFrom(spec: Spec, slug: string, oppSlug: string, seed: number): Bot {
  const plan = planFor(slug);
  const oppPlan = planFor(oppSlug);
  if (spec.kind === 'normal') return makeBot(plan, { seed });
  if (spec.kind === 'hard') return makeHardBot(plan, oppPlan, { seed });
  return makeProBot(plan, oppPlan, { seed, net: spec.net ? fromJson(spec.net) : null });
}

function play(m: Match, record: boolean): Played {
  const plans = [planFor(m.decks[0]), planFor(m.decks[1])];
  const bots = [makeFrom(m.specs[0], m.decks[0], m.decks[1], m.seed + 1), makeFrom(m.specs[1], m.decks[1], m.decks[0], m.seed + 2)];
  let s: GameState = createGame({
    seed: m.seed,
    decks: [
      { name: 'a', cards: deckCards.get(m.decks[0])! },
      { name: 'b', cards: deckCards.get(m.decks[1])! },
    ],
    quiet: true,
  });
  const views: [PlayerId, number[]][] = [];
  let seenTurn = -1;
  let maxThink = 0;
  for (let n = 0; s.winner === null && n < 4000; n++) {
    if (record && !s.pending && s.phase === 'main' && s.turn !== seenTurn) {
      seenTurn = s.turn;
      for (const p of [0, 1] as const) views.push([p, features(s, p, [plans[p]!.name, plans[1 - p]!.name])]);
    }
    const p = actor(s);
    const t0 = performance.now();
    const a = bots[p]!.act(s);
    maxThink = Math.max(maxThink, performance.now() - t0);
    s = apply(s, a, { trusted: true });
  }
  const label = (p: PlayerId) => (s.winner === p ? 1 : s.winner === null || s.winner === 'draw' ? 0.5 : 0);
  return { winner: s.winner, rows: views.map(([p, x]) => [...x, label(p)]), maxThink };
}

if (!isMainThread) {
  const job = workerData as Job;
  parentPort!.postMessage(job.matches.map((m) => play(m, job.record)));
} else {
  await main();
}

// ---------- main thread ----------

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

async function runAll(matches: Match[], record: boolean): Promise<Played[]> {
  const threads = Math.max(1, cpus().length);
  const per = Math.ceil(matches.length / threads);
  const jobs: Job[] = [];
  for (let t = 0; t * per < matches.length; t++) jobs.push({ matches: matches.slice(t * per, (t + 1) * per), record });
  const parts = await Promise.all(jobs.map((j) => runTsWorker<Played[]>(import.meta.url, j)));
  return parts.flat();
}

/** Every deck against every deck (mirrors too), cycling; each pairing played from both seats. */
function matchups(n: number, base: number, a: Spec, b: Spec): Match[] {
  const out: Match[] = [];
  for (let i = 0; out.length < n; i++) {
    const x = slugs[i % slugs.length]!;
    const y = slugs[Math.floor(i / slugs.length) % slugs.length]!;
    const seed = base + i;
    out.push({ seed, decks: [x, y], specs: [a, b] });
    out.push({ seed, decks: [x, y], specs: [b, a] });
  }
  return out.slice(0, n);
}

function saveRows(gen: number, rows: number[][]) {
  const width = FEATURES + 1;
  const buf = new Float32Array(rows.length * width);
  rows.forEach((r, i) => buf.set(r, i * width));
  writeFileSync(`${DIR}/gen-${gen}.f32`, Buffer.from(buf.buffer));
}

function loadRows(gen: number): number[][] {
  const path = `${DIR}/gen-${gen}.f32`;
  if (!existsSync(path)) return [];
  const raw = readFileSync(path);
  const buf = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const width = FEATURES + 1;
  const rows: number[][] = [];
  for (let i = 0; i + width <= buf.length; i += width) rows.push(Array.from(buf.subarray(i, i + width)));
  return rows;
}

function log(line: string) {
  console.log(line);
  if (SMOKE) return;
  if (!existsSync(LOG)) {
    writeFileSync(LOG, '# Training log (scripts/train.ts)\n\nOne line per generation: self-play games, data, network fit, and the gate match.\n\n');
  }
  appendFileSync(LOG, `- ${line}\n`);
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const generations = arg('generations', 3);
  const games = arg('games', 1600);
  const gateGames = arg('gate', 480);
  const window = arg('window', 3);
  const statePath = `${DIR}/state.json`;
  const state: { gen: number } = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { gen: 0 };
  const bundled = JSON.parse(readFileSync(WEIGHTS, 'utf8')) as NetJson;
  let best: Spec = { kind: 'pro', net: bundled.sizes.length ? bundled : null };

  for (let g = 0; g < generations; g++) {
    const gen = state.gen;
    const t0 = Date.now();
    const old = best.kind === 'pro' && best.net ? 'โปร + network รุ่นก่อน' : 'โปร (คะแนนที่เขียนมือ)';
    // 1. Self-play with the best bot so far.
    const played = await runAll(matchups(games, 1_000_000 * (gen + 1), best, best), true);
    const rows = played.flatMap((p) => p.rows);
    saveRows(gen, rows);
    const t1 = Date.now();

    // 2. Fit a network on the latest generations' positions, starting from the current best.
    const data: number[][] = [];
    for (let k = Math.max(0, gen - window + 1); k <= gen; k++) data.push(...loadRows(k));
    for (let i = data.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [data[i], data[j]] = [data[j]!, data[i]!];
    }
    const cut = Math.floor(data.length * 0.9);
    const xs = data.map((r) => r.slice(0, FEATURES));
    const ys = data.map((r) => r[FEATURES]!);
    const prev: Spec = best;
    const net: Net = prev.kind === 'pro' && prev.net ? fromJson(prev.net) : createNet(SIZES, gen + 1);
    fit(net, xs.slice(0, cut), ys.slice(0, cut), { epochs: arg('epochs', 10), lr: 1e-3, batch: 256, seed: gen + 11 });
    let loss = 0;
    let right = 0;
    for (let i = cut; i < data.length; i++) {
      const p = predict(net, xs[i]!);
      const y = ys[i]!;
      loss += -(y * Math.log(p + 1e-12) + (1 - y) * Math.log(1 - p + 1e-12));
      if (y !== 0.5 && (p > 0.5 ? 1 : 0) === y) right++;
    }
    const val = data.length - cut;
    const cand: Spec = { kind: 'pro', net: toJson(net) };
    writeFileSync(`${DIR}/cand-${gen}.json`, JSON.stringify(cand.net));
    const t2 = Date.now();

    // 3. Gate: the candidate against the best, every pairing from both seats.
    const gate = await runAll(matchups(gateGames, 9_000_000 + 10_000 * gen, cand, best), false);
    let wins = 0;
    let draws = 0;
    const ms = matchups(gateGames, 9_000_000 + 10_000 * gen, cand, best);
    gate.forEach((r, i) => {
      const candSeat = ms[i]!.specs[0] === cand ? 0 : 1;
      if (r.winner === candSeat) wins++;
      else if (r.winner === 'draw' || r.winner === null) draws++;
    });
    const score = wins + draws / 2;
    const [lo, hi] = wilson(score, gate.length);
    const promoted = lo > 0.5;
    const think = Math.max(...gate.map((r) => r.maxThink));
    if (promoted) {
      if (!SMOKE) writeFileSync(WEIGHTS, JSON.stringify(cand.net));
      best = cand;
    }
    state.gen = gen + 1;
    writeFileSync(statePath, JSON.stringify(state));
    log(
      `gen ${gen}: self-play ${played.length} games by ${old} → ${rows.length} positions; ` +
        `network on ${data.length} (validation loss ${(loss / val).toFixed(4)}, right ${((right / val) * 100).toFixed(1)}%); ` +
        `new vs ${old}: ${score}/${gate.length} = ${((score / gate.length) * 100).toFixed(1)}% ` +
        `(95% CI ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}) → ${promoted ? 'PROMOTED' : 'kept old'}; ` +
        `slowest decision ${think.toFixed(0)} ms; ${((t1 - t0) / 1000).toFixed(0)}s + ${((t2 - t1) / 1000).toFixed(0)}s + ${((Date.now() - t2) / 1000).toFixed(0)}s`,
    );
  }
}
