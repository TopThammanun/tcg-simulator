import { describe, expect, it } from 'vitest';
import { metaWeighted, pairedDiff, summarize, wilson, type GameRecord } from '../../src/sim/stats';

const rec = (opp: string, seed: number, winner: 0 | 1): GameRecord => ({
  seed,
  opp,
  winner,
  reason: '',
  turns: 10,
  first: 0,
  prizesBy: [{}, {}],
  doubleAttacks: [0, 0],
  gladion: [false, false],
  festivalGroundsOut: [false, false],
  mulligan: [false, false],
  maxThinkMs: 1,
  actions: 1,
});

describe('wilson', () => {
  it('is about ±3 points at 1,000 games and 50% (PLAN.md)', () => {
    const [lo, hi] = wilson(500, 1000);
    expect(hi - lo).toBeGreaterThan(0.058);
    expect(hi - lo).toBeLessThan(0.064);
  });
});

describe('metaWeighted', () => {
  it('weights each matchup by meta share', () => {
    const a = summarize('a', [rec('a', 1, 0), rec('a', 2, 0)]); // 100%
    const b = summarize('b', [rec('b', 1, 1), rec('b', 2, 1)]); // 0%
    expect(metaWeighted([a, b], (o) => (o === 'a' ? 3 : 1)).winRate).toBeCloseTo(0.75);
  });
});

describe('pairedDiff', () => {
  it('compares the same seeds and is zero when nothing changes', () => {
    const games = [rec('a', 1, 0), rec('a', 2, 1)];
    const d = pairedDiff(games, games, () => 1);
    expect(d.diff).toBe(0);
    expect(d.ci).toEqual([0, 0]);
  });

  it('reports B winning the seeds A lost', () => {
    const a = [rec('a', 1, 1), rec('a', 2, 0), rec('a', 3, 0), rec('a', 4, 0)];
    const b = [rec('a', 1, 0), rec('a', 2, 0), rec('a', 3, 0), rec('a', 4, 0)];
    const d = pairedDiff(a, b, () => 1);
    expect(d.diff).toBeCloseTo(0.25);
    expect(d.ci[0]).toBeLessThan(0.25);
    expect(d.ci[1]).toBeGreaterThan(0.25);
  });
});
