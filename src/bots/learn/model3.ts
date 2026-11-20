// Network version 3 (BOT-LEAP.md, L3) in plain TypeScript: the same layers as ml/net3.py (read that docstring).
// It reads the same Encoded rows as versions 1 and 2. Only live tokens are computed: Pokémon in play, the cards
// with a count somewhere (card order, at most C) and the options; masked tokens never change a live one.
import { CARD_F, featureTable } from './card-features';
import { BAGS, CARD_KEYS, OPT_F, SLOTS, SLOT_F, VOCAB, type Encoded } from './encode';
import type { ModelJson, Output } from './model';

export interface Dims3 {
  E: number;
  D: number;
  L: number;
  HEADS: number;
  FF: number;
  C: number;
}

export interface Model3 {
  t: Record<string, Float32Array>;
  d: Dims3;
  /** Card vectors for the cards the engine has now (VOCAB × E). */
  cv: Float32Array;
  /** Globals the network reads. */
  keep: Int32Array;
}

function decode(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function loadV3(j: ModelJson, keep: Int32Array): Model3 {
  const dims = j.dims as unknown as Dims3 & { CARD_F: number; SLOT_F: number; OPT_F: number };
  if (dims.CARD_F !== CARD_F) throw new Error(`card features: model ${dims.CARD_F} ≠ ${CARD_F}`);
  if (dims.SLOT_F !== SLOT_F || dims.OPT_F !== OPT_F) throw new Error('model was trained on other encodings');
  const t: Record<string, Float32Array> = {};
  for (const [name, src] of Object.entries(j.tensors)) t[name] = decode(src.data);
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
  return { t, d, cv, keep };
}

/** out[outOff..] = W x[xOff..] + b (W: out × in, row-major). */
function linear(W: Float32Array, b: Float32Array | null, nin: number, x: Float32Array, xOff: number, out: Float32Array, outOff: number): void {
  const nout = W.length / nin;
  for (let j = 0; j < nout; j++) {
    let sum = b ? b[j]! : 0;
    const r = j * nin;
    for (let i = 0; i < nin; i++) sum += W[r + i]! * x[xOff + i]!;
    out[outOff + j] = sum;
  }
}

const K = Math.sqrt(2 / Math.PI);
const gelu = (x: number) => 0.5 * x * (1 + Math.tanh(K * (x + 0.044715 * x * x * x)));

/** Two-layer MLP with GELU between (net3.py MLP), input in x[xOff..xOff+nin), output into out[outOff..]. */
function mlp(t: Record<string, Float32Array>, name: string, nin: number, hidden: number, x: Float32Array, xOff: number, out: Float32Array, outOff: number): void {
  const h = new Float32Array(hidden);
  linear(t[`${name}.a.weight`]!, t[`${name}.a.bias`]!, nin, x, xOff, h, 0);
  for (let i = 0; i < hidden; i++) h[i] = gelu(h[i]!);
  linear(t[`${name}.b.weight`]!, t[`${name}.b.bias`]!, hidden, h, 0, out, outOff);
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
  mlp(t, 'glob_in', nGlob + E, D, gin, 0, g, 0);
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
    mlp(t, 'slot_in', 2 * E + SLOT_F, D, sin, 0, o, 0);
    for (let i = 0; i < D; i++) o[i]! += kind[D + i]!;
    return o;
  };
  for (let s = 0; s < SLOTS; s++) {
    const present = x.slots[s * SLOT_F]! > 0;
    slotX.push(present ? slotVec(s) : null);
    if (present) live.push(slotX[s]!);
  }

  // Cards with a count anywhere, in card order, at most C.
  const cin = new Float32Array(E + BAGS);
  let cards = 0;
  for (let v = 1; v < VOCAB && cards < d.C; v++) {
    let any = false;
    for (let b = 0; b < BAGS; b++) if (x.bags[b * VOCAB + v]! !== 0) any = true;
    if (!any) continue;
    cin.set(cv.subarray(v * E, v * E + E), 0);
    for (let b = 0; b < BAGS; b++) cin[E + b] = x.bags[b * VOCAB + v]!;
    const o = new Float32Array(D);
    mlp(t, 'card_in', E + BAGS, D, cin, 0, o, 0);
    for (let i = 0; i < D; i++) o[i]! += kind[2 * D + i]!;
    live.push(o);
    cards++;
  }

  // Options.
  const firstOpt = live.length;
  const oin = new Float32Array(E + OPT_F + D);
  for (let i = 0; i < nOpt; i++) {
    oin.fill(0);
    const c = x.optCard[i]!;
    oin.set(cv.subarray(c * E, c * E + E), 0);
    oin.set(x.optX.subarray(i * OPT_F, i * OPT_F + OPT_F), E);
    const sl = x.optSlot[i]!;
    if (sl >= 0) oin.set(slotX[sl] ?? slotVec(sl), E + OPT_F);
    const o = new Float32Array(D);
    mlp(t, 'opt_in', E + OPT_F + D, D, oin, 0, o, 0);
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
  const ln = new Float32Array(D);
  const qkv = new Float32Array(T * 3 * D);
  const y = new Float32Array(T * D);
  const p = new Float32Array(T);
  const ffh = new Float32Array(d.FF);
  const tmp = new Float32Array(D);
  for (let l = 0; l < d.L; l++) {
    const pre = `blocks.${l}.`;
    for (let i = 0; i < T; i++) {
      layerNorm(X, i * D, D, t[`${pre}ln1.weight`]!, t[`${pre}ln1.bias`]!, ln, 0);
      linear(t[`${pre}qkv.weight`]!, t[`${pre}qkv.bias`]!, D, ln, 0, qkv, i * 3 * D);
    }
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
    for (let i = 0; i < T; i++) {
      linear(t[`${pre}out.weight`]!, t[`${pre}out.bias`]!, D, y, i * D, tmp, 0);
      for (let k = 0; k < D; k++) X[i * D + k]! += tmp[k]!;
      layerNorm(X, i * D, D, t[`${pre}ln2.weight`]!, t[`${pre}ln2.bias`]!, ln, 0);
      linear(t[`${pre}ff1.weight`]!, t[`${pre}ff1.bias`]!, D, ln, 0, ffh, 0);
      for (let k = 0; k < d.FF; k++) ffh[k] = gelu(ffh[k]!);
      linear(t[`${pre}ff2.weight`]!, t[`${pre}ff2.bias`]!, d.FF, ffh, 0, tmp, 0);
      for (let k = 0; k < D; k++) X[i * D + k]! += tmp[k]!;
    }
  }
  const N = new Float32Array(T * D);
  for (let i = 0; i < T; i++) layerNorm(X, i * D, D, t['norm.weight']!, t['norm.bias']!, N, i * D);

  // Value: [global ‖ mean of live tokens].
  const vin = new Float32Array(2 * D);
  vin.set(N.subarray(0, D), 0);
  for (let i = 0; i < T; i++) for (let k = 0; k < D; k++) vin[D + k]! += N[i * D + k]! / T;
  const v = new Float32Array(1);
  mlp(t, 'value', 2 * D, 2 * D, vin, 0, v, 0);
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
