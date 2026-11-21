// How each deck is piloted (BOT-NEXT.md N0), beyond win rate: share of its own turns with an attack, Prize cards per
// own turn, its most used attacks, and Slowking's combo (Seek Inspiration per own turn from its 4th turn on,
// and how often the top card had an attack to copy). Read from the actions, not the log.
//   npx tsx scripts/learn/deck-skills.ts [--weights <file or expert set>] [--games 8] [--decks slowking,...] [--json out.json]
// Default players: the game's bot without look-ahead (each deck's expert or the bundled network). --games is per
// ordered deck pair; both seats are played with the same deal.
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createBot, MODEL } from '../../src/bots';
import { loadModel, type Model, type ModelJson } from '../../src/bots/learn/model';
import { planFor } from '../../src/bots/plans';
import { actor, apply, createGame } from '../../src/engine/actions';
import { def, deckKeys, hasRuleBox, isPokemon } from '../../src/engine/db';
import { keyOf, topDef } from '../../src/engine/state';
import type { GameState, PlayerId } from '../../src/engine/types';
import { loadDeckFiles } from '../lib/decks';
import { expertModel, expertWeights } from '../lib/experts';
import { runTsWorker } from '../lib/workers';

interface Job {
  games: { a: string; b: string; seed: number }[];
  weights?: string;
}

interface Skill {
  games: number;
  wins: number;
  turns: number;
  attackTurns: number;
  prizes: number;
  attacks: Record<string, number>;
  /** Slowking: own turns from its 4th, Seek Inspiration used in them; every Seek Inspiration and those with an attack on top. */
  lateTurns: number;
  lateSeek: number;
  seek: number;
  seekHit: number;
}

const blank = (): Skill => ({ games: 0, wins: 0, turns: 0, attackTurns: 0, prizes: 0, attacks: {}, lateTurns: 0, lateSeek: 0, seek: 0, seekHit: 0 });
const files = loadDeckFiles('src/content/decks');
const cards = new Map(files.map((f) => [f.slug, deckKeys(f.list.entries)]));

/** Seek Inspiration copies an attack only from a Pokémon without a Rule Box that has one (attacks.ts). */
function seekHits(s: GameState, me: PlayerId): boolean {
  const top = s.players[me].deck[0];
  if (top === undefined) return false;
  const k = keyOf(s, top);
  return isPokemon(k) && !hasRuleBox(k) && (def(k) as { attacks?: unknown[] }).attacks!.length > 0;
}

function play(job: Job): Record<string, Skill> {
  const models = new Map<string, Model | null>();
  const modelFor = (slug: string): Model | null => {
    if (!job.weights) return expertModel(slug) ?? MODEL;
    const w = expertWeights(job.weights, slug);
    if (!models.has(w)) models.set(w, loadModel(JSON.parse(readFileSync(w, 'utf8')) as ModelJson));
    return models.get(w)!;
  };
  const out: Record<string, Skill> = {};
  for (const g of job.games) {
    for (const seat of [0, 1] as const) {
      const decks = seat === 0 ? [g.a, g.b] : [g.b, g.a];
      const bots = decks.map((d, i) => createBot(planFor(d), g.seed * 2 + i, planFor(decks[1 - i]!), { fast: true, model: modelFor(d) }));
      let s = createGame({ seed: g.seed, decks: decks.map((d) => ({ name: d, cards: cards.get(d)! })) as never, quiet: true });
      const sk = decks.map((d) => (out[d] ??= blank()));
      let turn = -1;
      let attacked = false;
      for (let n = 0; s.winner === null && n < 4000; n++) {
        const p = actor(s);
        if (!s.pending && s.phase === 'main' && s.turn !== turn) {
          turn = s.turn;
          attacked = false;
          sk[s.current]!.turns++;
          // Game turn 7 on is each player's own 4th turn on (turns alternate from 1).
          if (s.turn >= 7) sk[s.current]!.lateTurns++;
        }
        const a = bots[p]!.act(s);
        if (a.t === 'attack' && !s.pending) {
          const me = s.current;
          if (!attacked) sk[me]!.attackTurns++;
          attacked = true;
          sk[me]!.attacks[a.name] = (sk[me]!.attacks[a.name] ?? 0) + 1;
          if (a.name === 'Seek Inspiration') {
            sk[me]!.seek++;
            if (s.turn >= 7) sk[me]!.lateSeek++;
            if (seekHits(s, me)) sk[me]!.seekHit++;
          }
        }
        // Prize cards taken (setup deals them, so only main-phase moves count).
        const before = s.phase === 'main' ? [s.players[0].prizes.length, s.players[1].prizes.length] : null;
        s = apply(s, a, { trusted: true });
        if (before) for (const q of [0, 1] as const) sk[q]!.prizes += before[q]! - s.players[q].prizes.length;
      }
      for (const q of [0, 1] as const) {
        sk[q]!.games++;
        if (s.winner === q) sk[q]!.wins++;
      }
    }
  }
  return out;
}

if (!isMainThread) {
  parentPort!.postMessage(play(workerData as Job));
} else {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const per = Number(arg('games') ?? 8);
  const only = arg('decks')?.split(',');
  const slugs = files.map((f) => f.slug);
  const games: Job['games'] = [];
  let seed = 7_000_000;
  for (const a of only ?? slugs) for (const b of slugs) for (let k = 0; k < per; k++) games.push({ a, b, seed: seed++ });
  const threads = Math.min(Number(arg('threads') ?? cpus().length - 1), games.length);
  const parts = await Promise.all(
    Array.from({ length: threads }, (_, t) => runTsWorker<Record<string, Skill>>(import.meta.url, { games: games.filter((_, i) => i % threads === t), weights: arg('weights') } satisfies Job)),
  );
  const total: Record<string, Skill> = {};
  for (const part of parts) {
    for (const [d, x] of Object.entries(part)) {
      const t = (total[d] ??= blank());
      for (const k of ['games', 'wins', 'turns', 'attackTurns', 'prizes', 'lateTurns', 'lateSeek', 'seek', 'seekHit'] as const) t[k] += x[k];
      for (const [n, c] of Object.entries(x.attacks)) t.attacks[n] = (t.attacks[n] ?? 0) + c;
    }
  }
  const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(1)}%` : '-');
  console.log(`| Deck | Games | Win | Own turns/game | Turns with an attack | Prizes/own turn | Top attacks |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const d of only ?? slugs) {
    const x = total[d];
    if (!x) continue;
    const top = Object.entries(x.attacks)
      .sort((p, q) => q[1] - p[1])
      .slice(0, 3)
      .map(([n, c]) => `${n} ${c}`)
      .join(', ');
    console.log(`| ${d} | ${x.games} | ${pct(x.wins, x.games)} | ${(x.turns / x.games).toFixed(1)} | ${pct(x.attackTurns, x.turns)} | ${(x.prizes / x.turns).toFixed(2)} | ${top} |`);
  }
  const sl = total['slowking'];
  if (sl) console.log(`\nSlowking: Seek Inspiration in ${pct(sl.lateSeek, sl.lateTurns)} of its own turns from its 4th, an attack on top ${pct(sl.seekHit, sl.seek)} of the time.`);
  const json = arg('json');
  if (json) writeFileSync(json, JSON.stringify(total, null, 1));
}
