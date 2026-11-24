// The command bar under the table: what it says and which button is the main one, in every situation.
import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../../src/engine/actions';
import type { ChoiceRequest } from '../../src/engine/types';
import { actionBar, type Bar } from '../../src/ui/action-bar';
import { handActions } from '../../src/ui/play';
import { handCard, scenario } from '../engine/helpers';

const ids = (b: Bar) => b.buttons.map((x) => `${x.id}:${x.kind}${x.disabled ? ':off' : ''}`);

describe('the command bar', () => {
  const s = scenario({ p0: { active: { card: 'dreepy', energy: ['psychic-energy'] }, bench: ['budew'], hand: ['fire-energy', 'judge'] }, p1: { active: 'abra' } });
  const legal = legalActions(s);

  it('your turn: the chips and "จบเทิร์น", an ordinary button while there is something left to do', () => {
    const b = actionBar({ s, myTurn: true, legal });
    expect(b.kind).toBe('turn');
    expect(b.chips?.map((c) => c.label)).toEqual(['Supporter', 'ติดพลังงาน', 'ถอย']);
    expect(ids(b)).toEqual(['end:default']);
  });

  it('nothing left but to end the turn: "จบเทิร์น" becomes the main button', () => {
    const b = actionBar({ s, myTurn: true, legal: [{ t: 'end' }] });
    expect(ids(b)).toEqual(['end:primary']);
  });

  it('a tip shows in place of nothing; on a phone the bot\'s last turn is a button', () => {
    const b = actionBar({ s, myTurn: true, legal, tip: 'แตะการ์ด', recap: 4 });
    expect(b.text).toBe('แตะการ์ด');
    expect(b.tip).toBe(true);
    expect(b.buttons.map((x) => x.label)).toEqual(['บอทเล่นอะไรไป (4)', 'จบเทิร์น']);
    expect(b.buttons[0]!.narrowOnly).toBe(true);
  });

  it('a card picked up: play it, or why not', () => {
    const acts = handActions(s);
    const judge = handCard(s, 0, 'judge');
    const playable = actionBar({ s, myTurn: true, legal, held: { name: 'Judge', actions: acts.get(judge), playLabel: 'ใช้ Judge' } });
    expect(playable.kind).toBe('held');
    expect(ids(playable)).toEqual(['cancel:default', 'play:primary']);
    expect(playable.buttons[1]!.label).toBe('ใช้ Judge');
    const energy = actionBar({ s, myTurn: true, legal, held: { name: 'Fire Energy', actions: acts.get(handCard(s, 0, 'fire-energy')) } });
    expect(energy.text).toMatch(/แตะ Pokémon ที่สว่าง/);
    expect(ids(energy)).toEqual(['cancel:default']);
    const no = actionBar({ s, myTurn: true, legal, held: { name: 'X', why: 'Bench เต็ม' } });
    expect(no.why).toBe(true);
    expect(no.text).toBe('ตอนนี้ใช้ไม่ได้: Bench เต็ม');
  });

  it('ending the turn with an attack left asks first, the attack being the main answer', () => {
    const b = actionBar({ s, myTurn: true, legal, confirmEnd: true, attacksLeft: ['Bite'] });
    expect(b.kind).toBe('warn');
    expect(b.title).toBe('ยังโจมตีได้');
    expect(b.text).toContain('Bite');
    expect(ids(b)).toEqual(['back-to-attack:primary', 'end-anyway:default']);
  });

  it('leaving a game asks first, whoever\'s turn it is; leaving is the red one', () => {
    for (const myTurn of [true, false]) {
      const b = actionBar({ s, myTurn, legal, confirmNew: true });
      expect(b.title).toBe('ออกจากเกมนี้?');
      expect(ids(b)).toEqual(['stay:default', 'leave:danger']);
    }
  });

  it("the bot's turn: nothing to press, its last move", () => {
    const t = apply(s, { t: 'end' });
    const b = actionBar({ s: t, myTurn: false, legal: [] });
    expect(b.kind).toBe('wait');
    expect(b.buttons).toEqual([]);
    expect(b.text).toMatch(/^ตาบอท · /);
  });

  it('a choice in a box: its buttons are here, confirm only once enough is picked', () => {
    const req = { prompt: 'เลือก 2 ใบ', purpose: 'search', min: 2, max: 2, options: [] } as unknown as ChoiceRequest;
    expect(ids(actionBar({ s, myTurn: true, legal: [], box: { req, picks: [1], cards: true } }))).toEqual(['box-clear:default', 'box-confirm:primary:off']);
    expect(ids(actionBar({ s, myTurn: true, legal: [], box: { req, picks: [1, 2], cards: true } }))).toEqual(['box-clear:default', 'box-confirm:primary']);
    // Up to N cards, none taken: the button says so.
    const upTo = { ...req, min: 0 } as ChoiceRequest;
    expect(actionBar({ s, myTurn: true, legal: [], box: { req: upTo, picks: [], cards: true } }).buttons[1]!.label).toBe('ไม่เอาการ์ด');
    // One word to tap in the box (go first or second): nothing to confirm.
    const words = { ...req, min: 1, max: 1 } as ChoiceRequest;
    expect(actionBar({ s, myTurn: true, legal: [], box: { req: words, picks: [], cards: false } }).buttons).toEqual([]);
  });

  it('setup: the Active Spot first, then the Bench with its confirm', () => {
    expect(actionBar({ s, myTurn: true, legal: [], setup: { step: 'active', hint: '', picked: 0 } }).step).toBe('active');
    const bench = actionBar({ s, myTurn: true, legal: [], setup: { step: 'bench', hint: 'ไม่มี Basic ในมือแล้ว', picked: 1 } });
    expect(bench.step).toBe('bench');
    expect(bench.text).toBe('ไม่มี Basic ในมือแล้ว');
    expect(bench.buttons.map((x) => x.label)).toEqual(['ล้าง', 'ยืนยัน (ลง Bench 1 ตัว)']);
  });
});
