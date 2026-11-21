// One-time tips: the most useful unseen one for the moment, each once.
import { describe, expect, it } from 'vitest';
import { nextTip, type TipId } from '../../src/ui/tips';

describe('tips', () => {
  const free = { free: true, canAttack: false, desktop: true };

  it('shows each tip once, the most useful first', () => {
    const seen = new Set<TipId>();
    const shown: (TipId | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const t = nextTip({ ...free, canAttack: true }, seen);
      shown.push(t);
      if (t) seen.add(t);
    }
    expect(shown).toEqual(['hand', 'attack', 'read-desktop', null]);
  });

  it('waits for its moment: the attack tip only with an attack, nothing while something is asked', () => {
    expect(nextTip(free, new Set(['hand']))).toBe('read-desktop');
    expect(nextTip({ ...free, canAttack: true }, new Set(['hand']))).toBe('attack');
    expect(nextTip({ ...free, free: false }, new Set())).toBeNull();
  });

  it('a phone is told to long-press, a computer to hover', () => {
    expect(nextTip({ ...free, desktop: false }, new Set(['hand', 'attack']))).toBe('read-touch');
  });
});
