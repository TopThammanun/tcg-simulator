// The command bar's words when nothing is yours to press, and the setup Bench step's hint.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/engine/actions';
import type { ChoiceRequest } from '../../src/engine/types';
import { benchHint, waitingText } from '../../src/ui/play';
import { scenario } from '../engine/helpers';

describe('the command bar while you wait', () => {
  it("on the bot's turn: whose move it is and the last thing that happened", () => {
    let s = scenario({ p0: { active: 'dreepy' }, p1: { active: 'abra' } });
    s = apply(s, { t: 'end' });
    const last = s.log[s.log.length - 1]!.text;
    expect(waitingText(s, {})).toBe(`ตาบอท · ${last}`);
    expect(waitingText(s, { watch: true })).toBe(`ดูบอทเล่น · ${last}`);
  });

  it('a question asked in a box over the table, an earlier position, the result', () => {
    const s = scenario({ p0: { active: 'dreepy' }, p1: { active: 'abra' } });
    expect(waitingText(s, { prompt: 'เลือกการ์ด 1 ใบ' })).toBe('เลือกการ์ด 1 ใบ');
    expect(waitingText(s, { viewing: true, prompt: 'x' })).toMatch(/^กำลังดูสนามย้อนหลัง/);
    expect(waitingText({ ...s, winner: 1, winReason: 'เก็บ Prize ครบ' }, { prompt: 'x' })).toBe('บอทชนะ · เก็บ Prize ครบ');
    expect(waitingText({ ...s, winner: 'draw', winReason: '' }, {})).toBe('เสมอ');
  });
});

describe('setup: putting Basics on the Bench', () => {
  // As the engine asks it: `max` is the Bench's room cut to the Basics in hand (engine pickCards).
  const req = (basics: number, room = 5, hint?: string) =>
    ({
      prompt: '',
      purpose: 'setup-bench',
      min: 0,
      max: Math.min(room, basics),
      hint,
      options: Array.from({ length: basics }, (_, i) => ({ value: i, label: `Basic ${i}`, card: i })),
    }) as unknown as ChoiceRequest;

  it('counts the Basics left in the hand, not only the room on the Bench', () => {
    expect(benchHint(req(3), 0, 5)).toBe('ลาก Basic ลง Bench ได้อีก 3 ตัว (หรือแตะการ์ด)');
    expect(benchHint(req(3), 1, 5)).toBe('ลาก Basic ลง Bench ได้อีก 2 ตัว (หรือแตะการ์ด) · แตะตัวบน Bench เพื่อเอาคืน');
    // One Basic in hand, put down: the Bench isn't full, the hand has none left.
    expect(benchHint(req(1), 1, 5)).toBe('ไม่มี Basic ในมือแล้ว · แตะตัวบน Bench เพื่อเอาคืน');
    expect(benchHint(req(7), 5, 5)).toBe('ลง Bench ครบแล้ว · แตะตัวบน Bench เพื่อเอาคืน');
    expect(benchHint(req(5), 5, 5)).toBe('ลง Bench ครบแล้ว · แตะตัวบน Bench เพื่อเอาคืน');
  });

  it("says when the Basics come from the opponent's mulligan", () => {
    expect(benchHint(req(2, 5, 'mulligan'), 0, 5)).toMatch(/^Basic ที่จั่วเพิ่มจาก mulligan ของคู่แข่ง · /);
  });
});
