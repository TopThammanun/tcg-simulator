import { describe, expect, it } from 'vitest';
import { reviewTurn, sureLine } from '../../src/analysis/review';
import { estimateWin, merge, pairedDiff, summarize } from '../../src/analysis/winrate';
import { makeBot } from '../../src/bots/core';
import { DEFAULT_POLICY, planFor } from '../../src/bots/plans';
import { apply } from '../../src/engine/actions';
import type { Action, GameState } from '../../src/engine/types';
import { isFree, replay, turnsOf, type SavedGame } from '../../src/review/record';
import { playGame } from '../../src/sim/game';
import { deck, scenario } from '../engine/helpers';

const plans = { mine: planFor('player'), theirs: planFor('dragapult-ex') };
const FAST = { samples: 6, threatSamples: 6, theirDeck: 'dragapult-ex' };

/** Your Dragapult ex can Jet Headbutt (70) the opponent's Dreepy (70 HP); `bench` decides whether that wins. */
function position(bench: string[]): GameState {
  return scenario({
    p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['psychic-energy'] }, bench: ['meowth-ex'] },
    p1: { active: 'dreepy', bench, prizes: 6 },
  });
}

/** A turn played from `s`: the actions, answering the opponent's choices with their first option. */
function played(s: GameState, mine: Action[]): { states: GameState[]; actions: Action[] } {
  const states = [s];
  const actions: Action[] = [];
  let st = s;
  for (const a of mine) {
    actions.push(a);
    st = apply(st, a);
    states.push(st);
    while (st.pending && st.pending.request.player === 1) {
      const r = st.pending.request;
      const c: Action = { t: 'choose', picks: r.options.slice(0, Math.max(1, r.min)).map((o) => o.value) };
      actions.push(c);
      st = apply(st, c);
      states.push(st);
    }
  }
  return { states, actions };
}

describe('clear mistakes (พลาดชัด)', () => {
  it('a turn ended without the attack that wins the game is a missed win', () => {
    const { states, actions } = played(position([]), [{ t: 'end' }]);
    const [span] = turnsOf(states);
    const r = reviewTurn(states, actions, span!, plans, FAST);
    expect(r.verdict).toBe('missed-win');
    expect(r.missed).toMatchObject({ kind: 'win', took: 0, at: 0 });
    expect(r.missed!.line.join(' ')).toContain('Jet Headbutt');
  });

  it('a turn ended without a Knock Out that was there is a missed KO, with the Prizes', () => {
    const { states, actions } = played(position(['dreepy']), [{ t: 'end' }]);
    const r = reviewTurn(states, actions, turnsOf(states)[0]!, plans, FAST);
    expect(r.verdict).toBe('missed-ko');
    expect(r.missed).toMatchObject({ kind: 'ko', prizes: 1, took: 0 });
  });

  it('taking the Knock Out is not a mistake', () => {
    const { states, actions } = played(position(['dreepy']), [{ t: 'attack', name: 'Jet Headbutt' }]);
    const span = turnsOf(states)[0]!;
    expect(states[span.end]!.current).toBe(1);
    const r = reviewTurn(states, actions, span, plans, FAST);
    expect(r.missed).toBeUndefined();
    expect(r.verdict === 'ok' || r.verdict === 'better').toBe(true);
    expect(r.played).toEqual(['โจมตี Jet Headbutt']);
  });

  it('a line counts only if it works on every re-deal, and the answer does not change between runs', () => {
    const s = position(['dreepy']);
    const a = sureLine(s, 0, plans, 4);
    expect(a.prizes).toBe(1);
    expect(a.wins).toBe(false);
    expect(sureLine(s, 0, plans, 4)).toEqual(a);
    // Nothing to Knock Out with: no Energy on the attacker and none in hand.
    const none = scenario({
      p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'] }, deck: Array(20).fill('bosss-orders') },
      p1: { active: 'dreepy', bench: ['dreepy'] },
    });
    expect(sureLine(none, 0, plans, 4).prizes).toBe(0);
  });
});

describe('win% (winrate.ts)', () => {
  it('is 1 for a game already won and 0 for one already lost', () => {
    const s = position([]);
    expect(estimateWin({ ...s, winner: 0 }, 0, plans, { samples: 3 }).p).toBe(1);
    expect(estimateWin({ ...s, winner: 1 }, 0, plans, { samples: 3 }).p).toBe(0);
  });

  it('adds games to an estimate and compares two positions on the same deals', () => {
    const a = summarize([1, 0, 1, 1]);
    const b = summarize([1, 1, 1, 1]);
    expect(merge(a, summarize([0, 0])).p).toBeCloseTo(0.5, 10);
    expect(pairedDiff(a, b)).toMatchObject({ diff: 0.25 });
  });
});

describe('saved games (record.ts)', () => {
  it('replays a game exactly and finds your turns in it', () => {
    const slug = 'dragapult-ex';
    const r = playGame({
      seed: 5,
      decks: [deck('player'), deck(slug)],
      bots: [makeBot(planFor('player'), { seed: 1 }), makeBot(planFor(slug), { seed: 2 })],
      record: true,
    });
    const g: SavedGame = {
      savedAt: 0,
      seed: 5,
      opponent: slug,
      opponentName: 'Dragapult ex',
      rules: {},
      policy: DEFAULT_POLICY,
      decks: [deck('player').cards, deck(slug).cards],
      actions: r.history!,
      winner: r.winner,
      reason: r.reason,
      turns: r.turns,
    };
    const states = replay(g);
    expect(states.length).toBe(g.actions.length + 1);
    expect(states[states.length - 1]!.winner).toBe(r.winner);
    const spans = turnsOf(states);
    expect(spans.length).toBeGreaterThan(2);
    for (const sp of spans) {
      expect(isFree(states[sp.start]!, 0)).toBe(true);
      expect(isFree(states[sp.last]!, 0)).toBe(true);
      expect(states[sp.start]!.turn).toBe(sp.turn);
      expect(sp.start <= sp.last && sp.last < sp.end).toBe(true);
      const end = states[sp.end]!;
      expect(end.winner !== null || (end.current === 1 && !end.pending)).toBe(true);
    }
    expect(new Set(spans.map((sp) => sp.turn)).size).toBe(spans.length);
  });
});
