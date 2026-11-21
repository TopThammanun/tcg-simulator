// Training rows on disk for ml/data.py: one file per worker batch. Layout: 8-byte header length, a JSON
// header (name → dtype, shape, offset), then the arrays. Floats are stored as float16 to halve the size.
import { writeFileSync } from 'node:fs';
import { BAGS, GLOB_F, OPT_F, SLOTS, SLOT_F, VOCAB } from '../../src/bots/learn/encode';
import { ORACLE, type Decision } from '../../src/bots/learn/netbot';
import type { PlayerId } from '../../src/engine/types';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >>> 13);
}

/** The value a float32 has after a round trip through toHalf (what training sees). */
export function roundHalf(v: number): number {
  const h = toHalf(v);
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return 0;
  if (exp === 31) return sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + mant / 1024);
}

class Grow<T extends Float32Array | Int32Array | Uint8Array | Uint16Array | Int16Array | Int8Array> {
  buf: T;
  n = 0;
  constructor(private readonly make: (n: number) => T) {
    this.buf = make(1 << 16);
  }
  reserve(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.n + k) size *= 2;
    const next = this.make(size);
    next.set(this.buf.subarray(0, this.n) as never);
    this.buf = next;
  }
  push(v: number): void {
    this.reserve(1);
    this.buf[this.n++] = v;
  }
  pushHalf(src: ArrayLike<number>): void {
    this.reserve(src.length);
    for (let i = 0; i < src.length; i++) this.buf[this.n++] = toHalf(src[i]!);
  }
  pushAll(src: ArrayLike<number>): void {
    this.reserve(src.length);
    for (let i = 0; i < src.length; i++) this.buf[this.n++] = src[i]!;
  }
  view(): T {
    return this.buf.subarray(0, this.n) as T;
  }
}

export class ShardWriter {
  private slots = new Grow((n) => new Uint16Array(n));
  private slotCards = new Grow((n) => new Int16Array(n));
  private bags = new Grow((n) => new Uint8Array(n));
  private glob = new Grow((n) => new Uint16Array(n));
  private source = new Grow((n) => new Int16Array(n));
  private optStart = new Grow((n) => new Int32Array(n));
  private optCount = new Grow((n) => new Int16Array(n));
  private chosen = new Grow((n) => new Int16Array(n));
  private logp = new Grow((n) => new Float32Array(n));
  private value = new Grow((n) => new Float32Array(n));
  private searched = new Grow((n) => new Uint8Array(n));
  private game = new Grow((n) => new Int32Array(n));
  private player = new Grow((n) => new Uint8Array(n));
  private outcome = new Grow((n) => new Float32Array(n));
  private optX = new Grow((n) => new Uint16Array(n));
  private optCard = new Grow((n) => new Int16Array(n));
  private optSlot = new Grow((n) => new Int8Array(n));
  /** The deciding network's logit per option, when it gave them (row flag `soft`). */
  private optLogit = new Grow((n) => new Uint16Array(n));
  private soft = new Grow((n) => new Uint8Array(n));
  /** Training-only labels (row flag `aux`): the opponent's hand by card, and the Prize difference at the end. */
  private oppHand = new Grow((n) => new Uint8Array(n));
  private aux = new Grow((n) => new Uint8Array(n));
  private prizeDiff = new Grow((n) => new Int8Array(n));
  /** Training-only: both players' Prize cards and the top of both decks (netbot.ts oracleOf), for the critic that sees all. */
  private oracle = new Grow((n) => new Int16Array(n));
  private open: { game: number; from: number } | null = null;
  rows = 0;

  /** Start a game; rows added until endGame() get its outcome. */
  beginGame(id: number): void {
    this.open = { game: id, from: this.rows };
  }

  add(d: Decision): void {
    const e = d.enc;
    this.slots.pushHalf(e.slots);
    this.slotCards.pushAll(e.slotCards);
    this.bags.reserve(e.bags.length);
    for (let i = 0; i < e.bags.length; i++) this.bags.push(Math.min(255, Math.round(e.bags[i]! * 4)));
    this.glob.pushHalf(e.glob);
    this.source.push(e.source);
    this.optStart.push(this.optCard.n);
    this.optCount.push(e.optCard.length);
    this.chosen.push(d.chosen);
    this.logp.push(d.logp);
    this.value.push(d.value);
    this.searched.push(d.searched ? 1 : 0);
    this.game.push(this.open?.game ?? -1);
    this.player.push(d.player);
    this.outcome.push(0.5);
    this.optX.pushHalf(e.optX);
    this.optCard.pushAll(e.optCard);
    this.optSlot.pushAll(e.optSlot);
    if (d.logits) this.optLogit.pushHalf(d.logits);
    else this.optLogit.pushAll(new Uint16Array(e.optCard.length));
    this.soft.push(d.logits ? 1 : 0);
    if (d.oppHand) this.oppHand.pushAll(d.oppHand);
    else this.oppHand.pushAll(new Uint8Array(VOCAB));
    this.aux.push(d.oppHand ? 1 : 0);
    this.prizeDiff.push(0);
    if (d.oracle) this.oracle.pushAll(d.oracle);
    else this.oracle.pushAll(new Int16Array(ORACLE));
    this.rows++;
  }

  /**
   * Label the open game's rows with who won (1 = that row's player won, 0.5 = draw / unfinished), and with the
   * Prize cards each player had taken at the end (row player's minus the other's), when given.
   */
  endGame(winner: PlayerId | 'draw' | null, taken?: [number, number]): void {
    if (!this.open) return;
    const out = this.outcome.buf;
    const pl = this.player.buf;
    const pd = this.prizeDiff.buf;
    for (let i = this.open.from; i < this.rows; i++) {
      out[i] = winner === 'draw' || winner === null ? 0.5 : winner === pl[i] ? 1 : 0;
      if (taken) pd[i] = taken[pl[i]!]! - taken[1 - pl[i]!]!;
    }
    this.open = null;
  }

  /** Drop the open game's rows (a game that broke). */
  dropGame(): void {
    if (!this.open) return;
    this.truncate(this.open.from);
    this.open = null;
  }

  private truncate(rows: number): void {
    const optFrom = rows < this.rows ? this.optStart.buf[rows]! : this.optCard.n;
    this.rows = rows;
    this.slots.n = rows * SLOTS * SLOT_F;
    this.slotCards.n = rows * SLOTS * 2;
    this.bags.n = rows * BAGS * VOCAB;
    this.glob.n = rows * GLOB_F;
    for (const g of [this.source, this.optStart, this.optCount, this.chosen, this.logp, this.value, this.searched, this.game, this.player, this.outcome, this.soft, this.aux, this.prizeDiff]) g.n = rows;
    this.oppHand.n = rows * VOCAB;
    this.oracle.n = rows * ORACLE;
    this.optX.n = optFrom * OPT_F;
    this.optCard.n = optFrom;
    this.optSlot.n = optFrom;
    this.optLogit.n = optFrom;
  }

  /** Empty again (one writer reused for many batches). */
  reset(): void {
    this.truncate(0);
    this.open = null;
  }

  write(path: string): void {
    writeFileSync(path, this.toBuffer());
  }

  /** The file's bytes; `extra` arrays (name, dtype, shape, data) go after the standard ones. */
  toBuffer(extra: [string, string, number[], ArrayBufferView][] = []): Buffer {
    const n = this.rows;
    const m = this.optCard.n;
    const arrays: [string, string, number[], ArrayBufferView][] = [
      ['slots', 'f2', [n, SLOTS, SLOT_F], this.slots.view()],
      ['slotCards', 'i2', [n, SLOTS, 2], this.slotCards.view()],
      ['bags', 'u1', [n, BAGS, VOCAB], this.bags.view()],
      ['glob', 'f2', [n, GLOB_F], this.glob.view()],
      ['source', 'i2', [n], this.source.view()],
      ['optStart', 'i4', [n], this.optStart.view()],
      ['optCount', 'i2', [n], this.optCount.view()],
      ['chosen', 'i2', [n], this.chosen.view()],
      ['logp', 'f4', [n], this.logp.view()],
      ['value', 'f4', [n], this.value.view()],
      ['searched', 'u1', [n], this.searched.view()],
      ['game', 'i4', [n], this.game.view()],
      ['player', 'u1', [n], this.player.view()],
      ['outcome', 'f4', [n], this.outcome.view()],
      ['optX', 'f2', [m, OPT_F], this.optX.view()],
      ['optCard', 'i2', [m], this.optCard.view()],
      ['optSlot', 'i1', [m], this.optSlot.view()],
      ['optLogit', 'f2', [m], this.optLogit.view()],
      ['soft', 'u1', [n], this.soft.view()],
      ['oppHand', 'u1', [n, VOCAB], this.oppHand.view()],
      ['aux', 'u1', [n], this.aux.view()],
      ['prizeDiff', 'i1', [n], this.prizeDiff.view()],
      ['oracle', 'i2', [n, ORACLE], this.oracle.view()],
      ...extra,
    ];
    const header: Record<string, { dtype: string; shape: number[]; offset: number }> = {};
    let offset = 0;
    for (const [name, dtype, shape, a] of arrays) {
      header[name] = { dtype, shape, offset };
      offset += a.byteLength;
      offset += (8 - (offset % 8)) % 8;
    }
    const head = Buffer.from(JSON.stringify(header));
    const out = Buffer.alloc(8 + head.length + offset);
    out.writeBigUInt64LE(BigInt(head.length), 0);
    head.copy(out, 8);
    const base = 8 + head.length;
    for (const [name, , , a] of arrays) Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(out, base + header[name]!.offset);
    return out;
  }
}
