import { describe, expect, it } from 'vitest';
import { threatFacts } from '../../src/analysis/gains';
import { reviewTurn } from '../../src/analysis/review';
import { threats, type Plans, type ThreatReport } from '../../src/analysis/threat';
import { planFor } from '../../src/bots/plans';
import { actor, apply } from '../../src/engine/actions';
import type { Action, GameState } from '../../src/engine/types';
import { setLang } from '../../src/i18n';
import { turnsOf } from '../../src/review/record';
import { scenario } from '../engine/helpers';

const plans: Plans = { mine: planFor('player'), theirs: planFor('dragapult-ex') };

/** A turn played from `s`, the opponent's choices answered with their first option. */
function played(s: GameState, mine: Action[]): { states: GameState[]; actions: Action[] } {
  const states = [s];
  const actions: Action[] = [];
  let st = s;
  for (const a of mine) {
    actions.push(a);
    st = apply(st, a);
    states.push(st);
    while (st.pending && actor(st) === 1) {
      const r = st.pending.request;
      const c: Action = { t: 'choose', picks: r.options.slice(0, Math.max(1, r.min)).map((o) => o.value) };
      actions.push(c);
      st = apply(st, c);
      states.push(st);
    }
  }
  return { states, actions };
}

const report = (slots: Partial<ThreatReport['slots'][number]>[], extra: Partial<ThreatReport> = {}): ThreatReport => ({
  samples: 24,
  slots: slots.map((x, i) => ({ uid: i, key: 'dreepy', name: 'Dreepy', prizes: 1, active: i === 0, ko: 0, chance: 0, hit: 0, damage: 0, lines: [], ...x })),
  prizes: [24, 0, 0, 0, 0, 0, 0],
  win: 0,
  prizesLeft: 6,
  expected: 0,
  winChance: 0,
  calibrated: false,
  ...extra,
});

describe('what the better way gets you (gains.ts)', () => {
  it('a missed Knock Out says which Pokémon and how many Prizes, next to yours', () => {
    setLang('en');
    const s = scenario({
      p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['psychic-energy'] }, bench: ['meowth-ex'] },
      p1: { active: 'dreepy', bench: ['dreepy'], prizes: 6 },
    });
    const { states, actions } = played(s, [{ t: 'end' }]);
    const r = reviewTurn(states, actions, turnsOf(states)[0]!, plans, { deals: 4, threats: 8 });
    expect(r.verdict).toBe('missed-ko');
    expect(r.gains?.of).toBe('missed');
    expect(r.gains!.now[0]).toMatch(/^KO Dreepy: takes 1 Prize card \(yours: 0\), 5 left to win$/);
    setLang('th');
  });

  it('a turn with nothing to look at has none, and none are looked for with threats: 0', () => {
    const s = scenario({
      p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['psychic-energy'] }, bench: ['meowth-ex'] },
      p1: { active: 'dreepy', bench: ['dreepy'], prizes: 6 },
    });
    const { states, actions } = played(s, [{ t: 'end' }]);
    expect(reviewTurn(states, actions, turnsOf(states)[0]!, plans, { deals: 4, threats: 0 }).gains).toBeUndefined();
  });

  it('play around: a Pokémon much safer, with the line that takes it in yours', () => {
    setLang('en');
    const yours = report([{ uid: 3, key: 'dragapult-ex', name: 'Dragapult ex', prizes: 2, ko: 22, chance: 0.9, lines: [{ label: "Boss's Orders → Phantom Dive", n: 22 }] }], { expected: 1.8 });
    const better = report([{ uid: 3, key: 'dragapult-ex', name: 'Dragapult ex', prizes: 2, ko: 5, chance: 0.2 }], { expected: 0.4 });
    expect(threatFacts(better, yours, 'yours')).toEqual([
      "Dragapult ex (worth 2 Prize cards) is Knocked Out 20% of the time (yours: 90%, by Boss's Orders → Phantom Dive)",
      'They are expected to take 0.4 Prize cards on their next turn (yours: 1.8)',
    ]);
    // Not in play at all in the better way.
    expect(threatFacts(report([]), yours, 'yours')[0]).toMatch(/^No Dragapult ex \(worth 2 Prize cards\) in play for them to take/);
    // About the same: nothing to say.
    expect(threatFacts(yours, yours, 'yours')).toEqual([]);
    setLang('th');
  });

  it('the opponent’s next turn can be sampled from a position after your turn has passed', () => {
    // Phantom Dive Knocks Out the Active Meowth ex whether the turn is ended here or was ended already.
    const s = scenario({
      p0: { active: 'meowth-ex', bench: ['mega-kangaskhan-ex'] },
      p1: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] }, deck: Array(10).fill('psychic-energy'), prizes: 6 },
    });
    const passed = apply(s, { t: 'end' });
    expect(passed.current).toBe(1);
    const r = threats(passed, 0, plans, { samples: 8, ending: null });
    expect(r.slots[0]!.ko).toBe(8);
  });
});
