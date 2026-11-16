// Hint button (PLAN.md v2): the player-policy bot's top 3 options with reasons. What the opponent can
// do next turn is src/analysis/threat.ts.
import { def } from '../engine/db';
import { keyOf } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { finishStep, rankDevelopment } from './core';
import { BEFORE_ATTACK, explainAction, explainEnd, explainPlan } from './explain';
import { planFinish } from './finisher';
import type { DeckPlan } from './types';

export interface Suggestion {
  action: Action;
  picks?: number[][];
  title: string;
  why: string;
  facts: string[];
  score: number;
}

export function suggest(s: GameState, me: PlayerId, plan: DeckPlan, seed = 1, n = 3): Suggestion[] {
  const fin = planFinish(s, me, plan, seed);
  const dev = rankDevelopment(s, me, plan).filter(
    (r) =>
      !(fin.usesSupporter && r.action.t === 'trainer' && def(keyOf(s, r.action.card)).category === 'trainer' && isSupporter(s, r.action)) &&
      !(fin.usesEnergy && r.action.t === 'energy'),
  );
  const attackPlanned = fin.value > 0 && fin.steps.some((st) => st.action.t === 'attack');
  const out: Suggestion[] = [];
  const add = (x: Suggestion) => {
    const key = JSON.stringify('card' in x.action ? { ...x.action, card: keyOf(s, x.action.card) } : x.action);
    if (!out.some((o) => JSON.stringify('card' in o.action ? { ...o.action, card: keyOf(s, o.action.card) } : o.action) === key)) out.push(x);
  };
  for (const d of dev.slice(0, n)) {
    const e = explainAction(s, me, d, plan, d.reason);
    if (attackPlanned) e.facts.push(BEFORE_ATTACK);
    add({ action: d.action, picks: d.picks, score: d.score, ...e });
  }
  const f = finishStep(s, fin);
  if (f.action.t !== 'end' || out.length === 0) {
    const e = f.action.t === 'end' ? explainEnd(s, me) : explainPlan(s, me, fin, plan);
    add({ action: f.action, picks: f.picks, score: Math.max(f.score, 1), ...e });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

const isSupporter = (s: GameState, a: Action) => a.t === 'trainer' && (def(keyOf(s, a.card)) as { trainerType?: string }).trainerType === 'Supporter';
