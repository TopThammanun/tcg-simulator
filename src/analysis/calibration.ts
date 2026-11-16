// From sampled chances to real ones. Re-dealing the opponent's hidden cards uniformly gives them better
// hands than they really hold (real hands keep the cards they couldn't use: Stage 1s that can't evolve yet,
// Gladion and Boss's Orders waiting for their turn), so a sampled 50% happens 38–52% of the time depending
// on the deck, least often against Festival Lead. scripts/threat-gate.ts --fit measures this per opponent deck on bot games
// and fits q = σ(a + b·logit(p)) (Platt scaling: two numbers per deck, smooth, never exactly 0 or 1);
// the gate then checks the corrected chances on other games.
import table from './calibration.json';

export interface CalibrationTable {
  /** Samples per prediction the fit was made with (sets how far 0 and 1 are clipped). */
  samples: number;
  /** Per opponent deck slug: [a, b]. */
  decks: Record<string, [number, number]>;
}

// The JSON's per-deck pairs come in as number[]; scripts/threat-gate.ts --fit writes exactly [a, b].
const TABLE = table as unknown as CalibrationTable;

const logit = (p: number, n: number) => {
  const e = 1 / (2 * n);
  const q = Math.min(1 - e, Math.max(e, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The correction for an opponent playing `deck`, or null when it has none. */
export function calibration(deck: string | undefined, t: CalibrationTable = TABLE): ((p: number) => number) | null {
  const ab = deck ? t.decks[deck] : undefined;
  if (!ab) return null;
  return (p) => sigmoid(ab[0] + ab[1] * logit(p, t.samples));
}

/** Logistic regression of outcomes on logit(predicted chance) by Newton's method: [a, b]. */
export function fitPlatt(pairs: [number, 0 | 1][], samples: number): [number, number] {
  let a = 0;
  let b = 1;
  const xs = pairs.map(([p]) => logit(p, samples));
  for (let it = 0; it < 50; it++) {
    // Gradient and Hessian of the log-likelihood (with a tiny ridge so it stays invertible).
    let ga = 0;
    let gb = 0;
    let haa = 1e-6;
    let hab = 0;
    let hbb = 1e-6;
    pairs.forEach(([, y], i) => {
      const x = xs[i]!;
      const q = sigmoid(a + b * x);
      const w = q * (1 - q);
      ga += y - q;
      gb += (y - q) * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    });
    const det = haa * hbb - hab * hab;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return [Math.round(a * 1e4) / 1e4, Math.round(b * 1e4) / 1e4];
}
