// The chips beside "จบเทิร์น": what the player has used of the once-a-turn plays.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/engine/actions';
import { turnUses } from '../../src/ui/play';
import { handCard, scenario } from '../engine/helpers';

const states = (s: Parameters<typeof turnUses>[0]) => Object.fromEntries(turnUses(s).map((u) => [u.label, u.state]));

describe('what was used this turn', () => {
  it('starts free, marks each play once done, and resets next turn', () => {
    let s = scenario({ p0: { active: 'dreepy', bench: ['budew'], hand: ['fire-energy', 'judge'] }, p1: { active: 'abra' } });
    expect(states(s)).toEqual({ Supporter: 'free', ติดพลังงาน: 'free', ถอย: 'free' });
    s = apply(s, { t: 'energy', card: handCard(s, 0, 'fire-energy'), target: s.players[0].active!.uid });
    s = apply(s, { t: 'retreat', to: s.players[0].bench[0]!.uid });
    s = apply(s, { t: 'trainer', card: handCard(s, 0, 'judge') });
    expect(states(s)).toEqual({ Supporter: 'used', ติดพลังงาน: 'used', ถอย: 'used' });
    s = apply(s, { t: 'end' });
    expect(states(s)).toEqual({ Supporter: 'free', ติดพลังงาน: 'free', ถอย: 'free' });
  });

  it('the first player cannot play a Supporter on turn 1', () => {
    const s = scenario({ p0: { active: 'dreepy' }, p1: { active: 'abra' }, turn: 1 });
    expect(states(s).Supporter).toBe('barred');
  });
});
