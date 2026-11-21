// The review page's reading of a game: the turns worth a look, the summing-up sentence, the chart's points, and a
// turn's moves with the card each plays.
import { describe, expect, it } from 'vitest';
import type { TurnReview } from '../../src/analysis/review';
import { apply } from '../../src/engine/actions';
import type { Action, GameState } from '../../src/engine/types';
import { keyTurns, reviewSummary, turnLine, winPoints } from '../../src/review/summary';
import { handCard, scenario } from '../engine/helpers';

const turn = (n: number, before: number, after: number, extra: Partial<TurnReview> = {}): TurnReview => ({
  turn: n,
  span: { turn: n, start: n * 10, last: n * 10 + 5, end: n * 10 + 9 },
  played: ['จบเทิร์น'],
  before,
  win: { p: after, se: 0.01 },
  verdict: 'ok',
  ...extra,
});
const alt = (p: number, diff: number, split = 0) => ({ played: ['ใช้ Judge'], actions: [], win: { p, se: 0.01 }, diff, split, why: 'x' });

describe('the turns worth a look and the sentence', () => {
  const turns = [
    turn(2, 0.5, 0.45, { verdict: 'better', alt: alt(0.6, 0.15) }),
    turn(4, 0.45, 0.2, { verdict: 'better', alt: alt(0.55, 0.35) }),
    turn(6, 0.2, 0.1, { verdict: 'missed-ko', missed: { kind: 'ko', at: 60, prizes: 2, took: 0, line: ['โจมตี X'] } }),
    turn(8, 0.1, 0.05),
  ];

  it('clear mistakes first, then where the bot gains most', () => {
    expect(keyTurns(turns).map((t) => t.turn)).toEqual([6, 4, 2]);
  });

  it('sums the game up in one sentence, with the counts and the widest gap', () => {
    const s = reviewSummary(turns);
    expect(s.sentence).toBe('เทิร์น 6: มีทาง KO ได้ 2 Prize (คุณได้ 0)');
    expect(s.missed).toBe(1);
    expect(s.better).toBe(2);
    expect(s.widest).toEqual({ turn: 4, points: 35 });
    expect(reviewSummary(turns.filter((t) => t.verdict === 'better')).sentence).toBe('เทิร์น 4: เล่นแบบบอทจะได้ win% 55% แทน 20%');
    expect(reviewSummary([turn(2, 0.5, 0.5)]).sentence).toMatch(/^ไม่พบจุดที่เสียเปรียบ/);
    expect(reviewSummary([]).sentence).toBe('');
  });
});

describe('the win% chart', () => {
  it('two points per turn of yours; your turns solid, the bot’s in between dashed', () => {
    const { points, segments } = winPoints([turn(4, 0.4, 0.3), turn(2, 0.5, 0.45)]);
    expect(points.map((p) => [p.x, p.turn, p.p, p.at])).toEqual([
      [0, 2, 0.5, 'start'],
      [1, 2, 0.45, 'end'],
      [2, 4, 0.4, 'start'],
      [3, 4, 0.3, 'end'],
    ]);
    expect(segments.map((s) => s.whose)).toEqual(['mine', 'theirs', 'mine']);
    // The bot's turn 3 took 5 points: from your turn 2's end to your turn 4's start.
    expect(segments[1]!.from.p - segments[1]!.to.p).toBeCloseTo(0.05);
  });
});

describe('a turn as moves with their cards', () => {
  it('names each move and the card it plays; answers to choices are part of their move', () => {
    const s0 = scenario({ p0: { active: 'dreepy', bench: ['budew'], hand: ['fire-energy', 'judge'] }, p1: { active: 'abra' } });
    const acts: Action[] = [
      { t: 'energy', card: handCard(s0, 0, 'fire-energy'), target: s0.players[0].active!.uid },
      { t: 'retreat', to: s0.players[0].bench[0]!.uid },
    ];
    const states: GameState[] = [s0];
    for (const a of acts) states.push(apply(states[states.length - 1]!, a));
    const line = turnLine(states, acts, 0);
    expect(line.moves.map((m) => m.key)).toEqual(['fire-energy', 'budew']);
    expect(line.moves[0]!.label).toMatch(/^ติด Fire Energy ให้/);
    expect(line.stops).toEqual([0, 1, 2]);
  });
});
