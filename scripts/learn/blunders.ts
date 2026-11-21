// Loop criterion G3 (BOT-RESEARCH.md): clear mistakes in the bot's own games. The bot (createBot, as the
// play screen has it, or a network file with --weights) plays the hard bot on every deck pair, both seats;
// each of its turns gets the review's check (review.ts sureLine): a line that wins, or takes more Prizes than
// the turn took, on every re-deal of what the bot couldn't see. --fast: the network alone (no look-ahead, so no
// sureLine guard either), as the simulator and the training games play it.
//   npx tsx scripts/learn/blunders.ts --games 240 [--weights .cache/learn/x.json] [--fast] [--threads 4]
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { sureLine } from '../../src/analysis/review';
import { createBot, SEARCH } from '../../src/bots/index';
import { expertModel } from '../lib/experts';
import { makeHardBot } from '../../src/bots/hard';
import { loadModel } from '../../src/bots/learn/model';
import { makeNetBot } from '../../src/bots/learn/netbot';
import { makeSearchNetBot } from '../../src/bots/learn/search';
import { planFor } from '../../src/bots/plans';
import type { Bot } from '../../src/bots/types';
import { actor, apply, createGame } from '../../src/engine/actions';
import { deckKeys } from '../../src/engine/db';
import type { GameState, PlayerId } from '../../src/engine/types';
import { isFree, turnsOf } from '../../src/review/record';
import { loadDeckFiles } from '../lib/decks';
import { runTsWorker } from '../lib/workers';

interface Job {
  games: number[];
  weights?: string;
  fast: boolean;
}
interface Found {
  turns: number;
  win: number;
  ko: number;
  examples: string[];
}

const files = loadDeckFiles('src/content/decks');
const slugs = files.map((f) => f.slug);
const cards = new Map(files.map((f) => [f.slug, deckKeys(f.list.entries)]));

function run(job: Job): Found {
  const model = job.weights ? loadModel(JSON.parse(readFileSync(job.weights, 'utf8'))) : null;
  const out: Found = { turns: 0, win: 0, ko: 0, examples: [] };
  for (const g of job.games) {
    const a = slugs[g % slugs.length]!;
    const b = slugs[Math.floor(g / slugs.length) % slugs.length]!;
    const me = (Math.floor(g / (slugs.length * slugs.length)) % 2) as PlayerId;
    const decks = me === 0 ? [a, b] : [b, a];
    const plans = { mine: planFor(a), theirs: planFor(b) };
    const names = [plans.mine.name, plans.theirs.name] as const;
    const bot: Bot = model
      ? job.fast
        ? makeNetBot(model, { decks: names, seed: g })
        : makeSearchNetBot(model, { decks: names, seed: g, plan: plans.mine, ...SEARCH })
      : createBot(plans.mine, g, plans.theirs, { model: expertModel(a), fast: job.fast });
    const other = makeHardBot(plans.theirs, plans.mine, { seed: g + 7 });
    const bots = me === 0 ? [bot, other] : [other, bot];
    let s: GameState = createGame({ seed: 3_000_000 + g, decks: [{ name: 'a', cards: cards.get(decks[0]!)! }, { name: 'b', cards: cards.get(decks[1]!)! }], quiet: true });
    const states = [s];
    for (let n = 0; s.winner === null && n < 4000; n++) {
      s = apply(s, bots[actor(s)]!.act(s), { trusted: true });
      states.push(s);
    }
    for (const span of turnsOf(states, me)) {
      if (span.end < 0) continue;
      out.turns++;
      const end = states[span.end]!;
      if (end.winner === me) continue;
      for (const at of span.last === span.start ? [span.start] : [span.last, span.start]) {
        const st = states[at]!;
        if (!isFree(st, me)) continue;
        const took = st.players[me].prizes.length - end.players[me].prizes.length;
        const line = sureLine(st, me, plans, 4);
        const kind = line.wins ? 'win' : line.prizes > took && line.prizes > 0 ? 'ko' : null;
        if (kind) {
          out[kind]++;
          if (out.examples.length < 3) out.examples.push(`${a} vs ${b} game ${g} turn ${span.turn}: missed ${kind} (${line.prizes} Prizes vs ${took})`);
          break;
        }
      }
    }
  }
  return out;
}

if (!isMainThread) {
  parentPort!.postMessage(run(workerData as Job));
} else {
  const opt = (name: string) => {
    const k = process.argv.indexOf(`--${name}`);
    return k > 0 ? process.argv[k + 1] : undefined;
  };
  const games = Number(opt('games') ?? 240);
  const threads = Number(opt('threads') ?? Math.max(1, cpus().length - 1));
  const t0 = Date.now();
  const jobs: Job[] = Array.from({ length: threads }, (_, t) => ({ games: Array.from({ length: games }, (_, i) => i).filter((i) => i % threads === t), weights: opt('weights'), fast: process.argv.includes('--fast') }));
  const parts = await Promise.all(jobs.map((j) => runTsWorker<Found>(import.meta.url, j)));
  const turns = parts.reduce((x, p) => x + p.turns, 0);
  const win = parts.reduce((x, p) => x + p.win, 0);
  const ko = parts.reduce((x, p) => x + p.ko, 0);
  console.log(`${games} games, ${turns} turns of the bot: missed win ${win}, missed KO ${ko} (${((ko / Math.max(1, turns)) * 100).toFixed(2)}% of turns) · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const e of parts.flatMap((p) => p.examples).slice(0, 6)) console.log(`  ${e}`);
}
