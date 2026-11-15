// The learned evaluation: board features, and the small network that turns them into a chance to win.
import { describe, expect, it } from 'vitest';
import { FEATURES, SIDE, features } from '../../src/bots/learn/features';
import { createNet, fit, fromJson, predict, toJson } from '../../src/bots/learn/net';
import { makeBot } from '../../src/bots/core';
import { planFor } from '../../src/bots/plans';
import { makeProBot, netValue } from '../../src/bots/pro';
import { playGame } from '../../src/sim/game';
import { deck, scenario } from '../engine/helpers';

const board = () =>
  scenario({
    p0: { active: { card: 'mega-kangaskhan-ex', energy: ['fire-energy', 'psychic-energy', 'fighting-energy'] }, bench: ['latias-ex'], prizes: 4 },
    p1: { active: { card: 'dreepy', damage: 30 }, bench: ['budew', 'dreepy'], prizes: 6 },
  });

describe('features', () => {
  it('has a fixed length of values between 0 and 1', () => {
    const f = features(board(), 0, ['player', 'Dragapult ex']);
    expect(f).toHaveLength(FEATURES);
    for (const v of f) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is the same board seen from the other side: the two halves swap', () => {
    const s = board();
    const mine = features(s, 0, ['player', 'Dragapult ex']);
    const theirs = features(s, 1, ['Dragapult ex', 'player']);
    const half = SIDE;
    expect(theirs.slice(0, half)).toEqual(mine.slice(half, 2 * half));
    expect(theirs.slice(half, 2 * half)).toEqual(mine.slice(0, half));
  });

  it('sees the Knock Out: Kangaskhan can KO the damaged Dreepy now, not the other way round', () => {
    const s = board();
    const f = features(s, 0, ['player', 'Dragapult ex']);
    const half = SIDE;
    // [prizes, has active, hp, damage, energy, missing, dmg now, dmg any, KO now, …]
    expect(f[8]).toBe(1);
    expect(f[half + 8]).toBe(0);
    expect(f[0]).toBeCloseTo(4 / 6);
  });
});

describe('the network', () => {
  it('learns a simple rule and keeps its answers through JSON', () => {
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const xs = Array.from({ length: 3000 }, () => [r(), r(), r()]);
    const ys = xs.map((x) => (x[0]! + 0.5 * x[2]! > x[1]! + 0.25 ? 1 : 0));
    const net = createNet([3, 16, 8, 1], 5);
    const losses = fit(net, xs, ys, { epochs: 40, lr: 0.01, batch: 64 });
    expect(losses[losses.length - 1]!).toBeLessThan(losses[0]! * 0.5);
    const correct = xs.filter((x, i) => (predict(net, x) > 0.5 ? 1 : 0) === ys[i]).length;
    expect(correct / xs.length).toBeGreaterThan(0.93);
    const back = fromJson(JSON.parse(JSON.stringify(toJson(net))));
    expect(predict(back, [0.9, 0.1, 0.5])).toBeCloseTo(predict(net, [0.9, 0.1, 0.5]), 4);
  });
});

describe('the pro bot', () => {
  it('scores a finished game as won or lost, whatever the network says', () => {
    const v = netValue(createNet([FEATURES, 4, 1], 1), ['player', 'Dragapult ex']);
    const s = board();
    expect(v({ ...s, winner: 0 }, 0)).toBe(1);
    expect(v({ ...s, winner: 0 }, 1)).toBe(0);
    const p = v(s, 0);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('plays a whole game with a network', () => {
    const net = createNet([FEATURES, 8, 1], 3);
    const pro = makeProBot(planFor('player'), planFor('dragapult-ex'), { seed: 1, net, samples: 1, breadth: 1 });
    const r = playGame({ seed: 5, decks: [deck('player'), deck('dragapult-ex')], bots: [pro, makeBot(planFor('dragapult-ex'), { seed: 2 })] });
    expect(r.winner).not.toBeNull();
  }, 60_000);
});
