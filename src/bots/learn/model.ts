// The policy/value network's forward pass in plain TypeScript (Node self-play, Web Workers, tests).
// Trained in PyTorch (ml/model.py has the same layers); weights come as JSON with base64 float32 tensors.
//   tokens: each Pokémon → Linear-ReLU-Linear-ReLU (shared), masked when the token is empty
//   pools:  my Active, my Bench mean + max, their Active, their Bench mean + max
//   trunk:  [pools, bags·W, globals, source card] → Linear-ReLU-Linear-ReLU = h
//   value:  h → 64 → 1 (chance that the acting player wins)
//   policy: each option [card, token it points at, numbers] → 128; score = w·ReLU(Wq h + Wk o + b) + c
// Version 2 (ModelJson.version = 2) changes only where card vectors come from: each card's vector is a learned
// vector for the cards it was trained with (by key; others share an "unknown" one) plus a projection of its
// printed features (card-features.ts), and each bag's weights per card are a projection of that vector. Both
// are computed once at load for the cards the engine has now, so new cards and changed lists need no new
// shapes. Its layer sizes come from the file, and it skips the deck-name globals.
import { CARD_F, featureTable } from './card-features';
import { BAGS, CARD_KEYS, DECK_NAMES, GLOB_F, OPT_F, SLOTS, SLOT_F, VOCAB, type Encoded } from './encode';
import { loadV3, run3, type Model3 } from './model3';

export const E = 16;
export const SH = 64;
export const BAGD = 16;
export const H = 256;
export const OH = 128;
export const TRUNK_IN = 6 * SH + BAGS * BAGD + GLOB_F + E;

export interface ModelJson {
  /** 2: card vectors from features (above); 3: the transformer of model3.ts; absent: version 1. */
  version?: 2 | 3;
  /** Version 1: card keys in embedding order (index + 1), must match CARD_KEYS. Version 2: the keys of id.emb rows 2+ (row 0 = no card, 1 = unknown). */
  cards: string[];
  dims: { E: number; SH: number; BAGD: number; H: number; OH: number; SLOT_F: number; GLOB_F: number; OPT_F: number; CARD_F?: number };
  tensors: Record<string, { shape: number[]; data: string }>;
  /** Free-form training notes (generation, games…). */
  meta?: Record<string, unknown>;
}

export interface Model {
  t: Record<string, Float32Array>;
  meta: Record<string, unknown>;
  dims: { E: number; SH: number; BAGD: number; H: number; OH: number };
  /** Globals the trunk reads (version 2 leaves the deck names out); null = all. */
  glob: Int32Array | null;
  /** Version 3: the transformer (model3.ts); t and dims are then unused. */
  v3?: Model3;
}

/** Version 2 drops the deck-name block of the globals (encode.ts: 2 + 2 × 19 numbers come before it). */
export const DECK_GLOB_AT = 2 + 2 * 19;
export const GLOB_KEEP = Int32Array.from({ length: GLOB_F }, (_, i) => i).filter((i) => i < DECK_GLOB_AT || i >= DECK_GLOB_AT + 2 * DECK_NAMES.length);

const V1_DIMS = { E, SH, BAGD, H, OH };

/** Version 2 tensor shapes for given sizes and number of trained card ids. */
export function v2Shapes(d: Model['dims'], ids: number): Record<string, number[]> {
  const trunkIn = 6 * d.SH + BAGS * d.BAGD + GLOB_KEEP.length + d.E;
  return {
    'id.emb': [ids + 2, d.E],
    'feat.w': [d.E, CARD_F],
    'feat.b': [d.E],
    'bag.p': [BAGS, d.BAGD, d.E],
    'bag.b': [BAGS * d.BAGD],
    'slot1.w': [d.SH, 2 * d.E + SLOT_F],
    'slot1.b': [d.SH],
    'slot2.w': [d.SH, d.SH],
    'slot2.b': [d.SH],
    'trunk1.w': [d.H, trunkIn],
    'trunk1.b': [d.H],
    'trunk2.w': [d.H, d.H],
    'trunk2.b': [d.H],
    'value1.w': [64, d.H],
    'value1.b': [64],
    'value2.w': [1, 64],
    'value2.b': [1],
    'opt1.w': [d.OH, d.E + d.SH + OPT_F],
    'opt1.b': [d.OH],
    'q.w': [d.OH, d.H],
    'k.w': [d.OH, d.OH],
    'att.b': [d.OH],
    'score.w': [1, d.OH],
    'score.b': [1],
  };
}

const NAMES: Record<string, number[]> = {
  emb: [VOCAB, E],
  'slot1.w': [SH, 2 * E + SLOT_F],
  'slot1.b': [SH],
  'slot2.w': [SH, SH],
  'slot2.b': [SH],
  'bag.w': [BAGS, VOCAB, BAGD],
  'bag.b': [BAGS * BAGD],
  'trunk1.w': [H, TRUNK_IN],
  'trunk1.b': [H],
  'trunk2.w': [H, H],
  'trunk2.b': [H],
  'value1.w': [64, H],
  'value1.b': [64],
  'value2.w': [1, 64],
  'value2.b': [1],
  'opt1.w': [OH, E + SH + OPT_F],
  'opt1.b': [OH],
  'q.w': [OH, H],
  'k.w': [OH, OH],
  'att.b': [OH],
  'score.w': [1, OH],
  'score.b': [1],
};

function decode(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function loadModel(j: ModelJson): Model {
  if (j.version === 3) return { t: {}, meta: j.meta ?? {}, dims: V1_DIMS, glob: GLOB_KEEP, v3: loadV3(j, GLOB_KEEP) };
  if (j.version === 2) return loadV2(j);
  const t: Record<string, Float32Array> = {};
  // Shapes as saved: the per-card tables have the vocabulary the network was trained with (j.cards).
  const saved = j.cards.length + 1;
  for (const [name, shape] of Object.entries(NAMES)) {
    const src = j.tensors[name];
    const want = name === 'emb' ? [saved, E] : name === 'bag.w' ? [BAGS, saved, BAGD] : shape;
    if (!src) throw new Error(`model is missing ${name}`);
    if (src.shape.join() !== want.join()) throw new Error(`${name}: shape ${src.shape} ≠ ${want}`);
    t[name] = decode(src.data);
  }
  if (j.cards.join() !== CARD_KEYS.join()) Object.assign(t, remapV1(t, j.cards));
  return { t, meta: j.meta ?? {}, dims: V1_DIMS, glob: null };
}

/**
 * A version-1 network on today's card list: rows of the cards it was trained with move to their new places;
 * cards added since get zeros (to it they are no card at all).
 */
function remapV1(t: Record<string, Float32Array>, trained: readonly string[]): { emb: Float32Array; 'bag.w': Float32Array } {
  const old = new Map(trained.map((k, i) => [k, i + 1]));
  const from = (v: number) => (v === 0 ? 0 : (old.get(CARD_KEYS[v - 1]!) ?? -1));
  const n = trained.length + 1;
  const emb = new Float32Array(VOCAB * E);
  const bw = new Float32Array(BAGS * VOCAB * BAGD);
  for (let v = 0; v < VOCAB; v++) {
    const o = from(v);
    if (o < 0) continue;
    emb.set(t.emb!.subarray(o * E, o * E + E), v * E);
    for (let b = 0; b < BAGS; b++) bw.set(t['bag.w']!.subarray((b * n + o) * BAGD, (b * n + o + 1) * BAGD), (b * VOCAB + v) * BAGD);
  }
  return { emb, 'bag.w': bw };
}

function loadV2(j: ModelJson): Model {
  const d = { E: j.dims.E, SH: j.dims.SH, BAGD: j.dims.BAGD, H: j.dims.H, OH: j.dims.OH };
  if (j.dims.CARD_F !== CARD_F) throw new Error(`card features: model ${j.dims.CARD_F} ≠ ${CARD_F}`);
  const t: Record<string, Float32Array> = {};
  for (const [name, shape] of Object.entries(v2Shapes(d, j.cards.length))) {
    const src = j.tensors[name];
    if (!src) throw new Error(`model is missing ${name}`);
    if (src.shape.join() !== shape.join()) throw new Error(`${name}: shape ${src.shape} ≠ ${shape}`);
    t[name] = decode(src.data);
  }
  return { t: { ...t, ...cardTables(t, d, j.cards) }, meta: j.meta ?? {}, dims: d, glob: GLOB_KEEP };
}

/**
 * The per-card tables run() reads (emb: VOCAB × E, bag.w: BAGS × VOCAB × BAGD) for the cards the engine has
 * now: vector = id.emb[its row, or "unknown"] + feat.w · features + feat.b; bag weights = bag.p[b] · vector.
 */
export function cardTables(t: Record<string, Float32Array>, d: Model['dims'], trained: readonly string[]): { emb: Float32Array; 'bag.w': Float32Array } {
  const row = new Map(trained.map((k, i) => [k, i + 2]));
  const feats = featureTable(CARD_KEYS);
  const emb = new Float32Array(VOCAB * d.E);
  const fw = t['feat.w']!;
  const fb = t['feat.b']!;
  const ids = t['id.emb']!;
  for (let v = 0; v < VOCAB; v++) {
    const id = v === 0 ? 0 : (row.get(CARD_KEYS[v - 1]!) ?? 1);
    for (let e = 0; e < d.E; e++) {
      let x = ids[id * d.E + e]! + fb[e]!;
      for (let f = 0; f < CARD_F; f++) x += fw[e * CARD_F + f]! * feats[v * CARD_F + f]!;
      emb[v * d.E + e] = x;
    }
  }
  const bw = new Float32Array(BAGS * VOCAB * d.BAGD);
  const bp = t['bag.p']!;
  for (let b = 0; b < BAGS; b++) {
    for (let v = 0; v < VOCAB; v++) {
      for (let k = 0; k < d.BAGD; k++) {
        let x = 0;
        for (let e = 0; e < d.E; e++) x += bp[(b * d.BAGD + k) * d.E + e]! * emb[v * d.E + e]!;
        bw[(b * VOCAB + v) * d.BAGD + k] = x;
      }
    }
  }
  return { emb, 'bag.w': bw };
}

/** A network with random weights (tests and benchmarks; not a player). */
export function randomModel(seed = 1): Model {
  let a = seed >>> 0 || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const t: Record<string, Float32Array> = {};
  for (const [name, shape] of Object.entries(NAMES)) {
    const n = shape.reduce((x, y) => x * y, 1);
    const fanIn = shape.length > 1 ? shape[shape.length - 1]! : 1;
    t[name] = Float32Array.from({ length: n }, () => (name.endsWith('.b') ? 0 : (r() * 2 - 1) * Math.sqrt(3 / fanIn)));
  }
  return { t, meta: {}, dims: V1_DIMS, glob: null };
}

/** y = W x + b (W is out × in, row-major), optionally ReLU. */
function linear(W: Float32Array, b: Float32Array | null, x: Float32Array, out: Float32Array, relu: boolean, xOff = 0, nin = x.length - xOff, outOff = 0): void {
  const nout = W.length / nin;
  for (let j = 0; j < nout; j++) {
    let sum = b ? b[j]! : 0;
    const row = j * nin;
    for (let i = 0; i < nin; i++) sum += W[row + i]! * x[xOff + i]!;
    out[outOff + j] = relu && sum < 0 ? 0 : sum;
  }
}

export interface Output {
  /** Chance that the acting player wins. */
  value: number;
  /** One logit per option. */
  logits: Float32Array;
}

/** Forward pass; `policy: false` skips the option scores (value only). */
export function run(m: Model, x: Encoded, policy = true): Output {
  if (m.v3) return run3(m.v3, x, policy);
  const t = m.t;
  const emb = t.emb!;
  // The model's own sizes (version 2 files carry theirs).
  const { E, SH, BAGD, H, OH } = m.dims;
  const nGlob = m.glob ? m.glob.length : GLOB_F;
  const TRUNK_IN = 6 * SH + BAGS * BAGD + nGlob + E;
  // Pokémon tokens.
  const tok = new Float32Array(SLOTS * SH);
  const inp = new Float32Array(2 * E + SLOT_F);
  const mid = new Float32Array(SH);
  for (let s = 0; s < SLOTS; s++) {
    if (x.slots[s * SLOT_F] === 0) continue;
    inp.set(emb.subarray(x.slotCards[s * 2]! * E, x.slotCards[s * 2]! * E + E), 0);
    inp.set(emb.subarray(x.slotCards[s * 2 + 1]! * E, x.slotCards[s * 2 + 1]! * E + E), E);
    inp.set(x.slots.subarray(s * SLOT_F, s * SLOT_F + SLOT_F), 2 * E);
    linear(t['slot1.w']!, t['slot1.b']!, inp, mid, true);
    linear(t['slot2.w']!, t['slot2.b']!, mid, tok, true, 0, SH, s * SH);
  }
  // Trunk input.
  const z = new Float32Array(TRUNK_IN);
  const pool = (first: number, at: number) => {
    let n = 0;
    for (let s = first; s < first + 8; s++) {
      if (x.slots[s * SLOT_F] === 0) continue;
      n++;
      for (let k = 0; k < SH; k++) {
        const v = tok[s * SH + k]!;
        z[at + k] += v;
        if (v > z[at + SH + k]!) z[at + SH + k] = v;
      }
    }
    if (n > 0) for (let k = 0; k < SH; k++) z[at + k] /= n;
  };
  z.set(tok.subarray(0, SH), 0);
  pool(1, SH);
  z.set(tok.subarray(9 * SH, 10 * SH), 3 * SH);
  pool(10, 4 * SH);
  let at = 6 * SH;
  const bw = t['bag.w']!;
  const bb = t['bag.b']!;
  for (let b = 0; b < BAGS; b++) {
    for (let k = 0; k < BAGD; k++) z[at + b * BAGD + k] = bb[b * BAGD + k]!;
    for (let v = 0; v < VOCAB; v++) {
      const c = x.bags[b * VOCAB + v]!;
      if (c === 0) continue;
      const row = (b * VOCAB + v) * BAGD;
      for (let k = 0; k < BAGD; k++) z[at + b * BAGD + k] += c * bw[row + k]!;
    }
  }
  at += BAGS * BAGD;
  if (m.glob) for (let i = 0; i < nGlob; i++) z[at + i] = x.glob[m.glob[i]!]!;
  else z.set(x.glob, at);
  at += nGlob;
  z.set(emb.subarray(x.source * E, x.source * E + E), at);

  const h1 = new Float32Array(H);
  const h = new Float32Array(H);
  linear(t['trunk1.w']!, t['trunk1.b']!, z, h1, true);
  linear(t['trunk2.w']!, t['trunk2.b']!, h1, h, true);
  const v1 = new Float32Array(64);
  linear(t['value1.w']!, t['value1.b']!, h, v1, true);
  const v2 = new Float32Array(1);
  linear(t['value2.w']!, t['value2.b']!, v1, v2, false);
  const value = 1 / (1 + Math.exp(-v2[0]!));

  const n = x.optCard.length;
  const logits = new Float32Array(n);
  if (!policy || n === 0) return { value, logits };
  const q = new Float32Array(OH);
  linear(t['q.w']!, null, h, q, false);
  const oin = new Float32Array(E + SH + OPT_F);
  const o = new Float32Array(OH);
  const u = new Float32Array(OH);
  const kw = t['k.w']!;
  const ab = t['att.b']!;
  const sw = t['score.w']!;
  const sb = t['score.b']![0]!;
  for (let i = 0; i < n; i++) {
    oin.fill(0);
    const c = x.optCard[i]!;
    oin.set(emb.subarray(c * E, c * E + E), 0);
    const sl = x.optSlot[i]!;
    if (sl >= 0) oin.set(tok.subarray(sl * SH, sl * SH + SH), E);
    oin.set(x.optX.subarray(i * OPT_F, i * OPT_F + OPT_F), E + SH);
    linear(t['opt1.w']!, t['opt1.b']!, oin, o, true);
    linear(kw, ab, o, u, false);
    let sc = sb;
    for (let k = 0; k < OH; k++) {
      const a = u[k]! + q[k]!;
      if (a > 0) sc += sw[k]! * a;
    }
    logits[i] = sc;
  }
  return { value, logits };
}

/** Softmax of logits / temperature. */
export function softmax(logits: Float32Array, temperature = 1): Float64Array {
  const p = new Float64Array(logits.length);
  let max = -Infinity;
  for (const l of logits) max = Math.max(max, l / temperature);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += p[i] = Math.exp(logits[i]! / temperature - max);
  for (let i = 0; i < p.length; i++) p[i] /= sum;
  return p;
}
