import { describe, expect, it } from 'vitest';
import { calibration, fitPlatt } from '../../src/analysis/calibration';
import { trainerCounts } from '../../src/analysis/counts';
import { canAnalyse, summarizeThreat, threats, type Plans } from '../../src/analysis/threat';
import { planFor } from '../../src/bots/plans';
import { next } from '../../src/engine/rng';
import { cloneState } from '../../src/engine/state';
import { deck, scenario } from '../engine/helpers';

const plans: Plans = { mine: planFor('player'), theirs: planFor('dragapult-ex') };
const FILL = 'psychic-energy';
const pct = (ko: number, n: number) => ko / n;

describe('threat report (ภัยเทิร์นหน้า)', () => {
  it('is zero when the opponent cannot attack', () => {
    // A Dreepy with no Energy and nothing in their hand or deck that can change that.
    const s = scenario({
      p0: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
      p1: { active: 'dreepy', hand: ['bosss-orders', 'bosss-orders'], deck: Array(10).fill('bosss-orders'), prizes: 2 },
    });
    const r = threats(s, 0, plans, { samples: 24 });
    expect(r.samples).toBe(24);
    expect(r.slots.map((x) => x.ko)).toEqual([0, 0]);
    expect(r.prizes[0]).toBe(24);
    expect(r.win).toBe(0);
  });

  it('is 100% for a Knock Out the opponent cannot miss, and names the attack', () => {
    // Phantom Dive (200) Knocks Out the Active Meowth ex and its 6 counters finish the damaged Latias ex.
    const s = scenario({
      p0: { active: 'meowth-ex', bench: [{ card: 'latias-ex', damage: 160 }, 'mega-kangaskhan-ex'] },
      p1: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] }, deck: Array(10).fill(FILL), prizes: 6 },
    });
    const r = threats(s, 0, plans, { samples: 16 });
    const [meowth, latias, kanga] = r.slots;
    expect(meowth!.active).toBe(true);
    expect(meowth!.ko).toBe(16);
    expect(latias!.ko).toBe(16);
    expect(kanga!.ko).toBe(0);
    expect(meowth!.lines[0]!.label).toContain('Phantom Dive');
    expect(r.prizes[4]).toBe(16);
  });

  it('gives the chance the opponent holds the Boss’s Orders it needs', () => {
    // Phantom Dive can't Knock Out the Active Kangaskhan (300 HP), only a gusted Meowth ex (170). One Boss's
    // Orders among the 14 cards you can't see (2 in hand, 10 in the deck, 2 Prizes); after their draw they
    // hold 3 of them, so the chance is 3/14.
    const s = scenario({
      p0: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
      p1: {
        active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] },
        hand: [FILL, FILL],
        deck: ['bosss-orders', ...Array(9).fill(FILL)],
        prizes: 2,
      },
    });
    const n = 420;
    const r = threats(s, 0, plans, { samples: n, seed: 5 });
    const meowth = r.slots.find((x) => x.name === 'Meowth ex')!;
    expect(pct(meowth.ko, n)).toBeGreaterThan(3 / 14 - 0.07);
    expect(pct(meowth.ko, n)).toBeLessThan(3 / 14 + 0.07);
    expect(meowth.lines[0]!.label).toBe("Boss's Orders → Phantom Dive");
    // Without the Boss, Phantom Dive hits the Kangaskhan instead.
    const kanga = r.slots.find((x) => x.name === 'Mega Kangaskhan ex')!;
    expect(kanga.ko).toBe(0);
    expect(kanga.hit).toBeGreaterThan(n * 0.6);
  });

  it('does not depend on where the hidden cards really are', () => {
    const s = scenario({
      p0: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'], deck: ['bosss-orders', ...Array(9).fill(FILL)] },
      p1: {
        active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] },
        hand: [FILL, FILL],
        deck: ['bosss-orders', ...Array(9).fill(FILL)],
        prizes: 2,
      },
    });
    // The same cards, with their Boss's Orders moved from the deck to their hand and your deck reversed.
    const t = cloneState(s);
    const them = t.players[1];
    [them.hand[0], them.deck[0]] = [them.deck[0]!, them.hand[0]!];
    t.players[0].deck.reverse();
    expect(threats(t, 0, plans, { samples: 40, seed: 9 })).toEqual(threats(s, 0, plans, { samples: 40, seed: 9 }));
  });

  it('is read only on your own main phase', () => {
    const s = scenario({ p0: { active: 'meowth-ex' }, p1: { active: 'dreepy' } });
    expect(canAnalyse(s, 0)).toBe(true);
    expect(canAnalyse(s, 1)).toBe(false);
    expect(canAnalyse({ ...s, winner: 0 }, 0)).toBe(false);
  });

  it('summarizes samples: Prizes per sample, Knock Out lines most common first', () => {
    const s = scenario({ p0: { active: 'meowth-ex', bench: ['latias-ex'] }, p1: { active: 'dreepy' } });
    const [a, b] = [s.players[0].active!.uid, s.players[0].bench[0]!.uid];
    const r = summarizeThreat(s, 0, [
      { ko: [a], damage: {}, prizes: 2, win: false, line: 'X' },
      { ko: [a], damage: { [b]: 30 }, prizes: 2, win: false, line: 'Y' },
      { ko: [a, b], damage: {}, prizes: 4, win: true, line: 'Y' },
      { ko: [], damage: { [a]: 50 }, prizes: 0, win: false, line: '' },
    ]);
    expect(r.prizes.slice(0, 5)).toEqual([1, 0, 2, 0, 1]);
    expect(r.win).toBe(1);
    expect(r.slots[0]).toMatchObject({ ko: 3, chance: 0.75, hit: 1, damage: 50, lines: [{ label: 'Y', n: 2 }, { label: 'X', n: 1 }] });
    expect(r.slots[1]).toMatchObject({ ko: 1, chance: 0.25, hit: 1, damage: 30 });
    // Meowth ex and Latias ex give 2 Prizes each.
    expect(r.expected).toBe(2);
    expect(r).toMatchObject({ winChance: 0.25, calibrated: false });
  });

  it('corrects the chances for the opponent’s deck, and keeps a sampled 0 at 0', () => {
    const s = scenario({
      p0: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
      p1: {
        active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] },
        hand: [FILL, FILL],
        deck: ['bosss-orders', ...Array(9).fill(FILL)],
        prizes: 2,
      },
    });
    const raw = threats(s, 0, plans, { samples: 48, seed: 3 });
    const fixed = threats(s, 0, plans, { samples: 48, seed: 3, theirDeck: 'dragapult-ex' });
    const c = calibration('dragapult-ex')!;
    const [kanga, meowth] = fixed.slots;
    expect(fixed.calibrated).toBe(true);
    expect(meowth!.ko).toBe(raw.slots[1]!.ko);
    expect(meowth!.chance).toBeCloseTo(c(meowth!.ko / 48), 10);
    expect(kanga!.chance).toBe(0);
    expect(fixed.expected).toBeCloseTo(meowth!.chance * 2, 10);
  });
});

describe('calibration', () => {
  it('fits a known correction back from outcomes', () => {
    // Outcomes happen with chance σ(−0.5 + 0.8·logit(p)): a model that overrates every chance.
    let r = 12345;
    const rand = () => {
      const [v, ns] = next(r);
      r = ns;
      return v;
    };
    const pairs: [number, 0 | 1][] = [];
    for (let i = 0; i < 20000; i++) {
      const p = Math.max(1, Math.round(rand() * 64)) / 64;
      const x = Math.log(Math.min(p, 1 - 1 / 128) / (1 - Math.min(p, 1 - 1 / 128)));
      pairs.push([p, rand() < 1 / (1 + Math.exp(-(-0.5 + 0.8 * x))) ? 1 : 0]);
    }
    const [a, b] = fitPlatt(pairs, 64);
    expect(a).toBeCloseTo(-0.5, 1);
    expect(b).toBeCloseTo(0.8, 1);
  });

  it('has a correction for every bot deck, rising with the sampled chance, and none for other decks', () => {
    expect(calibration('player')).toBeNull();
    expect(calibration(undefined)).toBeNull();
    for (const slug of ['dragapult-ex', 'basic-box', 'slowking', 'ns-zoroark-ex', 'alakazam', 'festival-lead-seaking', 'festival-lead-dipplin']) {
      const c = calibration(slug)!;
      expect(c, slug).not.toBeNull();
      expect(c(0.25)).toBeLessThan(c(0.5));
      expect(c(0.5)).toBeLessThan(c(0.75));
      expect(c(1)).toBeLessThan(1);
    }
    // Uniform re-deals overrate Festival Lead the most (calibration.ts).
    expect(calibration('festival-lead-dipplin')!(0.5)).toBeLessThan(0.45);
  });
});

describe('card counting', () => {
  it('counts the opponent’s Trainers by the reference list against their discard, Pokémon and Stadium', () => {
    const list = deck('dragapult-ex').cards;
    const s = scenario({
      p0: { active: 'meowth-ex' },
      p1: { active: { card: 'dreepy', tool: 'air-balloon' }, discard: ['bosss-orders', 'bosss-orders', 'ultra-ball'] },
    });
    const c = trainerCounts(s, 1, list);
    const boss = c.find((x) => x.key === 'bosss-orders')!;
    expect(boss).toMatchObject({ total: 3, seen: 2, trainerType: 'Supporter' });
    expect(c.find((x) => x.key === 'ultra-ball')).toMatchObject({ total: 3, seen: 1 });
    expect(c[0]!.trainerType).toBe('Supporter');
    expect(c.every((x) => x.seen <= x.total)).toBe(true);
    // Every Trainer of the list is there once.
    const trainers = new Set(list.filter((k) => c.some((x) => x.key === k)));
    expect(c.length).toBe(trainers.size);
  });
});
