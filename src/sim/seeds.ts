// Seeds for simulator batches, apart from runner.ts so pages can use them without loading the bots.

/** Seeds shared by both sides of an experiment (paired comparison). */
export function seedsFor(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (base + i * 7919) | 0);
}
