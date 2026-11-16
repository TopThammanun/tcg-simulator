// Calibration check shared by the gates (threat-gate.ts, review-gate.ts): predictions grouped by chance
// (0–10%, 10–20%, …); a group passes when its predicted mean lies inside the interval of how often it
// happened. Predictions from one game go together, so the interval is a bootstrap over games; ten groups
// are tested at once, so each gets a 99.5% interval (Bonferroni), which a perfectly calibrated model passes
// 95% of the time. The 95% interval is shown too.

/** A prediction: chance, whether it happened (1/0, or ½ for a draw), and the game it came from. */
export interface Prediction {
  p: number;
  y: number;
  game: number;
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);

/** Intervals of the share of hits (95% and 99.5%), resampling whole games (seeded, so a gate is repeatable). */
export function bootstrap(xs: Prediction[], reps = 4000): { ci95: [number, number]; ci995: [number, number] } {
  const byGame = new Map<number, [number, number]>();
  for (const x of xs) {
    const t = byGame.get(x.game) ?? [0, 0];
    t[0] += x.y;
    t[1] += 1;
    byGame.set(x.game, t);
  }
  const games = [...byGame.values()];
  let r = 0x2545f491;
  const rand = () => {
    r ^= r << 13;
    r ^= r >>> 17;
    r ^= r << 5;
    return (r >>> 0) / 4294967296;
  };
  const shares: number[] = [];
  for (let k = 0; k < reps; k++) {
    let hits = 0;
    let n = 0;
    for (let j = 0; j < games.length; j++) {
      const [h, m] = games[Math.floor(rand() * games.length)]!;
      hits += h;
      n += m;
    }
    shares.push(hits / n);
  }
  shares.sort((a, b) => a - b);
  const at = (q: number) => shares[Math.min(reps - 1, Math.floor(reps * q))]!;
  return { ci95: [at(0.025), at(0.975)], ci995: [at(0.0025), at(0.9975)] };
}

/** Print the groups; returns how many groups (with at least `minN` predictions) failed. */
export function calibrationTable(xs: Prediction[], minN = 50): number {
  console.log('chance     n      predicted  happened (95% CI; 99.5% CI)');
  let failed = 0;
  for (let b = 0; b < 10; b++) {
    const inB = xs.filter(({ p }) => (b === 9 ? p >= 0.9 : p >= b / 10 && p < (b + 1) / 10));
    if (!inB.length) continue;
    const pred = mean(inB.map((x) => x.p));
    const real = mean(inB.map((x) => x.y));
    const { ci95, ci995 } = bootstrap(inB);
    const [lo, hi] = ci995;
    const ok = inB.length < minN || (pred >= lo && pred <= hi);
    if (!ok) failed++;
    const label = `${b * 10}–${b * 10 + 10}%`.padEnd(10);
    console.log(
      `${label} ${String(inB.length).padEnd(6)} ${pct(pred).padStart(8)}  ${pct(real).padStart(7)} (${pct(ci95[0])}–${pct(ci95[1])}; ${pct(lo)}–${pct(hi)})${inB.length < minN ? ' few' : ok ? '' : '  ✗'}`,
    );
  }
  const brier = mean(xs.map(({ p, y }) => (p - y) ** 2));
  const avg = mean(xs.map((x) => x.y));
  console.log(`Brier ${brier.toFixed(4)} (always guessing the average: ${mean(xs.map(({ y }) => (avg - y) ** 2)).toFixed(4)})`);
  return failed;
}
