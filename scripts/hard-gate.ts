// PLAN.md v3 gate: the hard bot beats the normal bot more than 50% of the time.
// Mirror matches (same deck both sides) over every deck, the tested bot alternating seats.
//   npx tsx scripts/hard-gate.ts --games 1000
//   npx tsx scripts/hard-gate.ts --games 1000 --bot hard --vs normal   (normal or hard)
// Experiments on the hard bot: --samples N --breadth N --refine N. The network bot is measured with
// scripts/learn/gen.ts instead.
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeBot } from '../src/bots/core';
import { evaluate, makeHardBot, makeSearchBot } from '../src/bots/hard';
import { planFor } from '../src/bots/plans';
import type { Bot, DeckPlan } from '../src/bots/types';
import { deckKeys } from '../src/engine/db';
import { playGame } from '../src/sim/game';
import { wilson } from '../src/sim/stats';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

type Kind = 'normal' | 'hard';
interface Tweaks {
  samples?: number;
  breadth?: number;
  refine?: number;
}
interface Job {
  from: number;
  to: number;
  bot: Kind;
  vs: Kind;
  tweaks: Tweaks;
  /** First game seed (change it to measure on games no experiment has seen). */
  base: number;
}

function make(kind: Kind, plan: DeckPlan, seed: number, t: Tweaks = {}): Bot {
  if (kind === 'hard') {
    if (t.samples || t.breadth || t.refine) {
      return makeSearchBot(plan, plan, { seed, value: evaluate, failValue: -1e4, samples: t.samples, breadth: t.breadth, refine: t.refine });
    }
    return makeHardBot(plan, plan, { seed });
  }
  return makeBot(plan, { seed });
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
    const seed = job.base + i;
    const hard = make(job.bot, plan, seed, job.tweaks);
    const normal = make(job.vs, plan, seed + 1);
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
  const opt = (name: string) => {
    const k = process.argv.indexOf(`--${name}`);
    return k > 0 ? process.argv[k + 1] : undefined;
  };
  const games = Number(opt('games') ?? 1000);
  const bot = (opt('bot') ?? 'hard') as Kind;
  const vs = (opt('vs') ?? 'normal') as Kind;
  const num = (name: string) => (opt(name) === undefined ? undefined : Number(opt(name)));
  const tweaks: Tweaks = {
    samples: num('samples'),
    breadth: num('breadth'),
    refine: num('refine'),
  };
  const threads = cpus().length;
  const per = Math.ceil(games / threads);
  const started = Date.now();
  const jobs: Job[] = [];
  for (let t = 0; t < threads; t++) if (t * per < games) jobs.push({ from: t * per, to: Math.min(games, (t + 1) * per), bot, vs, tweaks, base: Number(opt('seed') ?? 50000) });
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
  const tw = Object.entries(tweaks).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`${bot}${tw ? ` (${tw})` : ''} vs ${vs}: ${wins}/${total} wins (${((wins / total) * 100).toFixed(1)}%, 95% CI ${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}), draws ${draws}`);
  for (const [k, [w, n]] of Object.entries(perDeck)) console.log(`  ${k.padEnd(24)} ${w}/${n}`);
  console.log(`max decision ${Math.max(...parts.map((p) => p.maxThink)).toFixed(0)} ms · ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
