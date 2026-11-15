// A small fully connected network: ReLU hidden layers, one sigmoid output (the chance to win).
// Plain TypeScript so the same code trains in Node (scripts/train) and runs in the browser.

export interface Net {
  sizes: number[];
  /** W[l][j * in + i]: weight from input i to unit j of layer l. */
  W: Float64Array[];
  B: Float64Array[];
}

export interface NetJson {
  sizes: number[];
  W: number[][];
  B: number[][];
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNet(sizes: number[], seed = 1): Net {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  const W: Float64Array[] = [];
  const B: Float64Array[] = [];
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nin = sizes[l]!;
    const nout = sizes[l + 1]!;
    W.push(Float64Array.from({ length: nin * nout }, () => gauss() * Math.sqrt(2 / nin)));
    B.push(new Float64Array(nout));
  }
  return { sizes, W, B };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Activations of every layer (acts[0] = input); the last entry holds the output logit. */
function forward(net: Net, x: ArrayLike<number>): Float64Array[] {
  const acts: Float64Array[] = [Float64Array.from(x as ArrayLike<number>)];
  const L = net.W.length;
  for (let l = 0; l < L; l++) {
    const nin = net.sizes[l]!;
    const nout = net.sizes[l + 1]!;
    const a = acts[l]!;
    const W = net.W[l]!;
    const z = new Float64Array(nout);
    for (let j = 0; j < nout; j++) {
      let sum = net.B[l]![j]!;
      const row = j * nin;
      for (let i = 0; i < nin; i++) sum += W[row + i]! * a[i]!;
      z[j] = l < L - 1 && sum < 0 ? 0 : sum;
    }
    acts.push(z);
  }
  return acts;
}

/** Chance to win (0–1). */
export function predict(net: Net, x: ArrayLike<number>): number {
  const acts = forward(net, x);
  return sigmoid(acts[acts.length - 1]![0]!);
}

export interface FitOptions {
  epochs: number;
  lr?: number;
  batch?: number;
  l2?: number;
  seed?: number;
  /** Called after each epoch with the mean training loss. */
  onEpoch?: (epoch: number, loss: number) => void;
}

/** Train on (x, y) with y in [0, 1] (binary cross-entropy, Adam). Returns the loss per epoch. */
export function fit(net: Net, xs: ArrayLike<number>[], ys: number[], o: FitOptions): number[] {
  const lr = o.lr ?? 1e-3;
  const batch = o.batch ?? 256;
  const l2 = o.l2 ?? 1e-5;
  const r = rng(o.seed ?? 7);
  const L = net.W.length;
  const mW = net.W.map((w) => new Float64Array(w.length));
  const vW = net.W.map((w) => new Float64Array(w.length));
  const mB = net.B.map((b) => new Float64Array(b.length));
  const vB = net.B.map((b) => new Float64Array(b.length));
  const gW = net.W.map((w) => new Float64Array(w.length));
  const gB = net.B.map((b) => new Float64Array(b.length));
  const [b1, b2, eps] = [0.9, 0.999, 1e-8];
  let t = 0;
  const order = xs.map((_, i) => i);
  const losses: number[] = [];

  for (let epoch = 0; epoch < o.epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    let total = 0;
    for (let start = 0; start < order.length; start += batch) {
      const end = Math.min(order.length, start + batch);
      for (const g of gW) g.fill(0);
      for (const g of gB) g.fill(0);
      for (let k = start; k < end; k++) {
        const idx = order[k]!;
        const acts = forward(net, xs[idx]!);
        const p = sigmoid(acts[L]![0]!);
        const y = ys[idx]!;
        total += -(y * Math.log(p + 1e-12) + (1 - y) * Math.log(1 - p + 1e-12));
        let delta = new Float64Array([p - y]);
        for (let l = L - 1; l >= 0; l--) {
          const nin = net.sizes[l]!;
          const nout = net.sizes[l + 1]!;
          const a = acts[l]!;
          const W = net.W[l]!;
          const prev = new Float64Array(nin);
          for (let j = 0; j < nout; j++) {
            const d = delta[j]!;
            if (d === 0) continue;
            gB[l]![j] += d;
            const row = j * nin;
            for (let i = 0; i < nin; i++) {
              gW[l]![row + i] += d * a[i]!;
              prev[i] += W[row + i]! * d;
            }
          }
          // ReLU: no gradient through units that were off.
          if (l > 0) for (let i = 0; i < nin; i++) if (a[i]! <= 0) prev[i] = 0;
          delta = prev;
        }
      }
      const n = end - start;
      t++;
      const c1 = 1 - b1 ** t;
      const c2 = 1 - b2 ** t;
      const step = (w: Float64Array, g: Float64Array, m: Float64Array, v: Float64Array, decay: number) => {
        for (let i = 0; i < w.length; i++) {
          const gi = g[i]! / n + decay * w[i]!;
          m[i] = b1 * m[i]! + (1 - b1) * gi;
          v[i] = b2 * v[i]! + (1 - b2) * gi * gi;
          w[i] -= (lr * (m[i]! / c1)) / (Math.sqrt(v[i]! / c2) + eps);
        }
      };
      for (let l = 0; l < L; l++) {
        step(net.W[l]!, gW[l]!, mW[l]!, vW[l]!, l2);
        step(net.B[l]!, gB[l]!, mB[l]!, vB[l]!, 0);
      }
    }
    const loss = total / order.length;
    losses.push(loss);
    o.onEpoch?.(epoch, loss);
  }
  return losses;
}

export function toJson(net: Net): NetJson {
  const round = (a: Float64Array) => Array.from(a, (v) => Math.round(v * 1e6) / 1e6);
  return { sizes: net.sizes, W: net.W.map(round), B: net.B.map(round) };
}

export function fromJson(j: NetJson): Net {
  return { sizes: j.sizes, W: j.W.map((w) => Float64Array.from(w)), B: j.B.map((b) => Float64Array.from(b)) };
}
