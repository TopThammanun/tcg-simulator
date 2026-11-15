// The pop-up that opens when you tap one of your Pokémon: its attacks (and why one can't be used), its
// Abilities, and retreating.
import { describe, expect, it } from 'vitest';
import { legalActions } from '../../src/engine/actions';
import { slotMenu } from '../../src/ui/menu';
import { active, bench, scenario } from '../engine/helpers';

const board = (energy: string[], turn = 5) =>
  scenario({
    p0: {
      active: { card: 'mega-kangaskhan-ex', energy },
      bench: ['latias-ex', 'meowth-ex'],
    },
    p1: { active: 'dreepy' },
    turn,
  });

describe('tapping your Active Pokémon', () => {
  it('lists its attacks with cost, damage and text; usable ones carry the action', () => {
    const s = board(['fire-energy', 'psychic-energy', 'fighting-energy']);
    const m = slotMenu(s, legalActions(s), active(s, 0).uid)!;
    expect(m.attacks).toHaveLength(1);
    expect(m.attacks[0]).toMatchObject({
      name: 'Rapid-Fire Combo',
      cost: ['Colorless', 'Colorless', 'Colorless'],
      damage: '200+',
      action: { t: 'attack', name: 'Rapid-Fire Combo' },
      reason: null,
    });
    expect(m.attacks[0]!.effect).toContain('Flip a coin');
  });

  it("says why an attack can't be used", () => {
    const short = board(['fire-energy']);
    expect(slotMenu(short, legalActions(short), active(short, 0).uid)!.attacks[0]).toMatchObject({
      action: null,
      reason: 'พลังงานไม่พอ',
    });
    const first = { ...board(['fire-energy', 'psychic-energy', 'fighting-energy'], 1), first: 0 as const };
    expect(slotMenu(first, legalActions(first), active(first, 0).uid)!.attacks[0]!.reason).toBe('เทิร์นแรกของเกมโจมตีไม่ได้');
  });

  it('offers retreating to each Benched Pokémon, with the cost', () => {
    // Latias ex's Skyliner makes a Basic's retreat free.
    const s = board([]);
    const m = slotMenu(s, legalActions(s), active(s, 0).uid)!;
    expect(m.retreat).toMatchObject({ cost: 0, reason: null });
    expect(m.retreat!.options.map((o) => o.to)).toEqual([bench(s, 0, 0).uid, bench(s, 0, 1).uid]);
    expect(m.retreat!.options[0]!.action).toEqual({ t: 'retreat', to: bench(s, 0, 0).uid });
  });

  it("says why it can't retreat", () => {
    const s = board([]);
    s.players[0].retreated = true;
    expect(slotMenu(s, legalActions(s), active(s, 0).uid)!.retreat).toMatchObject({ options: [], reason: 'ถอยไปแล้วในเทิร์นนี้' });
    const alone = scenario({ p0: { active: 'mega-kangaskhan-ex' }, p1: { active: 'dreepy' } });
    expect(slotMenu(alone, legalActions(alone), active(alone, 0).uid)!.retreat!.reason).toBe('ไม่มี Pokémon บน Bench');
    const heavy = scenario({ p0: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] }, p1: { active: 'dreepy' } });
    expect(slotMenu(heavy, legalActions(heavy), active(heavy, 0).uid)!.retreat!.reason).toMatch(/^พลังงานไม่พอ/);
  });

  it('shows its Abilities; one it can use now carries the action', () => {
    const s = board([]);
    const m = slotMenu(s, legalActions(s), active(s, 0).uid)!;
    expect(m.abilities).toEqual([
      expect.objectContaining({ name: 'Run Errand', passive: false, action: { t: 'ability', slot: active(s, 0).uid, name: 'Run Errand' } }),
    ]);
  });
});

describe('tapping a Benched Pokémon', () => {
  it('has no attacks; it can be switched in when retreating is possible', () => {
    const s = board([]);
    const latias = bench(s, 0, 0);
    const m = slotMenu(s, legalActions(s), latias.uid)!;
    expect(m.active).toBe(false);
    expect(m.attacks).toEqual([]);
    expect(m.retreat!.options).toEqual([expect.objectContaining({ to: latias.uid, action: { t: 'retreat', to: latias.uid } })]);
    // Skyliner works by itself: shown, nothing to press.
    expect(m.abilities).toEqual([expect.objectContaining({ name: 'Skyliner', passive: true, action: null })]);
  });
});

it("has no menu for the other side's Pokémon", () => {
  const s = board([]);
  expect(slotMenu(s, legalActions(s), active(s, 1).uid)).toBeNull();
});
