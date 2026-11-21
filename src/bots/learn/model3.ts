// Network version 3 (BOT-LEAP.md, L3) in plain TypeScript: the same layers as ml/net3.py (read that docstring).
// It reads the same Encoded rows as versions 1 and 2. Only live tokens are computed: Pokémon in play, the cards
// with a count somewhere (card order, at most C) and the options; masked tokens never change a live one.
import { CARD_F, featureTable } from './card-features';
import { CARD_KEYS, INPUTS_V3, OPT_F, SLOTS, SLOT_F, VOCAB, type Encoded } from './encode';
import type { ModelJson, Output } from './model';
import { decodeTensor } from './tensor';

export interface Dims3 {
  E: number;
  D: number;
  L: number;
  HEADS: number;
  FF: number;
  C: number;
}

interface Mlp {
  aw: Float32Array;
  ab: Float32Array;
  bw: Float32Array;
  bb: Float32Array;
}

interface Block3 {
  ln1w: Float32Array;
  ln1b: Float32Array;
  qkvw: Float32Array;
  qkvb: Float32Array;
  outw: Float32Array;
  outb: Float32Array;
  ln2w: Float32Array;
  ln2b: Float32Array;
  ff1w: Float32Array;
  ff1b: Float32Array;
  ff2w: Float32Array;
  ff2b: Float32Array;
}

export interface Model3 {
  t: Record<string, Float32Array>;
  /** The tensors by layer, looked up once at load (not by name for every token). */
  mlps: Record<'glob_in' | 'slot_in' | 'card_in' | 'opt_in' | 'value', Mlp>;
  blocks: Block3[];
  d: Dims3;
  /** Card vectors for the cards the engine has now (VOCAB × E). */
  cv: Float32Array;
  /** Globals the network reads. */
  keep: Int32Array;
  /** Bags and numbers per option it reads (the first of the encoder's, model.ts). */
  inputs: { bags: number; optF: number };
}

export function loadV3(j: ModelJson, keep: Int32Array, inputs: { bags: number; optF: number }): Model3 {
  const dims = j.dims as unknown as Dims3 & { CARD_F: number; SLOT_F: number; OPT_F: number };
  if (dims.CARD_F !== CARD_F) throw new Error(`card features: model ${dims.CARD_F} ≠ ${CARD_F}`);
  if (dims.SLOT_F !== SLOT_F || dims.OPT_F > OPT_F) throw new Error('model was trained on other encodings');
  const t: Record<string, Float32Array> = {};
  for (const [name, src] of Object.entries(j.tensors)) t[name] = decodeTensor(src);
  const d: Dims3 = { E: dims.E, D: dims.D, L: dims.L, HEADS: dims.HEADS, FF: dims.FF, C: dims.C };
  // Card vectors (as Net3.card_vectors without dropout): id_emb[the card's row, or "unknown"] + feat · features.
  const row = new Map(j.cards.map((k, i) => [k, i + 2]));
  const feats = featureTable(CARD_KEYS);
  const cv = new Float32Array(VOCAB * d.E);
  const ids = t['id_emb.weight']!;
  const fw = t['feat.weight']!;
  const fb = t['feat.bias']!;
  for (let v = 0; v < VOCAB; v++) {
    const id = v === 0 ? 0 : (row.get(CARD_KEYS[v - 1]!) ?? 1);
    for (let e = 0; e < d.E; e++) {
      let x = ids[id * d.E + e]! + fb[e]!;
      for (let f = 0; f < CARD_F; f++) x += fw[e * CARD_F + f]! * feats[v * CARD_F + f]!;
      cv[v * d.E + e] = x;
    }
  }
  const mlp = (n: string): Mlp => ({ aw: t[`${n}.a.weight`]!, ab: t[`${n}.a.bias`]!, bw: t[`${n}.b.weight`]!, bb: t[`${n}.b.bias`]! });
  const mlps = { glob_in: mlp('glob_in'), slot_in: mlp('slot_in'), card_in: mlp('card_in'), opt_in: mlp('opt_in'), value: mlp('value') };
  const blocks = Array.from({ length: d.L }, (_, l): Block3 => {
    const g = (k: string) => t[`blocks.${l}.${k}`]!;
    return {
      ln1w: g('ln1.weight'), ln1b: g('ln1.bias'), qkvw: g('qkv.weight'), qkvb: g('qkv.bias'), outw: g('out.weight'), outb: g('out.bias'),
      ln2w: g('ln2.weight'), ln2b: g('ln2.bias'), ff1w: g('ff1.weight'), ff1b: g('ff1.bias'), ff2w: g('ff2.weight'), ff2b: g('ff2.bias'),
    };
  });
  return { t, mlps, blocks, d, cv, keep, inputs };
}

/** out[outOff..] = W x[xOff..] + b (W: out × in, row-major). Four running sums: about twice as fast in V8. */
function linear(W: Float32Array, b: Float32Array | null, nin: number, x: Float32Array, xOff: number, out: Float32Array, outOff: number): void {
  const nout = W.length / nin;
  const n4 = nin - (nin % 4);
  for (let j = 0; j < nout; j++) {
    const r = j * nin;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let i = 0;
    for (; i < n4; i += 4) {
      s0 += W[r + i]! * x[xOff + i]!;
      s1 += W[r + i + 1]! * x[xOff + i + 1]!;
      s2 += W[r + i + 2]! * x[xOff + i + 2]!;
      s3 += W[r + i + 3]! * x[xOff + i + 3]!;
    }
    for (; i < nin; i++) s0 += W[r + i]! * x[xOff + i]!;
    out[outOff + j] = (b ? b[j]! : 0) + s0 + s1 + s2 + s3;
  }
}

/**
 * The same layer for T rows at once (X: T × nin, out: T × nout): each weight row is read once for four rows of X,
 * which is where the time goes for the blocks (weights, not arithmetic).
 */
function linearRows(W: Float32Array, b: Float32Array, nin: number, X: Float32Array, T: number, out: Float32Array): void {
  const nout = W.length / nin;
  for (let j = 0; j < nout; j++) {
    const r = j * nin;
    const bj = b[j]!;
    let t = 0;
    for (; t + 4 <= T; t += 4) {
      const x0 = t * nin;
      const x1 = x0 + nin;
      const x2 = x1 + nin;
      const x3 = x2 + nin;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let i = 0; i < nin; i++) {
        const w = W[r + i]!;
        s0 += w * X[x0 + i]!;
        s1 += w * X[x1 + i]!;
        s2 += w * X[x2 + i]!;
        s3 += w * X[x3 + i]!;
      }
      out[t * nout + j] = bj + s0;
      out[(t + 1) * nout + j] = bj + s1;
      out[(t + 2) * nout + j] = bj + s2;
      out[(t + 3) * nout + j] = bj + s3;
    }
    for (; t < T; t++) {
      const x0 = t * nin;
      let s0 = 0;
      for (let i = 0; i < nin; i++) s0 += W[r + i]! * X[x0 + i]!;
      out[t * nout + j] = bj + s0;
    }
  }
}

const K = Math.sqrt(2 / Math.PI);
const gelu = (x: number) => 0.5 * x * (1 + Math.tanh(K * (x + 0.044715 * x * x * x)));

let hidden = new Float32Array(512);

/** Two-layer MLP with GELU between (net3.py MLP), input in x[xOff..xOff+nin), output into out[outOff..]. */
function mlp(m: Mlp, nin: number, nh: number, x: Float32Array, xOff: number, out: Float32Array, outOff: number): void {
  if (hidden.length < nh) hidden = new Float32Array(nh);
  linear(m.aw, m.ab, nin, x, xOff, hidden, 0);
  for (let i = 0; i < nh; i++) hidden[i] = gelu(hidden[i]!);
  linear(m.bw, m.bb, nh, hidden, 0, out, outOff);
}

/** mlp() for T rows at once (X: T × nin, out: T × D). */
function mlpRows(m: Mlp, nin: number, nh: number, X: Float32Array, T: number, out: Float32Array): void {
  const h = new Float32Array(T * nh);
  linearRows(m.aw, m.ab, nin, X, T, h);
  for (let i = 0; i < h.length; i++) h[i] = gelu(h[i]!);
  linearRows(m.bw, m.bb, nh, h, T, out);
}

function layerNorm(x: Float32Array, off: number, n: number, w: Float32Array, b: Float32Array, out: Float32Array, outOff: number): void {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[off + i]!;
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const z = x[off + i]! - mean;
    v += z * z;
  }
  const inv = 1 / Math.sqrt(v / n + 1e-5);
  for (let i = 0; i < n; i++) out[outOff + i] = (x[off + i]! - mean) * inv * w[i]! + b[i]!;
}

export function run3(m: Model3, x: Encoded, policy = true): Output {
  const { t, d, cv } = m;
  const { E, D } = d;
  const kind = t.kind!;
  // Options are tokens even for the value alone (they take part in the attention and the mean, as in net3.py).
  const nOpt = x.optCard.length;
  // Token order: global, live Pokémon, cards, options (the order doesn't change the result; Python's does the same).
  const nGlob = m.keep.length;
  const live: Float32Array[] = [];

  // Global.
  const gin = new Float32Array(nGlob + E);
  for (let i = 0; i < nGlob; i++) gin[i] = x.glob[m.keep[i]!]!;
  gin.set(cv.subarray(x.source * E, x.source * E + E), nGlob);
  const g = new Float32Array(D);
  mlp(m.mlps.glob_in, nGlob + E, D, gin, 0, g, 0);
  for (let i = 0; i < D; i++) g[i]! += kind[i]!;
  live.push(g);

  // Pokémon.
  const slotX: (Float32Array | null)[] = [];
  const sin = new Float32Array(2 * E + SLOT_F);
  const slotVec = (s: number) => {
    sin.set(cv.subarray(x.slotCards[s * 2]! * E, x.slotCards[s * 2]! * E + E), 0);
    sin.set(cv.subarray(x.slotCards[s * 2 + 1]! * E, x.slotCards[s * 2 + 1]! * E + E), E);
    sin.set(x.slots.subarray(s * SLOT_F, s * SLOT_F + SLOT_F), 2 * E);
    const o = new Float32Array(D);
    mlp(m.mlps.slot_in, 2 * E + SLOT_F, D, sin, 0, o, 0);
    for (let i = 0; i < D; i++) o[i]! += kind[D + i]!;
    return o;
  };
  for (let s = 0; s < SLOTS; s++) {
    const present = x.slots[s * SLOT_F]! > 0;
    slotX.push(present ? slotVec(s) : null);
    if (present) live.push(slotX[s]!);
  }

  // Cards with a count in any of the first 8 bags, in card order, at most C (their MLP runs on all of them at
  // once); each with its counts in every bag the network reads.
  const nBags = m.inputs.bags;
  const CI = E + nBags;
  const cin = new Float32Array(d.C * CI);
  let cards = 0;
  for (let v = 1; v < VOCAB && cards < d.C; v++) {
    let any = false;
    for (let b = 0; b < INPUTS_V3.bags; b++) if (x.bags[b * VOCAB + v]! !== 0) any = true;
    if (!any) continue;
    cin.set(cv.subarray(v * E, v * E + E), cards * CI);
    for (let b = 0; b < nBags; b++) cin[cards * CI + E + b] = x.bags[b * VOCAB + v]!;
    cards++;
  }
  const cout = new Float32Array(cards * D);
  mlpRows(m.mlps.card_in, CI, D, cin, cards, cout);
  for (let c = 0; c < cards; c++) {
    const o = cout.subarray(c * D, c * D + D);
    for (let i = 0; i < D; i++) o[i]! += kind[2 * D + i]!;
    live.push(o);
  }

  // Options.
  const firstOpt = live.length;
  const optF = m.inputs.optF;
  const oin = new Float32Array(E + optF + D);
  for (let i = 0; i < nOpt; i++) {
    oin.fill(0);
    const c = x.optCard[i]!;
    oin.set(cv.subarray(c * E, c * E + E), 0);
    oin.set(x.optX.subarray(i * OPT_F, i * OPT_F + optF), E);
    const sl = x.optSlot[i]!;
    if (sl >= 0) oin.set(slotX[sl] ?? slotVec(sl), E + optF);
    const o = new Float32Array(D);
    mlp(m.mlps.opt_in, E + optF + D, D, oin, 0, o, 0);
    for (let k = 0; k < D; k++) o[k]! += kind[3 * D + k]!;
    live.push(o);
  }

  // Transformer blocks over the live tokens.
  const T = live.length;
  const X = new Float32Array(T * D);
  live.forEach((v, i) => X.set(v, i * D));
  const H = d.HEADS;
  const dh = D / H;
  const scale = 1 / Math.sqrt(dh);
  const ln = new Float32Array(T * D);
  const qkv = new Float32Array(T * 3 * D);
  const y = new Float32Array(T * D);
  const p = new Float32Array(T);
  const ffh = new Float32Array(T * d.FF);
  const tmp = new Float32Array(T * D);
  for (const bl of m.blocks) {
    for (let i = 0; i < T; i++) layerNorm(X, i * D, D, bl.ln1w, bl.ln1b, ln, i * D);
    linearRows(bl.qkvw, bl.qkvb, D, ln, T, qkv);
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < T; i++) {
        const qo = i * 3 * D + h * dh;
        let max = -Infinity;
        for (let j = 0; j < T; j++) {
          const ko = j * 3 * D + D + h * dh;
          let s = 0;
          for (let k = 0; k < dh; k++) s += qkv[qo + k]! * qkv[ko + k]!;
          s *= scale;
          p[j] = s;
          if (s > max) max = s;
        }
        let sum = 0;
        for (let j = 0; j < T; j++) sum += p[j] = Math.exp(p[j]! - max);
        const yo = i * D + h * dh;
        for (let k = 0; k < dh; k++) y[yo + k] = 0;
        for (let j = 0; j < T; j++) {
          const w = p[j]! / sum;
          const vo = j * 3 * D + 2 * D + h * dh;
          for (let k = 0; k < dh; k++) y[yo + k]! += w * qkv[vo + k]!;
        }
      }
    }
    linearRows(bl.outw, bl.outb, D, y, T, tmp);
    for (let k = 0; k < T * D; k++) X[k]! += tmp[k]!;
    for (let i = 0; i < T; i++) layerNorm(X, i * D, D, bl.ln2w, bl.ln2b, ln, i * D);
    linearRows(bl.ff1w, bl.ff1b, D, ln, T, ffh);
    for (let k = 0; k < T * d.FF; k++) ffh[k] = gelu(ffh[k]!);
    linearRows(bl.ff2w, bl.ff2b, d.FF, ffh, T, tmp);
    for (let k = 0; k < T * D; k++) X[k]! += tmp[k]!;
  }
  const N = new Float32Array(T * D);
  for (let i = 0; i < T; i++) layerNorm(X, i * D, D, t['norm.weight']!, t['norm.bias']!, N, i * D);

  // Value: [global ‖ mean of live tokens].
  const vin = new Float32Array(2 * D);
  vin.set(N.subarray(0, D), 0);
  for (let i = 0; i < T; i++) for (let k = 0; k < D; k++) vin[D + k]! += N[i * D + k]! / T;
  const v = new Float32Array(1);
  mlp(m.mlps.value, 2 * D, 2 * D, vin, 0, v, 0);
  const value = 1 / (1 + Math.exp(-v[0]!));

  const logits = new Float32Array(x.optCard.length);
  if (!policy || nOpt === 0) return { value, logits };
  const q = new Float32Array(D);
  linear(t['q.weight']!, null, D, N, 0, q, 0);
  const u = new Float32Array(D);
  const sw = t['score.weight']!;
  const sb = t['score.bias']![0]!;
  for (let i = 0; i < nOpt; i++) {
    linear(t['k.weight']!, t['k.bias']!, D, N, (firstOpt + i) * D, u, 0);
    let s = sb;
    for (let k = 0; k < D; k++) s += sw[k]! * gelu(u[k]! + q[k]!);
    logits[i] = s;
  }
  return { value, logits };
}
