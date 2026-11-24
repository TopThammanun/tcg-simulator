// A Pokémon in play as the zoomed card shows it (CardInfo): what the board draws small or not at all — HP left,
// Energy and Tool by name, conditions and what they do, effects on it, and the cards under it.
import { tx } from '../i18n';
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
  /** Effects lasting a while (can't attack next turn, protected). */
  marks: string[];
  /** The cards under it, the Basic first (what it evolved from). */
  under: string[];
}

export function condition(c: Condition): { name: string; does: string } {
  return c === 'poisoned'
    ? {
        name: tx('พิษ (Poisoned)', 'Poisoned'),
        does: tx('โดนดาเมจ 10 ทุกช่วงระหว่างเทิร์น จนกว่าจะถอยหรือวิวัฒนาการ', 'Takes 10 damage between turns until it retreats or evolves'),
      }
    : {
        name: tx('สับสน (Confused)', 'Confused'),
        does: tx(
          'ก่อนโจมตีต้องโยนเหรียญ ถ้าออกก้อย ท่าจะไม่ทำงานและโดนดาเมจ 30 เอง · หายเมื่อถอยหรือวิวัฒนาการ',
          'Flip a coin before attacking: tails = no attack and 30 damage to itself · ends when it retreats or evolves',
        ),
      };
}

function markText(m: Mark, s: GameState): string {
  const when = m.turn === s.turn ? tx('เทิร์นนี้', 'this turn') : tx(`เทิร์น ${m.turn}`, `turn ${m.turn}`);
  switch (m.kind) {
    case 'cant-attack':
      return tx(`โจมตีไม่ได้ (${when})`, `Can't attack (${when})`);
    case 'cant-use':
      return tx(`ใช้ ${m.attack} ไม่ได้ (${when})`, `Can't use ${m.attack} (${when})`);
    case 'cant-retreat':
      return tx(`ถอยไม่ได้ (${when})`, `Can't retreat (${when})`);
    case 'protected':
      return tx(`ไม่โดนดาเมจจากการโจมตี (${when})`, `No damage from attacks (${when})`);
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
      conditions: sl.conditions.map(condition),
      marks: sl.marks.filter((m) => m.turn >= s.turn).map((m) => markText(m, s)),
      under: sl.stack.slice(0, -1).map((c) => def(keyOf(s, c)).name),
    };
  }
  return null;
}
