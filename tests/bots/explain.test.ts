// The hint button says why: reasons read from the position, and facts from playing the move out.
import { describe, expect, it } from 'vitest';
import { suggest } from '../../src/bots/coach';
import { explainAction, explainPlan } from '../../src/bots/explain';
import { planFinish } from '../../src/bots/finisher';
import { DEFAULT_POLICY, planFor } from '../../src/bots/plans';
import { actionLabel } from '../../src/ui/play';
import { active, handCard, scenario } from '../engine/helpers';

const plan = planFor('player', DEFAULT_POLICY);
const three = ['psychic-energy', 'psychic-energy', 'psychic-energy'];

describe('why attach this Energy', () => {
  it('says the attack becomes usable right away', () => {
    const s = scenario({
      p0: { active: { card: 'teal-mask-ogerpon-ex', energy: ['grass-energy', 'grass-energy'] }, hand: ['grass-energy'] },
      p1: { active: 'dreepy' },
    });
    const e = explainAction(s, 0, { action: { t: 'energy', card: handCard(s, 0, 'grass-energy'), target: active(s, 0).uid } }, plan);
    expect(e.why).toContain('Myriad Leaf Shower');
    expect(e.why).toContain('ได้ทันที');
  });

  it('counts the Energy still missing', () => {
    const s = scenario({ p0: { active: 'teal-mask-ogerpon-ex', hand: ['grass-energy'] }, p1: { active: 'dreepy' } });
    const e = explainAction(s, 0, { action: { t: 'energy', card: handCard(s, 0, 'grass-energy'), target: active(s, 0).uid } }, plan);
    expect(e.why).toContain('ขาดอีก 2');
  });
});

describe('why attack', () => {
  it('reports the Knock Out and the Prize taken', () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', energy: three } },
      p1: { active: 'dreepy', bench: ['dreepy'] },
    });
    const e = explainAction(s, 0, { action: { t: 'attack', name: 'Rapid-Fire Combo' } }, plan);
    const all = [e.why, ...e.facts].join(' | ');
    expect(all).toContain('KO Dreepy');
    expect(all).toContain('1 Prize');
  });
});

describe("why Boss's Orders", () => {
  it('names the Pokémon it brings up and what the attack then does', () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', energy: three }, hand: ['bosss-orders'] },
      p1: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
    });
    const fin = planFinish(s, 0, plan, 1);
    expect(fin.steps[0]!.action.t).toBe('trainer');
    const e = explainPlan(s, 0, fin, plan);
    expect(e.title).toContain('Meowth ex');
    expect([e.why, ...e.facts].join(' | ')).toContain('KO Meowth ex');
    expect(e.facts.join(' | ')).toContain('2 Prize');
  });
});

describe('why bench a Pokémon', () => {
  it('warns that an empty Bench loses the game if the Active is Knocked Out', () => {
    const s = scenario({ p0: { active: 'teal-mask-ogerpon-ex', hand: ['latias-ex'] }, p1: { active: 'dreepy' } });
    const e = explainAction(s, 0, { action: { t: 'bench', card: handCard(s, 0, 'latias-ex') } }, plan);
    expect(e.why).toContain('Latias ex');
    expect(e.facts.join(' | ')).toContain('แพ้');
  });
});

describe('why play a draw Supporter', () => {
  it('compares the hand before and after', () => {
    const s = scenario({
      p0: { active: 'teal-mask-ogerpon-ex', hand: ['lillies-determination', 'grass-energy'] },
      p1: { active: 'dreepy' },
    });
    const e = explainAction(s, 0, { action: { t: 'trainer', card: handCard(s, 0, 'lillies-determination') } }, plan);
    expect(e.why).toContain('มือ');
    expect(e.facts.join(' | ')).toContain('มือ 2 → 8 ใบ');
  });
});

describe('coach suggestions', () => {
  const s = scenario({
    p0: {
      active: { card: 'mega-kangaskhan-ex', energy: ['psychic-energy', 'psychic-energy'] },
      bench: ['teal-mask-ogerpon-ex'],
      hand: ['grass-energy', 'latias-ex', 'judge', 'psychic-energy'],
    },
    p1: { active: 'dreepy', bench: ['drakloak'] },
  });

  it('give a reason beyond the name of the move', () => {
    const tips = suggest(s, 0, plan, 1);
    expect(tips.length).toBeGreaterThan(0);
    for (const t of tips) {
      expect(t.why.length).toBeGreaterThan(0);
      expect(t.why).not.toBe(actionLabel(s, t.action));
    }
  });

  it('show a multi-step attack as a plan with its result', () => {
    const tips = suggest(s, 0, plan, 1);
    const attack = tips.find((t) => t.why.startsWith('แผนเทิร์นนี้'));
    expect(attack?.why).toContain('Rapid-Fire Combo');
    expect(attack?.title).toContain('ขั้น 1 จาก');
    expect(attack?.facts).toContain('KO Dreepy');
  });

  it('say that setting up comes before the attack, which ends the turn', () => {
    const tips = suggest(s, 0, plan, 1);
    const setup = tips.filter((t) => !t.why.startsWith('แผนเทิร์นนี้') && t.action.t !== 'attack' && t.action.t !== 'end');
    expect(setup.length).toBeGreaterThan(0);
    for (const t of setup) expect(t.facts).toContain('ทำก่อนโจมตี เพราะโจมตีแล้วเทิร์นจะจบทันที');
  });

  it("explain Latias ex by Skyliner, not as an attacker", () => {
    const latias = suggest(s, 0, plan, 1).find((t) => t.title === 'ลง Latias ex บน Bench');
    expect(latias?.why).toContain('Skyliner');
  });
});
