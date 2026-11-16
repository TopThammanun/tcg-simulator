// Phase 7 gate: is "ภัยเทิร์นหน้า" calibrated? Your deck (normal bot) plays every bot deck; at the end of
// each of your turns the threat report predicts, for each of your Pokémon, the chance it is Knocked Out
// on the opponent's next turn. The game then goes on and we see whether it was. Predictions are grouped
// by chance (0–10%, 10–20%, …); the gate passes when every group's predicted mean lies inside the interval
// of how often it happened. Predictions from one game go together (the same Pokémon turn after turn), so
// the interval is a bootstrap over games; ten groups are tested at once, so each gets a 99.5% interval
// (Bonferroni), which a perfectly calibrated model passes 95% of the time. The 95% interval is shown too.
//   npx tsx scripts/threat-gate.ts --games 800              check the corrected chances (seeds from 70000)
//   npx tsx scripts/threat-gate.ts --fit --games 1600       measure raw chances on other games (seeds from
//                                                           400000) and write src/analysis/calibration.json
// Options: --samples 64, --vs hard (a better opponent than the model), --raw (no correction),
// --peek (diagnostic only: keep the opponent's real hand instead of re-dealing it), --seed N.
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { calibration, fitPlatt } from '../src/analysis/calibration';
import { collectKOs, threats, type Deal } from '../src/analysis/threat';
import { makeBot } from '../src/bots/core';
import { makeHardBot } from '../src/bots/hard';
import { planFor } from '../src/bots/plans';
import { actor, apply, createGame } from '../src/engine/actions';
import { deckKeys } from '../src/engine/db';
import { opp, slotsOf } from '../src/engine/state';
import type { Action, GameState, PlayerId, SlotId } from '../src/engine/types';
import { determinize } from '../src/engine/view';
import { loadDeckFiles } from './lib/decks';
import { runTsWorker } from './lib/workers';

interface Job {
  from: number;
  to: number;
  samples: number;
  vs: 'normal' | 'hard';
  base: number;
  /** Use the correction (calibration.json). */
  correct: boolean;
  peek: boolean;
}
/** One prediction: chance the Pokémon is Knocked Out, whether it was, the opponent's deck, how your turn ended, the game. */
type Pair = [number, 0 | 1, string, 'end' | 'attack', number];
/** A prediction waiting for the opponent's turn to finish. */
interface Open {
  base: GameState;
  ending: 'end' | 'attack';
  chance: Map<SlotId, number>;
  prizes: number;
  /** The last settled state seen, and your Pokémon Knocked Out since `base`. */
  settled: GameState;
  ko: SlotId[];
}
interface Result {
  pairs: Pair[];
  /** Predicted Prizes taken vs Prizes actually taken, per turn. */
  prizes: [number, number][];
  ms: number[];
}

const files = loadDeckFiles('src/content/decks');
const spec = (slug: string) => ({ name: slug, cards: deckKeys(files.find((d) => d.slug === slug)!.list.entries) });
const opponents = files.filter((f) => f.meta.side === 'bot').map((f) => f.slug);
const ME: PlayerId = 0;

/** determinize(), then the opponent's real hand put back (deck and Prizes stay re-dealt). */
const peekHand: Deal = (s, me, seed) => {
  const d = determinize(s, me, seed);
  const real = s.players[opp(me)].hand;
  const them = d.players[opp(me)];
  const rest = [...them.hand, ...them.deck, ...them.prizes].filter((c) => !real.includes(c));
  them.hand = real.slice();
  them.deck = rest.slice(0, them.deck.length);
  them.prizes = rest.slice(them.deck.length);
  return d;
};

function run(job: Job): Result {
  const out: Result = { pairs: [], prizes: [], ms: [] };
  for (let i = job.from; i < job.to; i++) {
    const oppSlug = opponents[i % opponents.length]!;
    const seed = job.base + i;
    const plans = { mine: planFor('player'), theirs: planFor(oppSlug) };
    const bots = [
      makeBot(plans.mine, { seed: seed + 1 }),
      job.vs === 'hard' ? makeHardBot(plans.theirs, plans.mine, { seed: seed + 2 }) : makeBot(plans.theirs, { seed: seed + 2 }),
    ];
    let s = createGame({ seed, decks: [spec('player'), spec(oppSlug)], quiet: true });
    // The last position where you were free to act, and what you did from there.
    let free: GameState | null = null;
    let since: { p: PlayerId; a: Action }[] = [];
    let open: Open | null = null;
    let guard = 0;
    while (s.winner === null && guard++ < 4000) {
      if (!s.pending && s.phase === 'main' && s.current === ME) {
        if (open) close(open, s, out, oppSlug, i);
        open = null;
        free = s;
        since = [];
      }
      const p = actor(s);
      const a = bots[p]!.act(s);
      since.push({ p, a });
      s = apply(s, a, { trusted: true });
      if (open && !s.pending) {
        collectKOs(open.settled, s, ME, open.ko);
        open.settled = s;
      }
      // Your turn just ended (by ending it or attacking): predict from the last free position.
      if (!open && free && !s.pending && s.winner === null && s.current !== ME && (since[0]!.a.t === 'end' || since[0]!.a.t === 'attack')) {
        const ending = { action: since[0]!.a, picks: since.slice(1).filter((x) => x.p === ME && x.a.t === 'choose').map((x) => (x.a as { picks: number[] }).picks) };
        const t0 = performance.now();
        const r = threats(free, ME, plans, {
          samples: job.samples,
          seed: seed * 31 + free.turn,
          ending,
          deal: job.peek ? peekHand : undefined,
          theirDeck: job.correct ? oppSlug : undefined,
        });
        out.ms.push(performance.now() - t0);
        const ko: SlotId[] = [];
        collectKOs(free, s, ME, ko);
        open = {
          base: free,
          ending: since[0]!.a.t === 'end' ? 'end' : 'attack',
          chance: new Map(r.slots.map((x) => [x.uid, x.chance])),
          prizes: r.expected,
          settled: s,
          ko,
        };
        free = null;
      }
    }
    if (open) close(open, s, out, oppSlug, i);
  }
  return out;
}

function close(o: Open, now: GameState, out: Result, deck: string, game: number) {
  for (const sl of slotsOf(o.base.players[ME])) out.pairs.push([o.chance.get(sl.uid) ?? 0, o.ko.includes(sl.uid) ? 1 : 0, deck, o.ending, game]);
  out.prizes.push([o.prizes, o.base.players[1].prizes.length - now.players[1].prizes.length]);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Intervals of the share of hits in `xs` (95% and 99.5%), resampling whole games (seeded, so the gate is repeatable). */
function bootstrap(xs: Pair[], reps = 4000): { ci95: [number, number]; ci995: [number, number] } {
  const byGame = new Map<number, [number, number]>();
  for (const [, y, , , g] of xs) {
    const t = byGame.get(g) ?? [0, 0];
    t[0] += y;
    t[1] += 1;
    byGame.set(g, t);
  }
  const games = [...byGame.values()];
  let r = 0x2545f491;
  const rand = () => {
    r ^= r << 13;
    r ^= r >>> 17;
    r ^= r << 5;
    return (r >>> 0) / 4294967296;
  };
  const shares: number[] = [];
  for (let k = 0; k < reps; k++) {
    let hits = 0;
    let n = 0;
    for (let j = 0; j < games.length; j++) {
      const [h, m] = games[Math.floor(rand() * games.length)]!;
      hits += h;
      n += m;
    }
    shares.push(hits / n);
  }
  shares.sort((a, b) => a - b);
  const at = (q: number) => shares[Math.min(reps - 1, Math.floor(reps * q))]!;
  return { ci95: [at(0.025), at(0.975)], ci995: [at(0.0025), at(0.9975)] };
}
const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);

if (!isMainThread) {
  parentPort!.postMessage(run(workerData as Job));
} else {
  const opt = (name: string) => {
    const k = process.argv.indexOf(`--${name}`);
    return k > 0 ? process.argv[k + 1] : undefined;
  };
  const flag = (name: string) => process.argv.includes(`--${name}`);
  const fit = flag('fit');
  const games = Number(opt('games') ?? (fit ? 1600 : 800));
  const samples = Number(opt('samples') ?? 64);
  const vs = (opt('vs') ?? 'normal') as Job['vs'];
  const base = Number(opt('seed') ?? (fit ? 400000 : 70000));
  const peek = flag('peek');
  const correct = !fit && !peek && !flag('raw');
  const threads = cpus().length;
  const per = Math.ceil(games / threads);
  const started = Date.now();
  const jobs: Job[] = [];
  for (let t = 0; t < threads; t++) if (t * per < games) jobs.push({ from: t * per, to: Math.min(games, (t + 1) * per), samples, vs, base, correct, peek });
  const parts = await Promise.all(jobs.map((j) => runTsWorker<Result>(import.meta.url, j)));
  const pairs = parts.flatMap((p) => p.pairs);
  const prizes = parts.flatMap((p) => p.prizes);
  const ms = parts.flatMap((p) => p.ms).sort((a, b) => a - b);
  const what = peek ? 'peeking at their hand' : correct ? 'corrected chances' : 'raw chances';
  console.log(`${games} games vs ${vs} bots from seed ${base}, ${samples} samples per prediction, ${what}: ${pairs.length} predictions, ${prizes.length} turns`);

  if (fit) {
    const table = { samples, decks: {} as Record<string, [number, number]> };
    for (const d of opponents) {
      // Only the predictions that sampled any Knock Out: a sampled 0 is shown as 0.
      table.decks[d] = fitPlatt(pairs.filter(([p, , k]) => k === d && p > 0).map(([p, y]) => [p, y]), samples);
      const at = calibration(d, table)!;
      console.log(`  ${d.padEnd(24)} [${table.decks[d]!.join(', ')}] sampled 25% → ${pct(at(0.25))}, 50% → ${pct(at(0.5))}, 75% → ${pct(at(0.75))}, 100% → ${pct(at(1))}`);
    }
    writeFileSync('src/analysis/calibration.json', `${JSON.stringify(table, null, 2)}\n`);
    console.log(`wrote src/analysis/calibration.json · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } else {
    console.log('chance     n      predicted  happened (95% CI; 99.5% CI)');
    let failed = 0;
    for (let b = 0; b < 10; b++) {
      const inB = pairs.filter(([p]) => (b === 9 ? p >= 0.9 : p >= b / 10 && p < (b + 1) / 10));
      if (!inB.length) continue;
      const pred = mean(inB.map(([p]) => p));
      const hits = inB.reduce((t, [, y]) => t + y, 0);
      const { ci95, ci995 } = bootstrap(inB);
      const [lo, hi] = ci995;
      const ok = inB.length < 50 || (pred >= lo && pred <= hi);
      if (!ok) failed++;
      const label = `${b * 10}–${b * 10 + 10}%`.padEnd(10);
      console.log(`${label} ${String(inB.length).padEnd(6)} ${pct(pred).padStart(8)}  ${pct(hits / inB.length).padStart(7)} (${pct(ci95[0])}–${pct(ci95[1])}; ${pct(lo)}–${pct(hi)})${inB.length < 50 ? ' few' : ok ? '' : '  ✗'}`);
    }
    // Per deck and per kind of turn end, over the uncertain predictions (10–90%).
    const mid = (f: (x: Pair) => boolean) => {
      const xs = pairs.filter((x) => f(x) && x[0] >= 0.1 && x[0] < 0.9);
      return `n ${String(xs.length).padEnd(5)} predicted ${pct(mean(xs.map(([p]) => p)))} happened ${pct(mean(xs.map(([, y]) => y)))}`;
    };
    for (const d of opponents) console.log(`  ${d.padEnd(24)} 10–90%: ${mid((x) => x[2] === d)}`);
    for (const e of ['end', 'attack'] as const) console.log(`  turns ending by ${e.padEnd(8)} 10–90%: ${mid((x) => x[3] === e)}`);
    const brier = mean(pairs.map(([p, y]) => (p - y) ** 2));
    const avg = mean(pairs.map(([, y]) => y));
    console.log(`Brier ${brier.toFixed(4)} (always guessing the average: ${mean(pairs.map(([, y]) => (avg - y) ** 2)).toFixed(4)})`);
    console.log(`Prizes per opponent turn: predicted ${mean(prizes.map(([p]) => p)).toFixed(3)}, happened ${mean(prizes.map(([, r]) => r)).toFixed(3)}`);
    console.log(failed ? `FAIL: ${failed} group(s) with n >= 50 predict outside the 99.5% interval of what happened` : 'PASS: every group with n >= 50 predicts inside the 99.5% interval of what happened (95% overall)');
  }
  console.log(`time per prediction: median ${ms[Math.floor(ms.length / 2)]!.toFixed(0)} ms, p95 ${ms[Math.floor(ms.length * 0.95)]!.toFixed(0)} ms, max ${ms[ms.length - 1]!.toFixed(0)} ms · ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
