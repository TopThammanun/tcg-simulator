// The recap of the bot's last turn shown when yours starts.
import { describe, expect, it } from 'vitest';
import { lastOpponentTurn, shortRecap, turnRecap } from '../../src/ui/recap';
import { scenario } from '../engine/helpers';

describe('turn recap', () => {
  const s = scenario({ p0: { active: 'abra' }, p1: { active: 'abra' }, turn: 8 });
  const line = (turn: number, player: 0 | 1 | null, text: string) => ({ turn, player, text, step: 0 });
  s.log = [
    line(6, 0, '— เทิร์น 6: คุณ —'),
    line(6, 0, 'คุณ ใช้ Judge'),
    line(7, 1, '— เทิร์น 7: บอท —'),
    line(7, 1, 'บอท จั่ว 1 ใบ'),
    line(7, 1, 'บอท ใช้ Ability Teal Dance (Teal Mask Ogerpon ex)'),
    line(7, 1, 'บอท จั่ว 1 ใบ'),
    line(7, 1, 'บอท: Teal Mask Ogerpon ex ใช้ Myriad Leaf Shower'),
    line(7, null, 'Dragapult ex โดน 210'),
    line(8, 0, '— เทิร์น 8: คุณ —'),
    line(8, 0, 'คุณ จั่ว 1 ใบ'),
  ];

  it('keeps what happened, without the header and the opening draw', () => {
    expect(turnRecap(s, 7)).toEqual([
      'บอท ใช้ Ability Teal Dance (Teal Mask Ogerpon ex)',
      'บอท จั่ว 1 ใบ',
      'บอท: Teal Mask Ogerpon ex ใช้ Myriad Leaf Shower',
      'Dragapult ex โดน 210',
    ]);
  });

  it('is the turn before yours, only on your turn', () => {
    expect(lastOpponentTurn(s)).toEqual(turnRecap(s, 7));
    expect(lastOpponentTurn({ ...s, current: 1 })).toEqual([]);
    expect(lastOpponentTurn({ ...s, turn: 1 })).toEqual([]);
  });

  it('merges a line repeated in a row and keeps the start and the end of a long turn', () => {
    const t = scenario({ p0: { active: 'abra' }, p1: { active: 'abra' }, turn: 4 });
    t.log = ['บอท วาง Dreepy บน Bench', 'บอท วาง Dreepy บน Bench', 'บอท วาง Dreepy บน Bench', 'บอท ใช้ Judge'].map((text) => line(3, 1, text));
    expect(turnRecap(t, 3)).toEqual(['บอท วาง Dreepy บน Bench ×3', 'บอท ใช้ Judge']);
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(shortRecap(many, 6)).toEqual({ head: ['a', 'b', 'c'], skipped: 2, tail: ['f', 'g', 'h'] });
    expect(shortRecap(['a', 'b'], 6)).toEqual({ head: ['a', 'b'], skipped: 0, tail: [] });
  });
});
