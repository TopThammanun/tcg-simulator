// Seeded RNG (mulberry32). State is a plain number kept inside GameState, so games replay exactly.

export function next(state: number): [value: number, state: number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Derive independent stream seeds from one game seed (splitmix32). */
export function derive(seed: number, stream: number): number {
  let z = (seed + Math.imul(stream + 1, 0x9e3779b9)) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) | 0;
}

/** Fisher–Yates shuffle in place; returns the new RNG state. */
export function shuffleInPlace<T>(arr: T[], state: number): number {
  let s = state;
  for (let i = arr.length - 1; i > 0; i--) {
    const [r, ns] = next(s);
    s = ns;
    const j = Math.floor(r * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return s;
}
