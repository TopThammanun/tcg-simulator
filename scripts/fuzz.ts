// Fuzz gate: random legal moves across every deck pairing, invariants checked after every action.
//   npm run fuzz -- --games 10000          (PLAN.md Phase 1 gate)
//   npm run fuzz -- --games 1 --seed 1234  (debug one game; prints the failure)
// Failures are saved to tests/regressions/*.json and replayed by tests/engine/regressions.test.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { deckKeys } from '../src/engine/db';
import type { DeckSpec } from '../src/engine/types';
import { fuzzGame, type FuzzFailure } from '../src/sim/fuzz';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

interface Job {
  from: number;
  to: number;
  seed: number;
}

const decks: DeckSpec[] = loadDeckFiles('src/content/decks').map((d) => ({ name: d.slug, cards: deckKeys(d.list.entries) }));
const pairOf = (i: number): [DeckSpec, DeckSpec] => {
  const n = decks.length;
  return [decks[i % n]!, decks[Math.floor(i / n) % n]!];
};

function runRange(job: Job) {
  let turns = 0;
  let actions = 0;
  const failures: FuzzFailure[] = [];
  for (let i = job.from; i < job.to; i++) {
    const r = fuzzGame(job.seed + i, pairOf(i));
    turns += r.turns;
    actions += r.actions;
    if (r.failure) failures.push(r.failure);
  }
  return { games: job.to - job.from, turns, actions, failures };
}

if (!isMainThread) {
  parentPort!.postMessage(runRange(workerData as Job));
} else {
  const arg = (name: string, d: number) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? Number(process.argv[i + 1]) : d;
  };
  const games = arg('games', 10000);
  const seed = arg('seed', 1);
  const threads = Math.max(1, Math.min(arg('threads', cpus().length), games));
  const started = Date.now();

  const per = Math.ceil(games / threads);
  const jobs: Job[] = [];
  for (let t = 0; t < threads; t++) {
    const from = t * per;
    const to = Math.min(games, from + per);
    if (from < to) jobs.push({ from, to, seed });
  }
  const results =
    threads === 1
      ? [runRange(jobs[0]!)]
      : await Promise.all(jobs.map((job) => runTsWorker<ReturnType<typeof runRange>>(import.meta.url, job)));

  const total = results.reduce(
    (a, r) => ({ games: a.games + r.games, turns: a.turns + r.turns, actions: a.actions + r.actions }),
    { games: 0, turns: 0, actions: 0 },
  );
  const failures = results.flatMap((r) => r.failures);
  const secs = (Date.now() - started) / 1000;
  console.log(
    `${total.games} games in ${secs.toFixed(1)}s on ${threads} threads · avg ${(total.turns / total.games).toFixed(1)} turns, ` +
      `${(total.actions / total.games).toFixed(0)} actions · failures: ${failures.length}`,
  );
  if (failures.length) {
    mkdirSync('tests/regressions', { recursive: true });
    for (const f of failures.slice(0, 20)) {
      const file = `tests/regressions/fuzz-${f.seed}.json`;
      writeFileSync(file, JSON.stringify(f, null, 1));
      console.log(`\nseed ${f.seed} ${f.decks.join(' vs ')} after ${f.actions.length} actions -> ${file}`);
      console.log('  last action:', JSON.stringify(f.actions[f.actions.length - 1]));
      for (const p of f.problems.slice(0, 5)) console.log('  ' + p);
      if (f.error) console.log('  ' + f.error.split('\n').slice(0, 6).join('\n  '));
    }
    process.exitCode = 1;
  }
}
