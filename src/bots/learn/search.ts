// The network bot with look-ahead: at a main-phase decision the policy's best few options are each played
// out on the same determinized deals (hidden cards re-dealt from what this player can see), both sides
// continuing with the network's own best moves, and scored by the value head at the horizon. The option
// with the best average is played. With the deck plan, the attack planner's line (finisher.ts: exact gusts,
// switches and Knock Outs, the way a chess engine keeps a mate search beside its network) is searched too,
// so a tactic the policy overlooks still gets tried. Confident decisions (one option holds most of the
// policy and the planner agrees) and pending choices skip the search.
import { actor, apply } from '../../engine/actions';
import { opp } from '../../engine/state';
import type { Action, GameState, PlayerId } from '../../engine/types';
import { determinize } from '../../engine/view';
import { planFinish, runStep, type Step } from '../finisher';
import { P } from '../params';
import { makeRand } from '../random';
import type { Bot, DeckPlan } from '../types';
import { encode, type OptionRef } from './encode';
import { run, softmax, type Model } from './model';
import { actionKey, makeNetBot, MAX_ACTIONS_PER_TURN, turnCounter } from './netbot';

export interface NetSearchOptions {
  /** Plan names [mine, theirs]. */
  decks: readonly [string, string];
  seed?: number;
  /** Options searched, best by the policy first. */
  width?: number;
  /** Deals per option. */
  samples?: number;
  /** Skip the search when the policy gives its best option at least this probability. */
  confident?: number;
  /** Options below this probability are not searched. */
  minPrior?: number;
  /** Score at the end of my turn ('turn') or at the start of my next turn ('reply'). */
  horizon?: 'turn' | 'reply';
  /** Stop adding deals after this many ms (at least two deals). */
  deadlineMs?: number;
  /** My deck plan: the attack planner's line joins the options searched. */
  plan?: DeckPlan;
}

const MAX_ROLLOUT_ACTIONS = 200;

export function makeSearchNetBot(model: Model, o: NetSearchOptions): Bot {
  const width = o.width ?? 4;
  const samples = o.samples ?? 6;
  const confident = o.confident ?? 0.9;
  const minPrior = o.minPrior ?? 0.03;
  const horizon = o.horizon ?? 'reply';
  const greedy = makeNetBot(model, { decks: o.decks, seed: o.seed, temperature: 0 });
  const count = turnCounter();
  const rand = makeRand((o.seed ?? 1) ^ 0x3c6ef372);
  const theirDecks = [o.decks[1], o.decks[0]] as const;

  /** Answers planned with the move played (the planner's gust target…), used for the choices it asks. */
  let queue: number[][] = [];

  /** My chance to win after `step` on one deal. */
  const rollout = (s: GameState, me: PlayerId, step: Step, seed: number): number => {
    const dealt = determinize(s, me, seed);
    let st = step.picks && o.plan ? runStep(dealt, step, o.plan) : apply(dealt, step.action, { trusted: true });
    const bots = { [me]: makeNetBot(model, { decks: o.decks, temperature: 0 }), [opp(me)]: makeNetBot(model, { decks: theirDecks, temperature: 0 }) };
    for (let n = 0; st.winner === null && n < MAX_ROLLOUT_ACTIONS; n++) {
      if (!st.pending && st.phase === 'main') {
        if (horizon === 'turn' && st.current !== me) break;
        if (horizon === 'reply' && st.current === me && st.turn > s.turn) break;
      }
      st = apply(st, bots[actor(st)]!.act(st), { trusted: true });
    }
    if (st.winner === me) return 1;
    if (st.winner !== null) return st.winner === 'draw' ? 0.5 : 0;
    const who = actor(st);
    const v = run(model, encode(st, { decks: who === me ? o.decks : theirDecks }), false).value;
    return who === me ? v : 1 - v;
  };

  return {
    act(s: GameState): Action {
      if (s.pending) {
        const req = s.pending.request;
        const f = queue.shift();
        if (f && f.every((v) => req.options.some((x) => x.value === v)) && f.length >= req.min && f.length <= req.max) return { t: 'choose', picks: f };
        queue = [];
        return greedy.act(s);
      }
      if (s.phase !== 'main') return greedy.act(s);
      queue = [];
      const me = actor(s);
      const done = count(s, me);
      if (done >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
      const enc = encode(s, { decks: o.decks, actionsThisTurn: done });
      const action = (i: number) => (enc.refs[i] as Extract<OptionRef, { t: 'action' }>).action;
      if (enc.refs.length === 1) return action(0);
      const p = softmax(run(model, enc).logits);
      const order = Array.from(p.keys()).sort((a, b) => p[b]! - p[a]!);
      const cands = order.filter((i, k) => k === 0 || (k < width && p[i]! >= minPrior));
      // The attack planner's first step, when its line gains something.
      let tactic = -1;
      let tacticPicks: number[][] | undefined;
      let urgent = false;
      if (o.plan) {
        const fin = planFinish(s, me, o.plan, Math.floor(rand() * 2 ** 31));
        const first = fin.steps[0];
        if (first && fin.value > 0) {
          const key = actionKey(s, first.action);
          tactic = enc.refs.findIndex((r) => r.t === 'action' && actionKey(s, r.action) === key);
          tacticPicks = first.picks;
          // A line that takes a Prize is worth a look even when the policy is sure of something else.
          urgent = fin.value >= P.prize * 0.9;
          if (tactic >= 0 && !cands.includes(tactic)) cands.push(tactic);
        }
      }
      const sure = p[order[0]!]! >= confident && !(urgent && tactic >= 0 && tactic !== order[0]);
      if (sure || cands.length === 1) return action(order[0]!);
      const stepOf = (i: number): Step => ({ action: action(i), picks: i === tactic ? tacticPicks : undefined });
      const total = cands.map(() => 0);
      const started = performance.now();
      const late = () => !!o.deadlineMs && performance.now() - started > o.deadlineMs;
      let n = 0;
      for (let d = 0; d < samples; d++) {
        if (n >= 2 && late()) break;
        const seed = Math.floor(rand() * 2 ** 31);
        // Every option on the same deal; a deal cut short by the deadline is dropped (after the first two).
        const round: number[] = [];
        for (const c of cands) {
          if (n >= 2 && late()) break;
          let v = 0;
          try {
            v = rollout(s, me, stepOf(c), seed);
          } catch {
            // A line that breaks scores as a loss.
          }
          round.push(v);
        }
        if (round.length < cands.length) break;
        round.forEach((v, k) => (total[k] += v));
        n++;
      }
      // Best average; the policy breaks near-ties.
      const score = (k: number) => total[k]! / n + 0.02 * p[cands[k]!]!;
      let best = 0;
      for (let k = 1; k < cands.length; k++) if (score(k) > score(best)) best = k;
      queue = stepOf(cands[best]!).picks?.slice() ?? [];
      return action(cands[best]!);
    },
  };
}
