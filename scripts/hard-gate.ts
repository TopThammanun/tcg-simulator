// PLAN.md v3 gate: the hard bot beats the normal bot more than 50% of the time.
// Mirror matches (same deck both sides) over every deck, hard bot alternating seats.
//   npx tsx scripts/hard-gate.ts --games 1000
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeBot } from '../src/bots/core';
import { makeHardBot } from '../src/bots/hard';
import { planFor } from '../src/bots/plans';
import { deckKeys } from '../src/engine/db';
import { playGame } from '../src/sim/game';
import { wilson } from '../src/sim/stats';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

interface Job {
  from: number;
  to: number;
}

const files = loadDeckFiles('src/content/decks');
const decks = files.map((f) => ({ slug: f.slug, cards: deckKeys(f.list.entries) }));

function run(job: Job) {
  let hardWins = 0;
  let draws = 0;
  let maxThink = 0;
  const perDeck: Record<string, [number, number]> = {};
  for (let i = job.from; i < job.to; i++) {
    const d = decks[i % decks.length]!;
    const hardSeat = (Math.floor(i / decks.length) % 2) as 0 | 1;
    const plan = planFor(d.slug);
    const seed = 50000 + i;
    const hard = makeHardBot(plan, plan, { seed });
    const normal = makeBot(plan, { seed: seed + 1 });
    const r = playGame({
      seed,
      decks: [
        { name: 'a', cards: d.cards },
        { name: 'b', cards: d.cards },
      ],
      bots: hardSeat === 0 ? [hard, normal] : [normal, hard],
    });
    const won = r.winner === hardSeat;
    if (won) hardWins++;
    if (r.winner === 'draw' || r.winner === null) draws++;
    maxThink = Math.max(maxThink, r.maxThinkMs);
    const pd = (perDeck[d.slug] ??= [0, 0]);
    pd[0] += won ? 1 : 0;
    pd[1] += 1;
  }
  return { games: job.to - job.from, hardWins, draws, maxThink, perDeck };
}

if (!isMainThread) {
  parentPort!.postMessage(run(workerData as Job));
} else {
  const i = process.argv.indexOf('--games');
  const games = i > 0 ? Number(process.argv[i + 1]) : 1000;
  const threads = cpus().length;
  const per = Math.ceil(games / threads);
  const started = Date.now();
  const jobs: Job[] = [];
  for (let t = 0; t < threads; t++) if (t * per < games) jobs.push({ from: t * per, to: Math.min(games, (t + 1) * per) });
  const parts = await Promise.all(jobs.map((j) => runTsWorker<ReturnType<typeof run>>(import.meta.url, j)));
  const total = parts.reduce((a, p) => a + p.games, 0);
  const wins = parts.reduce((a, p) => a + p.hardWins, 0);
  const draws = parts.reduce((a, p) => a + p.draws, 0);
  const ci = wilson(wins + draws / 2, total);
  const perDeck: Record<string, [number, number]> = {};
  for (const p of parts) for (const [k, [w, n]] of Object.entries(p.perDeck)) {
    const x = (perDeck[k] ??= [0, 0]);
    x[0] += w;
    x[1] += n;
  }
  console.log(`hard vs normal: ${wins}/${total} wins (${((wins / total) * 100).toFixed(1)}%, 95% CI ${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}), draws ${draws}`);
  for (const [k, [w, n]] of Object.entries(perDeck)) console.log(`  ${k.padEnd(24)} ${w}/${n}`);
  console.log(`max decision ${Math.max(...parts.map((p) => p.maxThink)).toFixed(0)} ms · ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
