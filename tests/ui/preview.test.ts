// The attack button's preview: what the attack would do to the opponent's Active, played out on re-dealt copies.
import { describe, expect, it } from 'vitest';
import { previewAttack, previewText } from '../../src/ui/preview';
import { scenario } from '../engine/helpers';

describe('attack preview', () => {
  it('counts Weakness in the damage', () => {
    const s = scenario({ p0: { active: { card: 'zeraora', energy: ['psychic-energy'] } }, p1: { active: 'psyduck', bench: ['budew'] } });
    const p = previewAttack(s, { t: 'attack', name: 'Scratch' })!;
    expect(p).toMatchObject({ min: 40, max: 40, ko: 0, weak: true, resist: false });
    expect(previewText(p)).toBe('ดาเมจเข้าตัวหลัก 40 (จุดอ่อน ×2)');
  });

  it('says when the Active is Knocked Out for sure', () => {
    const s = scenario({ p0: { active: { card: 'dragapult-ex', energy: ['psychic-energy'] } }, p1: { active: 'budew', bench: ['dreepy'] } });
    const p = previewAttack(s, { t: 'attack', name: 'Jet Headbutt' })!;
    expect(p.ko).toBe(1);
    expect(previewText(p)).toBe('KO ตัวหลักได้แน่นอน');
  });

  it('gives a range and a Knock Out chance when coins decide, and never peeks at the real coin flips', () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', energy: ['fire-energy', 'psychic-energy', 'fighting-energy'] } },
      p1: { active: 'koraidon-ex', bench: ['budew'] },
    });
    const a = { t: 'attack', name: 'Rapid-Fire Combo' } as const;
    const p = previewAttack(s, a)!;
    expect(p.ko).toBeGreaterThan(0);
    expect(p.ko).toBeLessThan(1);
    // At least one heads in a row of coins: a half.
    expect(previewText(p)).toBe('โอกาส KO ตัวหลัก ~50% · ถ้าไม่ KO ดาเมจเข้า 200');
    // Another real coin sequence: the same preview.
    const other = { ...s, rng: { shuffle: [999, 1001] as [number, number], coin: 424242 } };
    expect(previewAttack(other, a)).toEqual(p);
  });
});
