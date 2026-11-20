// A zoomed Pokémon in play: its state in words (HP left, Energy, Tool, conditions, effects, the cards under it).
import { describe, expect, it } from 'vitest';
import { slotInfo } from '../../src/ui/slot-info';
import { scenario } from '../engine/helpers';

describe('slot info', () => {
  it('reads HP, Energy, Tool, conditions, effects and the evolution under it', () => {
    const s = scenario({
      p0: { active: 'abra' },
      p1: {
        active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'], tool: 'heros-cape', damage: 90 },
      },
    });
    const a = s.players[1].active!;
    a.conditions = ['confused'];
    a.marks = [{ kind: 'cant-attack', turn: s.turn + 1 }, { kind: 'cant-retreat', turn: s.turn - 1 }];
    const info = slotInfo(s, a.uid)!;
    expect(info).toMatchObject({
      owner: 1,
      active: true,
      tool: "Hero's Cape",
      under: ['Dreepy', 'Drakloak'],
      energy: [
        { name: 'Fire Energy', type: 'Fire' },
        { name: 'Psychic Energy', type: 'Psychic' },
      ],
    });
    expect(info.hp.left).toBe(info.hp.max - 90);
    expect(info.conditions[0]!.name).toMatch(/สับสน/);
    expect(info.conditions[0]!.does).toMatch(/โยนเหรียญ/);
    // An effect that has run out isn't listed.
    expect(info.marks).toEqual([`โจมตีไม่ได้ (เทิร์น ${s.turn + 1})`]);
    expect(slotInfo(s, 999)).toBeNull();
  });
});
