// Play bot games on every CPU thread and write the decisions as training rows (shard.ts).
//   npx tsx scripts/learn/gen.ts <config.json>
// The config (written by ml/*.py, or by hand):
//   { "out": ".cache/learn/bc/0", "games": 8000, "base": 100000, "threads": 15,
//     "players": { "hard": { "kind": "hard", "record": true }, "net": { "kind": "net", "weights": "x.json", "temperature": 1, "record": true } },
//     "pairs": [ { "a": "hard", "b": "hard", "share": 1 } ] }
// Every pairing is played over all deck pairs (mirrors too) from both seats with the same deal.
// Prints one JSON line: games, rows, and each player's score per pairing.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeBot } from '../../src/bots/core';
import { makeHardBot } from '../../src/bots/hard';
import { loadModel, type Model, type ModelJson } from '../../src/bots/learn/model';
import { makeNetBot, recordBot } from '../../src/bots/learn/netbot';
import { makeSearchNetBot, type NetSearchOptions } from '../../src/bots/learn/search';
import { planFor } from '../../src/bots/plans';
import type { Bot } from '../../src/bots/types';
import { actor, apply, createGame } from '../../src/engine/actions';
import { deckKeys } from '../../src/engine/db';
import type { GameState } from '../../src/engine/types';
import { loadDeckFiles } from '../lib/decks';
import { runTsWorker } from '../lib/workers';
import { ShardWriter } from './shard';

export type PlayerSpec =
  | { kind: 'hard'; record?: boolean }
  | { kind: 'normal'; record?: boolean }
  | { kind: 'net'; weights: string; temperature?: number; record?: boolean }
  | ({ kind: 'search'; weights: string; record?: boolean; tactics?: boolean; guards?: boolean } & Omit<NetSearchOptions, 'decks' | 'seed' | 'plan'>);

export interface GenConfig {
  out: string;
  games: number;
  base: number;
  threads?: number;
  players: Record<string, PlayerSpec>;
  pairs: Pairing[];
}

/**
 * Who plays whom, and the share of the games. By default every deck pair comes up equally often and the
 * swapped game swaps decks too; with `decksA` / `decksB` (deck slug -> weight) player a always plays a deck
 * from its list and b from its own, in both seats (training one deck: the meta's first).
 */
export interface Pairing {
  a: string;
  b: string;
  share: number;
  decksA?: Record<string, number>;
  decksB?: Record<string, number>;
}

/** Deck slugs repeated by weight (about 100 entries), so cycling through them follows the weights. */
function weighted(w: Record<string, number> | undefined): string[] {
  if (!w) return SLUGS;
  const total = Object.values(w).reduce((t, x) => t + x, 0);
  const out: string[] = [];
  for (const [slug, x] of Object.entries(w)) {
    if (!SLUGS.includes(slug)) throw new Error(`unknown deck ${slug}`);
    for (let i = 0; i < Math.round((100 * x) / total); i++) out.push(slug);
  }
  return out;
}

interface Match {
  id: number;
  seed: number;
  decks: [string, string];
  names: [string, string];
}
interface Job {
  matches: Match[];
  players: Record<string, PlayerSpec>;
  path: string;
}
export interface MatchResult {
  names: [string, string];
  decks: [string, string];
  winner: 0 | 1 | 'draw' | null;
  maxThinkMs: [number, number];
}
interface JobResult {
  results: MatchResult[];
  rows: number;
}

const MAX_ACTIONS = 4000;
const files = loadDeckFiles('src/content/decks');
const deckCards = new Map(files.map((f) => [f.slug, deckKeys(f.list.entries)]));
export const SLUGS = files.map((f) => f.slug);

const models = new Map<string, Model>();
function model(path: string): Model {
  let m = models.get(path);
  if (!m) {
    m = loadModel(JSON.parse(readFileSync(path, 'utf8')) as ModelJson);
    models.set(path, m);
  }
  return m;
}

function makePlayer(spec: PlayerSpec, slug: string, oppSlug: string, seed: number, out: ShardWriter | null): Bot {
  const plan = planFor(slug);
  const oppPlan = planFor(oppSlug);
  const decks = [plan.name, oppPlan.name] as const;
  const record = spec.record && out ? (d: Parameters<ShardWriter['add']>[0]) => out.add(d) : undefined;
  if (spec.kind === 'net') return makeNetBot(model(spec.weights), { decks, seed, temperature: spec.temperature ?? 0, onDecision: record });
  const bot =
    spec.kind === 'search'
      ? makeSearchNetBot(model(spec.weights), { ...spec, decks, seed, plan: spec.tactics === false ? undefined : plan })
      : spec.kind === 'hard'
        ? makeHardBot(plan, oppPlan, { seed })
        : makeBot(plan, { seed });
  return record ? recordBot(bot, decks, record) : bot;
}

export function playMatch(m: Match, players: Record<string, PlayerSpec>, out: ShardWriter | null, gameId: number): MatchResult {
  const bots = [0, 1].map((i) => makePlayer(players[m.names[i]!]!, m.decks[i]!, m.decks[1 - i]!, m.seed * 2 + i + 1, out));
  let s: GameState = createGame({
    seed: m.seed,
    decks: [
      { name: 'a', cards: deckCards.get(m.decks[0])! },
      { name: 'b', cards: deckCards.get(m.decks[1])! },
    ],
    quiet: true,
  });
  const think: [number, number] = [0, 0];
  out?.beginGame(gameId);
  try {
    for (let n = 0; s.winner === null && n < MAX_ACTIONS; n++) {
      const p = actor(s);
      const t0 = performance.now();
      const a = bots[p]!.act(s);
      think[p] = Math.max(think[p], performance.now() - t0);
      s = apply(s, a, { trusted: true });
    }
  } catch (e) {
    out?.dropGame();
    throw e;
  }
  out?.endGame(s.winner);
  return { names: m.names, decks: m.decks, winner: s.winner, maxThinkMs: think };
}

/** Matches for a config: each pairing gets its share of the games, every deck pair, both seats. */
export function matchesFor(c: Pick<GenConfig, 'games' | 'base' | 'pairs'>): Match[] {
  const out: Match[] = [];
  const total = c.pairs.reduce((t, p) => t + p.share, 0);
  let k = 0;
  for (const pair of c.pairs) {
    // A player against itself needs no seat swap (the swapped game would be the same game).
    const mirror = pair.a === pair.b;
    const fixed = !!(pair.decksA || pair.decksB);
    const da = weighted(pair.decksA);
    const db = weighted(pair.decksB);
    const n = Math.round((c.games * pair.share) / total / (mirror ? 1 : 2));
    // Weighted lists are drawn by a hash of the game number (every combination, in proportion); the default
    // walks every deck pair in turn.
    const draw = (list: string[], salt: number) => list[((Math.imul(k + 1, 0x9e3779b1) ^ salt) >>> 0) % list.length]!;
    for (let i = 0; i < n; i++, k++) {
      const x = fixed ? draw(da, 0x5bd1e995) : da[k % da.length]!;
      const y = fixed ? draw(db, 0x1b873593) : db[Math.floor(k / da.length) % db.length]!;
      const seed = c.base + k;
      out.push({ id: out.length, seed, decks: [x, y], names: [pair.a, pair.b] });
      if (!mirror) out.push({ id: out.length, seed, decks: fixed ? [y, x] : [x, y], names: [pair.b, pair.a] });
    }
  }
  return out;
}

if (!isMainThread) {
  const job = workerData as Job;
  const out = new ShardWriter();
  const results: MatchResult[] = [];
  job.matches.forEach((m) => {
    try {
      results.push(playMatch(m, job.players, out, m.id));
    } catch (e) {
      results.push({ names: m.names, decks: m.decks, winner: null, maxThinkMs: [0, 0] });
      console.error(`game ${m.seed} ${m.decks.join(' vs ')} broke: ${(e as Error).message}`);
    }
  });
  if (out.rows > 0) out.write(job.path);
  parentPort!.postMessage({ results, rows: out.rows } satisfies JobResult);
} else if (process.argv[1]?.endsWith('gen.ts')) {
  const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as GenConfig;
  const t0 = Date.now();
  const r = await generate(config);
  console.log(JSON.stringify({ ...r, seconds: (Date.now() - t0) / 1000 }));
}

/** Run a config on worker threads; returns games, rows written and each pairing's score. */
export async function generate(c: GenConfig): Promise<{
  games: number;
  rows: number;
  scores: Record<string, { score: number; n: number }>;
  /** The same per deck: "<player> <its deck> vs <other deck>". */
  byDeck: Record<string, { score: number; n: number }>;
  maxThinkMs: Record<string, number>;
}> {
  if (!existsSync(c.out)) mkdirSync(c.out, { recursive: true });
  const matches = matchesFor(c);
  const threads = Math.max(1, Math.min(c.threads ?? cpus().length - 1, matches.length));
  // Interleave so every thread gets a mix of decks and pairings.
  const jobs: Job[] = Array.from({ length: threads }, (_, t) => ({
    matches: matches.filter((_, i) => i % threads === t),
    players: c.players,
    path: `${c.out}/shard-${t}.bin`,
  }));
  const parts = await Promise.all(jobs.map((j) => runTsWorker<JobResult>(new URL(import.meta.url), j)));
  const scores: Record<string, { score: number; n: number }> = {};
  const byDeck: Record<string, { score: number; n: number }> = {};
  const maxThinkMs: Record<string, number> = {};
  for (const r of parts.flatMap((p) => p.results)) {
    for (const i of [0, 1] as const) {
      const points = r.winner === i ? 1 : r.winner === 'draw' || r.winner === null ? 0.5 : 0;
      for (const [table, key] of [
        [scores, `${r.names[i]} vs ${r.names[1 - i]}`],
        [byDeck, `${r.names[i]} ${r.decks[i]} vs ${r.decks[1 - i]}`],
      ] as const) {
        const sc = (table[key] ??= { score: 0, n: 0 });
        sc.n++;
        sc.score += points;
      }
      maxThinkMs[r.names[i]] = Math.max(maxThinkMs[r.names[i]] ?? 0, r.maxThinkMs[i]);
    }
  }
  return { games: matches.length, rows: parts.reduce((t, p) => t + p.rows, 0), scores, byDeck, maxThinkMs };
}
