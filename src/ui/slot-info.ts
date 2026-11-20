// A Pokémon in play as the zoomed card shows it (CardInfo): what the board draws small or not at all — HP left,
// Energy and Tool by name, conditions and what they do, effects on it, and the cards under it.
import type { EnergyType } from '../data/cards';
import { def } from '../engine/db';
import { maxHp, provides } from '../engine/rules';
import { keyOf, slotsOf } from '../engine/state';
import type { Condition, GameState, Mark, PlayerId, SlotId } from '../engine/types';

export interface SlotInfo {
  owner: PlayerId;
  active: boolean;
  hp: { left: number; max: number };
  energy: { name: string; type: EnergyType }[];
  tool: string | null;
  conditions: { name: string; does: string }[];
  /** Effects lasting a while (can't attack next turn, protected), in Thai. */
  marks: string[];
  /** The cards under it, the Basic first (what it evolved from). */
  under: string[];
}

export const CONDITION: Record<Condition, { name: string; does: string }> = {
  poisoned: { name: 'พิษ (Poisoned)', does: 'โดนดาเมจ 10 ทุกครั้งที่จบเทิร์น จนกว่าจะถอยหรือวิวัฒนาการ' },
  confused: {
    name: 'สับสน (Confused)',
    does: 'ก่อนโจมตีต้องโยนเหรียญ: ก้อย = โจมตีไม่ได้และโดน 30 เอง · หายเมื่อถอยหรือวิวัฒนาการ',
  },
};

function markText(m: Mark, s: GameState): string {
  const when = m.turn === s.turn ? 'เทิร์นนี้' : `เทิร์น ${m.turn}`;
  switch (m.kind) {
    case 'cant-attack':
      return `โจมตีไม่ได้ (${when})`;
    case 'cant-use':
      return `ใช้ ${m.attack} ไม่ได้ (${when})`;
    case 'cant-retreat':
      return `ถอยไม่ได้ (${when})`;
    case 'protected':
      return `ไม่โดนดาเมจจากการโจมตี (${when})`;
  }
}

export function slotInfo(s: GameState, uid: SlotId): SlotInfo | null {
  for (const owner of [0, 1] as PlayerId[]) {
    const ps = s.players[owner];
    const sl = slotsOf(ps).find((x) => x.uid === uid);
    if (!sl) continue;
    const max = maxHp(s, sl);
    return {
      owner,
      active: ps.active?.uid === uid,
      hp: { left: Math.max(0, max - sl.damage), max },
      energy: sl.energy.map((e) => {
        const k = keyOf(s, e);
        return { name: def(k).name, type: def(k).category === 'energy' ? provides(k) : ('Colorless' as EnergyType) };
      }),
      tool: sl.tool !== null ? def(keyOf(s, sl.tool)).name : null,
      conditions: sl.conditions.map((c) => CONDITION[c]),
      marks: sl.marks.filter((m) => m.turn >= s.turn).map((m) => markText(m, s)),
      under: sl.stack.slice(0, -1).map((c) => def(keyOf(s, c)).name),
    };
  }
  return null;
}
