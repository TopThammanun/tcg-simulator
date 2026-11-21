// Play bot games on every CPU thread and write the decisions as training rows (shard.ts).
//   npx tsx scripts/learn/gen.ts <config.json>
// The config (written by ml/*.py, or by hand):
//   { "out": ".cache/learn/bc/0", "games": 8000, "base": 100000, "threads": 15,
//     "players": { "hard": { "kind": "hard", "record": true }, "net": { "kind": "net", "weights": "x.json", "temperature": 1, "record": true } },
//     "pairs": [ { "a": "hard", "b": "hard", "share": 1 } ] }
// Every pairing is played over all deck pairs (mirrors too) from both seats with the same deal.
// Prints one JSON line: games, rows, and each player's score per pairing.
// A network's `weights` is a weights file or an expert set: a folder of <deck slug>.json files, default.json for
// the other decks (scripts/lib/experts.ts expertWeights).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeBot } from '../../src/bots/core';
import { createBot, MODEL } from '../../src/bots';
import { makeHardBot } from '../../src/bots/hard';
import { loadModel, type Model, type ModelJson } from '../../src/bots/learn/model';
import { makeNetBot, recordBot } from '../../src/bots/learn/netbot';
import { makeSearchNetBot, type NetSearchOptions } from '../../src/bots/learn/search';
import { planFor } from '../../src/bots/plans';
import { makeRand, randomAction } from '../../src/bots/random';
import type { Bot } from '../../src/bots/types';
import { actor, apply, createGame } from '../../src/engine/actions';
import { derive, shuffleInPlace } from '../../src/engine/rng';
import { cloneState } from '../../src/engine/state';
import { readGamesFile, replay, turnsOf, type SavedGame } from '../../src/review/record';
import { deckKeys } from '../../src/engine/db';
import type { GameState } from '../../src/engine/types';
import { loadDeckFiles } from '../lib/decks';
import { BOT_EXPERTS, BOT_WEIGHTS, expertWeights } from '../lib/experts';
import { runTsWorker } from '../lib/workers';
import { playBatched, serverClient, type GameDeps, type ResignSpec, type Served } from './batched';
import { ShardWriter } from './shard';

export type PlayerSpec =
  | { kind: 'hard'; record?: boolean }
  | { kind: 'normal'; record?: boolean }
  /** Uniformly random legal moves (random.ts): an opponent unlike any trained player. */
  | { kind: 'random'; record?: boolean }
  | { kind: 'net'; weights: string; temperature?: number; record?: boolean; ties?: number }
  /** The game's bot (src/bots/index.ts createBot: bundled network and the deck's expert); fast = without look-ahead. */
  | { kind: 'bot'; fast?: boolean; record?: boolean }
  | ({ kind: 'search'; weights: string; record?: boolean; tactics?: boolean; guards?: boolean; rolloutWeights?: string } & Omit<NetSearchOptions, 'decks' | 'seed' | 'plan' | 'rollout'>)
  /**
   * The look-ahead bot with its rollouts batched on the GPU (deep.ts; needs `server`): no deadline, any number of
   * deals (BOT-NEXT.md N5). switchZ > 0: leave the policy's choice only for a clearly better mean.
   */
  | { kind: 'deep'; weights: string; width?: number; samples?: number; confident?: number; minPrior?: number; guards?: boolean; switchZ?: number; tactics?: boolean; record?: boolean };

export interface GenConfig {
  out: string;
  games: number;
  base: number;
  threads?: number;
  players: Record<string, PlayerSpec>;
  pairs: Pairing[];
  /**
   * Real lists (scripts/meta/variants.ts: { slug: card-key lists }): each side of a game plays one of its deck's
   * lists with chance `share`, otherwise the deck file's list. The swapped-seat game keeps the same lists.
   * `shareA`: the chance for player a's side in pairings with decksA / decksB (an expert plays the site's list
   * more often than its opponents do).
   */
  variants?: { path: string; share: number; shareA?: number };
  /**
   * Off-meta lists (scripts/meta/variants.ts offmeta.json: archetypes no deck file covers, BOT-NEXT.md N6): with
   * chance `share` the second side of a game plays one of them instead (its deck then reads "off:<archetype>");
   * `heldOut` takes the held-out lists (measuring) instead of the training ones.
   */
  offmeta?: { path: string; share: number; heldOut?: boolean };
  /**
   * Positions from games people played against the bot (the review page's games file): this share of the games
   * starts from one of them (a turn's first free position, Prizes and deck orders dealt again) instead of
   * from the beginning, with that game's lists and decks. Self-play then learns what real players did to it.
   */
  starts?: { path: string; share: number };
  /**
   * Batched forward passes (BOT-LEAP.md, L1): network players ("net", and "bot" without look-ahead) ask the
   * inference server on this port (ml/serve.py) instead of computing in the worker; each worker keeps
   * `concurrent` games in flight. `resign`: hopeless served sides give up (batched.ts ResignSpec).
   */
  server?: { port: number; concurrent?: number; lanes?: number; resign?: ResignSpec };
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
  /** Lists other than the deck files' (variants), by seat. */
  lists?: [string[] | null, string[] | null];
  /** Start from state `at` of saved game `game` (Job.games). */
  start?: { game: number; at: number };
}
interface Job {
  matches: Match[];
  players: Record<string, PlayerSpec>;
  /** The saved games starts refer to. */
  games?: SavedGame[];
  path: string;
  server?: GenConfig['server'];
}
export interface MatchResult {
  names: [string, string];
  decks: [string, string];
  /** The deal (the swapped-seat game has the same one). */
  seed: number;
  winner: 0 | 1 | 'draw' | null;
  maxThinkMs: [number, number];
  /** Batched games: the seat that resigned, or that would have resigned in a game played on to check. */
  resigned?: 0 | 1;
  wouldResign?: 0 | 1;
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

/** The game's network for a deck: its expert when it has one, else the bundled network (null: none bundled). */
function botModel(slug: string): Model | null {
  const w = expertWeights(BOT_EXPERTS, slug, BOT_WEIGHTS);
  return w === resolve(BOT_WEIGHTS) ? MODEL : model(w);
}

function makePlayer(spec: PlayerSpec, slug: string, oppSlug: string, seed: number, out: Pick<ShardWriter, 'add'> | null): Bot {
  const plan = planFor(slug);
  const oppPlan = planFor(oppSlug);
  const decks = [plan.name, oppPlan.name] as const;
  const record = spec.record && out ? (d: Parameters<ShardWriter['add']>[0]) => out.add(d) : undefined;
  if (spec.kind === 'net') return makeNetBot(model(expertWeights(spec.weights, slug)), { decks, seed, temperature: spec.temperature ?? 0, ties: spec.ties, onDecision: record });
  const random = (): Bot => {
    const rand = makeRand(seed);
    return { act: (s) => randomAction(s, rand) };
  };
  const bot =
    spec.kind === 'bot'
      ? createBot(plan, seed, oppPlan, { fast: spec.fast ?? true, model: botModel(slug) })
      : spec.kind === 'search'
      ? makeSearchNetBot(model(expertWeights(spec.weights, slug)), {
          ...spec,
          decks,
          seed,
          plan: spec.tactics === false ? undefined : plan,
          rollout: spec.rolloutWeights ? model(expertWeights(spec.rolloutWeights, slug)) : undefined,
        })
      : spec.kind === 'hard'
        ? makeHardBot(plan, oppPlan, { seed })
        : spec.kind === 'random'
          ? random()
          : makeBot(plan, { seed });
  return record ? recordBot(bot, decks, record) : bot;
}

const replays = new Map<number, GameState[]>();

/** A saved game's state `at`, with both players' decks and Prizes dealt again and fresh coins (the game's seed). */
function startFrom(games: SavedGame[], start: NonNullable<Match['start']>, seed: number): GameState {
  if (!replays.has(start.game)) replays.set(start.game, replay(games[start.game]!));
  const s = cloneState(replays.get(start.game)![start.at]!);
  s.quiet = true;
  s.log = [];
  s.rng = { shuffle: [derive(seed, 1), derive(seed, 2)], coin: derive(seed, 3) };
  for (const p of [0, 1] as const) {
    const ps = s.players[p];
    const pool = [...ps.deck, ...ps.prizes];
    shuffleInPlace(pool, derive(seed, 4 + p));
    ps.deck = pool.slice(0, ps.deck.length);
    ps.prizes = pool.slice(ps.deck.length);
    ps.knownTop = [];
  }
  return s;
}

/** A match's first state: a saved game's position, or a new game with the match's lists. */
function newGame(m: Match, games: SavedGame[]): GameState {
  return m.start
    ? startFrom(games, m.start, m.seed)
    : createGame({
        seed: m.seed,
        decks: [
          { name: 'a', cards: m.lists?.[0] ?? deckCards.get(m.decks[0])! },
          { name: 'b', cards: m.lists?.[1] ?? deckCards.get(m.decks[1])! },
        ],
        quiet: true,
      });
}

/** The network a player spec plays `slug` from, when the inference server can play it (no look-ahead, not a recorded bot). */
function served(spec: PlayerSpec, slug: string): Served | null {
  if (spec.kind === 'net') return { model: expertWeights(spec.weights, slug), temperature: spec.temperature ?? 0, record: !!spec.record, ties: spec.ties };
  if (spec.kind === 'bot' && (spec.fast ?? true) && !spec.record && MODEL) return { model: expertWeights(BOT_EXPERTS, slug, BOT_WEIGHTS), temperature: 0, record: false };
  if (spec.kind === 'deep') {
    const deep = { width: spec.width ?? 4, samples: spec.samples ?? 6, confident: spec.confident ?? 0.9, minPrior: spec.minPrior ?? 0.03, guards: spec.guards ?? true, switchZ: spec.switchZ ?? 0 };
    return { model: expertWeights(spec.weights, slug), temperature: 0, record: false, deep: { ...deep, plan: spec.tactics === false ? undefined : planFor(slug) } };
  }
  return null;
}

/** What batched.ts needs to play a match of these players. */
export function gameDeps(players: Record<string, PlayerSpec>, games: SavedGame[] = []): GameDeps<Match, PlayerSpec> {
  return { players, newGame: (m) => newGame(m, games), served, makePlayer, maxActions: MAX_ACTIONS };
}

export function playMatch(m: Match, players: Record<string, PlayerSpec>, out: ShardWriter | null, gameId: number, games: SavedGame[] = []): MatchResult {
  const bots = [0, 1].map((i) => makePlayer(players[m.names[i]!]!, m.decks[i]!, m.decks[1 - i]!, m.seed * 2 + i + 1, out));
  let s = newGame(m, games);
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
  out?.endGame(s.winner, [6 - s.players[0].prizes.length, 6 - s.players[1].prizes.length]);
  return { names: m.names, decks: m.decks, seed: m.seed, winner: s.winner, maxThinkMs: think };
}

/** The saved games of a config's `starts`, and each one's start positions (a turn's first free state, turn 2 on). */
export function startPositions(c: Pick<GenConfig, 'starts'>): { games: SavedGame[]; at: number[][] } {
  if (!c.starts) return { games: [], at: [] };
  const games = readGamesFile(readFileSync(c.starts.path, 'utf8'));
  const at = games.map((g) => {
    const states = replay(g);
    return [...turnsOf(states, 0), ...turnsOf(states, 1)].filter((t) => t.turn >= 2).map((t) => t.start).sort((x, y) => x - y);
  });
  return { games, at };
}

/** Matches for a config: each pairing gets its share of the games, every deck pair, both seats. */
export function matchesFor(c: Pick<GenConfig, 'games' | 'base' | 'pairs' | 'variants' | 'starts' | 'offmeta'>): Match[] {
  const out: Match[] = [];
  const starts = startPositions(c);
  const pool = starts.at.flatMap((list, g) => list.map((at) => ({ g, at })));
  // A saved game's position for game k, with chance `share` (a hash of k).
  const startFor = (k: number) => {
    if (!c.starts || pool.length === 0) return null;
    const h = Math.imul(k + 7, 0x27d4eb2f) >>> 0;
    return (h % 10_000) / 10_000 < c.starts.share ? pool[(h >>> 9) % pool.length]! : null;
  };
  const variants = c.variants ? (JSON.parse(readFileSync(c.variants.path, 'utf8')) as Record<string, string[][]>) : {};
  const offFile = c.offmeta ? (JSON.parse(readFileSync(c.offmeta.path, 'utf8')) as Record<'train' | 'heldOut', { archetype: string; cards: string[] }[]>) : null;
  const offLists = offFile ? (c.offmeta!.heldOut ? offFile.heldOut : offFile.train) : [];
  // An off-meta list for the second side of game k, with chance `share` (a hash of the game).
  const offFor = (k: number) => {
    if (!offLists.length) return null;
    const h = Math.imul(k + 13, 0x7feb352d) >>> 0;
    return (h % 10_000) / 10_000 < c.offmeta!.share ? offLists[(h >>> 11) % offLists.length]! : null;
  };
  // A list for one side of game k: a variant with chance `share` (decided by a hash of the game and side); side 0
  // of a pairing with fixed decks is player a's, which may have its own chance (shareA).
  const listFor = (slug: string, k: number, side: number, fixed: boolean): string[] | null => {
    const vs = variants[slug];
    if (!vs?.length || !c.variants) return null;
    const share = fixed && side === 0 && c.variants.shareA !== undefined ? c.variants.shareA : c.variants.share;
    const h = (Math.imul(k + 1, 0x85ebca6b) ^ Math.imul(side + 1, 0xc2b2ae35)) >>> 0;
    return (h % 10_000) / 10_000 < share ? vs[(h >>> 7) % vs.length]! : null;
  };
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
      let y = fixed ? draw(db, 0x1b873593) : db[Math.floor(k / da.length) % db.length]!;
      const seed = c.base + k;
      const st = startFor(k);
      if (st) {
        // Seats as in the saved game: the person's deck first (its plan; "player" for games saved before decks could be picked), the bot's second.
        const g = starts.games[st.g]!;
        const decks: [string, string] = [g.mine ?? 'player', g.opponent];
        out.push({ id: out.length, seed, decks, names: [pair.a, pair.b], lists: [g.decks[0], g.decks[1]], start: { game: st.g, at: st.at } });
        if (!mirror) out.push({ id: out.length, seed, decks, names: [pair.b, pair.a], lists: [g.decks[0], g.decks[1]], start: { game: st.g, at: st.at } });
        continue;
      }
      const lx = listFor(x, k, 0, fixed);
      let ly = listFor(y, k, 1, fixed);
      const off = offFor(k);
      if (off) {
        y = `off:${off.archetype}`;
        ly = off.cards;
      }
      const lists = (a: string[] | null, b: string[] | null): Match['lists'] => (a || b ? [a, b] : undefined);
      out.push({ id: out.length, seed, decks: [x, y], names: [pair.a, pair.b], lists: lists(lx, ly) });
      if (!mirror) out.push({ id: out.length, seed, decks: fixed ? [y, x] : [x, y], names: [pair.b, pair.a], lists: fixed ? lists(ly, lx) : lists(lx, ly) });
    }
  }
  return out;
}

if (!isMainThread) {
  const job = workerData as Job;
  const out = new ShardWriter();
  const results: MatchResult[] = [];
  const broke = (m: Match, e: Error) => console.error(`game ${m.seed} ${m.decks.join(' vs ')} broke: ${e.message}`);
  if (job.server) {
    const client = serverClient(job.server.port);
    const played = await playBatched(job.matches, gameDeps(job.players, job.games), client.infer, out, {
      concurrent: job.server.concurrent ?? 64,
      lanes: job.server.lanes,
      resign: job.server.resign,
      onError: broke,
    });
    client.close();
    for (const r of played) results.push({ names: r.m.names, decks: r.m.decks, seed: r.m.seed, winner: r.winner, maxThinkMs: r.maxThinkMs, resigned: r.resigned, wouldResign: r.wouldResign });
  } else {
    job.matches.forEach((m) => {
      try {
        results.push(playMatch(m, job.players, out, m.id, job.games));
      } catch (e) {
        results.push({ names: m.names, decks: m.decks, seed: m.seed, winner: null, maxThinkMs: [0, 0] });
        broke(m, e as Error);
      }
    });
  }
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
  /** Batched games with resigning: games resigned, games played on to check, and how many of those the would-be resigner won. */
  resign?: { resigned: number; checked: number; wrong: number };
  /**
   * Per pairing of two different players, the score counted by deal: each deal's two games (seats swapped) give one
   * mean, so luck of the deal cancels; `se` is the standard error of their average (a 95% range is ±1.96·se).
   */
  paired: Record<string, { pairs: number; mean: number; se: number }>;
}> {
  if (!existsSync(c.out)) mkdirSync(c.out, { recursive: true });
  const matches = matchesFor(c);
  const threads = Math.max(1, Math.min(c.threads ?? cpus().length - 1, matches.length));
  // Interleave so every thread gets a mix of decks and pairings.
  const games = startPositions(c).games;
  const jobs: Job[] = Array.from({ length: threads }, (_, t) => ({
    matches: matches.filter((_, i) => i % threads === t),
    players: c.players,
    games,
    path: `${c.out}/shard-${t}.bin`,
    server: c.server,
  }));
  const parts = await Promise.all(jobs.map((j) => runTsWorker<JobResult>(new URL(import.meta.url), j)));
  const scores: Record<string, { score: number; n: number }> = {};
  const byDeck: Record<string, { score: number; n: number }> = {};
  const maxThinkMs: Record<string, number> = {};
  const resign = { resigned: 0, checked: 0, wrong: 0 };
  const all = parts.flatMap((p) => p.results);
  for (const r of all) {
    if (r.resigned !== undefined) resign.resigned++;
    if (r.wouldResign !== undefined) {
      resign.checked++;
      if (r.winner === r.wouldResign) resign.wrong++;
    }
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
  return { games: matches.length, rows: parts.reduce((t, p) => t + p.rows, 0), scores, byDeck, maxThinkMs, ...(c.server?.resign ? { resign } : {}), paired: pairedScores(all) };
}

/** Scores by deal (generate's `paired`): games of two different players on the same deal, one from each seat. */
export function pairedScores(results: Pick<MatchResult, 'names' | 'seed' | 'winner'>[]): Record<string, { pairs: number; mean: number; se: number }> {
  const points = (r: Pick<MatchResult, 'winner'>, seat: 0 | 1) => (r.winner === seat ? 1 : r.winner === 'draw' || r.winner === null ? 0.5 : 0);
  const deals = new Map<string, { a: string; b: string; sum: number; n: number }>();
  for (const r of results) {
    if (r.names[0] === r.names[1]) continue;
    const [a, b] = [...r.names].sort() as [string, string];
    const key = `${a}|${b}|${r.seed}`;
    const d = deals.get(key) ?? { a, b, sum: 0, n: 0 };
    d.sum += points(r, r.names[0] === a ? 0 : 1);
    d.n++;
    deals.set(key, d);
  }
  const by = new Map<string, number[]>();
  for (const d of deals.values()) {
    if (d.n !== 2) continue;
    const k = `${d.a} vs ${d.b}`;
    by.set(k, [...(by.get(k) ?? []), d.sum / 2]);
  }
  const out: Record<string, { pairs: number; mean: number; se: number }> = {};
  for (const [k, xs] of by) {
    const mean = xs.reduce((t, x) => t + x, 0) / xs.length;
    const v = xs.length > 1 ? xs.reduce((t, x) => t + (x - mean) ** 2, 0) / (xs.length - 1) : 0;
    const se = Math.sqrt(v / xs.length);
    out[k] = { pairs: xs.length, mean, se };
    const [a, b] = k.split(' vs ') as [string, string];
    out[`${b} vs ${a}`] = { pairs: xs.length, mean: 1 - mean, se };
  }
  return out;
}
