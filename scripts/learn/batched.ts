// Training games with the network's forward passes batched (BOT-LEAP.md, L1). A worker plays many games at once;
// each game is a generator that pauses whenever a served network has to decide, and every paused decision of the
// worker goes to the inference server (ml/serve.py, PyTorch on the GPU) in one frame: the rows in the shard layout
// (shard.ts) plus the model each row asks. Bots that are not a served network (normal, hard, look-ahead) play in
// the worker as before. A served side decides exactly as makeNetBot does (same seed, same sampling).
import { connect } from 'node:net';
import { encode, type Encoded, type OptionRef } from '../../src/bots/learn/encode';
import { softmax } from '../../src/bots/learn/model';
import { MAX_ACTIONS_PER_TURN, oppHand, turnCounter, type Decision } from '../../src/bots/learn/netbot';
import { planFor } from '../../src/bots/plans';
import { makeRand } from '../../src/bots/random';
import type { Bot } from '../../src/bots/types';
import { actor, apply } from '../../src/engine/actions';
import { opp } from '../../src/engine/state';
import type { Action, GameState, PlayerId } from '../../src/engine/types';
import { ShardWriter } from './shard';

/** A decision waiting for a network: what it sees and which network (its weights file). */
export interface Ask {
  enc: Encoded;
  model: string;
}
export interface Answer {
  value: number;
  logits: Float32Array;
}
/** Answers for a batch of asks, in order. */
export type Infer = (asks: Ask[]) => Promise<Answer[]>;

/** A side played by a served network. */
export interface Served {
  model: string;
  temperature: number;
  record: boolean;
}

/**
 * Resigning (AlphaGo Zero): a served side whose value is below `below` at the start of `turns` of its turns in a row
 * gives up. In a `keepPlaying` share of the games nobody resigns; those games tell how often a side that would have
 * resigned went on to win (it should almost never).
 */
export interface ResignSpec {
  below: number;
  turns: number;
  keepPlaying: number;
}

export interface BatchedMatch {
  id: number;
  seed: number;
  decks: [string, string];
  names: [string, string];
}

/** What a batched game needs from gen.ts (passed in, so this module does not import it). */
export interface GameDeps<M extends BatchedMatch, S> {
  players: Record<string, S>;
  newGame(m: M): GameState;
  /** The served network for a player spec, or null for a bot that plays in the worker. */
  served(spec: S): Served | null;
  makePlayer(spec: S, slug: string, oppSlug: string, seed: number, out: { add(d: Decision): void } | null): Bot;
  maxActions: number;
}

export interface BatchedResult<M extends BatchedMatch> {
  m: M;
  winner: PlayerId | 'draw' | null;
  maxThinkMs: [number, number];
  /** The side that resigned. */
  resigned?: PlayerId;
  /** Kept playing although this side would have resigned (resign check). */
  wouldResign?: PlayerId;
  /** Prize cards each player had taken when the game ended (or was resigned). */
  taken?: [number, number];
}

interface Side {
  bot: Bot | null;
  served: Served | null;
  decks: readonly [string, string];
  rand: () => number;
  count: (s: GameState, me: PlayerId) => number;
  /** Own turns in a row that started with the value below the resign line, and the last turn counted. */
  low: number;
  lowTurn: number;
}

function* choose(enc: Encoded, me: PlayerId, side: Side, rows: Decision[], first: boolean, s: GameState, resign: ResignSpec | undefined): Generator<Ask, number, Answer> {
  if (enc.refs.length === 1) return 0;
  const sv = side.served!;
  const out: Answer = yield { enc, model: sv.model };
  let i = 0;
  if (sv.temperature <= 0) {
    for (let k = 1; k < out.logits.length; k++) if (out.logits[k]! > out.logits[i]!) i = k;
  } else {
    const p = softmax(out.logits, sv.temperature);
    let r = side.rand();
    i = p.length - 1;
    for (let k = 0; k < p.length; k++) {
      r -= p[k]!;
      if (r <= 0) {
        i = k;
        break;
      }
    }
  }
  if (sv.record) {
    const p = softmax(out.logits);
    rows.push({ enc, player: me, chosen: i, logp: Math.log(Math.max(p[i]!, 1e-12)), value: out.value, logits: out.logits.slice(), oppHand: oppHand(s, me) });
  }
  // The first network decision of each own turn counts toward resigning.
  if (resign && first && side.lowTurn !== s.turn) {
    side.lowTurn = s.turn;
    side.low = out.value < resign.below ? side.low + 1 : 0;
  }
  return i;
}

/** One decision of a served side, as makeNetBot makes it. */
function* netAct(s: GameState, me: PlayerId, side: Side, rows: Decision[], resign: ResignSpec | undefined): Generator<Ask, Action, Answer> {
  if (s.pending) {
    const picks: number[] = [];
    for (;;) {
      const enc = encode(s, { decks: side.decks }, picks);
      const ref = enc.refs[yield* choose(enc, me, side, rows, false, s, resign)]!;
      if (ref.t !== 'pick') break;
      picks.push(ref.value);
    }
    return { t: 'choose', picks };
  }
  const n = side.count(s, me);
  if (n >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
  const enc = encode(s, { decks: side.decks, actionsThisTurn: n });
  const i = yield* choose(enc, me, side, rows, s.phase === 'main', s, resign);
  return (enc.refs[i] as Extract<OptionRef, { t: 'action' }>).action;
}

const taken = (s: GameState): [number, number] => [6 - s.players[0].prizes.length, 6 - s.players[1].prizes.length];

/** One game; yields every decision a served network must make. `rows` gets the recorded decisions. */
export function* playGame<M extends BatchedMatch, S>(
  m: M,
  deps: GameDeps<M, S>,
  rows: Decision[],
  resign: ResignSpec | undefined,
  keepPlaying: boolean,
): Generator<Ask, BatchedResult<M>, Answer> {
  const sides: Side[] = [0, 1].map((i) => {
    const spec = deps.players[m.names[i]!]!;
    const slug = m.decks[i]!;
    const other = m.decks[1 - i]!;
    const seed = m.seed * 2 + i + 1;
    const served = deps.served(spec);
    return {
      bot: served ? null : deps.makePlayer(spec, slug, other, seed, { add: (d) => rows.push(d) }),
      served,
      decks: [planFor(slug).name, planFor(other).name] as const,
      rand: makeRand(seed),
      count: turnCounter(),
      low: 0,
      lowTurn: -1,
    };
  });
  let s = deps.newGame(m);
  const think: [number, number] = [0, 0];
  let wouldResign: PlayerId | undefined;
  for (let n = 0; s.winner === null && n < deps.maxActions; n++) {
    const p = actor(s);
    const side = sides[p]!;
    let a: Action;
    if (side.bot) {
      const t0 = performance.now();
      a = side.bot.act(s);
      think[p] = Math.max(think[p], performance.now() - t0);
    } else {
      a = yield* netAct(s, p, side, rows, resign);
      if (resign && side.low >= resign.turns) {
        if (!keepPlaying) return { m, winner: opp(p), maxThinkMs: think, resigned: p, taken: taken(s) };
        wouldResign ??= p;
      }
    }
    s = apply(s, a, { trusted: true });
  }
  return { m, winner: s.winner, maxThinkMs: think, wouldResign, taken: taken(s) };
}

/**
 * Play `matches` with `concurrent` games in flight, split into `lanes` that wait for the server in turn (one lane
 * runs its games while another waits). Finished games go to `out` in one piece, so their rows stay together.
 */
export async function playBatched<M extends BatchedMatch, S>(
  matches: M[],
  deps: GameDeps<M, S>,
  infer: Infer,
  out: ShardWriter | null,
  o: { concurrent: number; lanes?: number; resign?: ResignSpec; onError?: (m: M, e: Error) => void },
): Promise<BatchedResult<M>[]> {
  const queue = [...matches];
  const results: BatchedResult<M>[] = [];
  const lanes = Math.max(1, o.lanes ?? 2);
  const per = Math.max(1, Math.ceil(o.concurrent / lanes));
  // Whether nobody resigns in game k (a hash, so the same games keep playing whatever the order).
  const keep = (m: M) => !!o.resign && ((Math.imul(m.id + 11, 0x2c1b3c6d) >>> 0) % 10_000) / 10_000 < o.resign.keepPlaying;

  interface Live {
    m: M;
    rows: Decision[];
    gen: Generator<Ask, BatchedResult<M>, Answer>;
    ask: Ask | null;
  }
  const finish = (g: Live, r: BatchedResult<M>) => {
    if (out) {
      out.beginGame(g.m.id);
      for (const d of g.rows) out.add(d);
      out.endGame(r.winner, r.taken);
    }
    results.push(r);
  };
  const broke = (g: Live, e: Error) => {
    results.push({ m: g.m, winner: null, maxThinkMs: [0, 0] });
    o.onError?.(g.m, e);
  };
  // Run a game until it asks or ends; false when it ended.
  const step = (g: Live, answer: Answer | undefined): boolean => {
    try {
      const r = g.gen.next(answer as Answer);
      if (r.done) {
        finish(g, r.value);
        return false;
      }
      g.ask = r.value;
      return true;
    } catch (e) {
      broke(g, e as Error);
      return false;
    }
  };
  const lane = async () => {
    let live: Live[] = [];
    const fill = () => {
      while (live.length < per && queue.length) {
        const m = queue.shift()!;
        const rows: Decision[] = [];
        const g: Live = { m, rows, gen: playGame(m, deps, rows, o.resign, keep(m)), ask: null };
        if (step(g, undefined)) live.push(g);
      }
    };
    fill();
    while (live.length) {
      const answers = await infer(live.map((g) => g.ask!));
      live = live.filter((g, i) => step(g, answers[i]));
      fill();
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

/**
 * A connection to ml/serve.py. Frames both ways: u32 payload bytes, u32 request id, payload. Request payload: u32
 * length of a JSON list of weights files, that list, then the rows as a shard (shard.ts) with a `model` index per
 * row. Answer payload: one float32 value per row, then the float32 logits of every row's options in order.
 */
export function serverClient(port: number, host = '127.0.0.1'): { infer: Infer; close(): void } {
  const sock = connect({ port, host });
  sock.setNoDelay(true);
  const waiting = new Map<number, { asks: Ask[]; resolve: (a: Answer[]) => void; reject: (e: Error) => void }>();
  let failure: Error | null = null;
  const fail = (e: Error) => {
    failure = e;
    for (const w of waiting.values()) w.reject(e);
    waiting.clear();
  };
  sock.on('error', fail);
  sock.on('close', () => fail(new Error('inference server closed the connection')));
  let buf: Buffer = Buffer.alloc(0);
  sock.on('data', (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 8) {
      const n = buf.readUInt32LE(0);
      if (buf.length < 8 + n) break;
      const id = buf.readUInt32LE(4);
      const body = buf.subarray(8, 8 + n);
      buf = buf.subarray(8 + n);
      const w = waiting.get(id);
      if (!w) continue;
      waiting.delete(id);
      // Copy out of the socket buffer (it is reused), then split per row.
      const f = new Float32Array(new Uint8Array(body).buffer);
      if (f.length === 0 && w.asks.length) {
        w.reject(new Error('inference server failed on a batch (see its output)'));
        continue;
      }
      const rows = w.asks.length;
      let at = rows;
      w.resolve(
        w.asks.map((a, i) => {
          const k = a.enc.optCard.length;
          const logits = f.subarray(at, at + k);
          at += k;
          return { value: f[i]!, logits };
        }),
      );
    }
  });
  const writer = new ShardWriter();
  let next = 1;
  const infer: Infer = (asks) => {
    if (failure) return Promise.reject(failure);
    const models: string[] = [];
    const index = new Map<string, number>();
    const which = new Uint8Array(asks.length);
    writer.reset();
    asks.forEach((a, i) => {
      let k = index.get(a.model);
      if (k === undefined) {
        k = models.length;
        models.push(a.model);
        index.set(a.model, k);
      }
      which[i] = k;
      writer.add({ enc: a.enc, player: 0, chosen: 0, logp: 0, value: 0 });
    });
    const head = Buffer.from(JSON.stringify(models));
    const shard = writer.toBuffer([['model', 'u1', [asks.length], which]]);
    const frame = Buffer.alloc(8 + 4 + head.length + shard.length);
    const id = next++;
    frame.writeUInt32LE(4 + head.length + shard.length, 0);
    frame.writeUInt32LE(id, 4);
    frame.writeUInt32LE(head.length, 8);
    head.copy(frame, 12);
    shard.copy(frame, 12 + head.length);
    return new Promise<Answer[]>((resolve, reject) => {
      waiting.set(id, { asks, resolve, reject });
      sock.write(frame);
    });
  };
  return { infer, close: () => sock.end() };
}
