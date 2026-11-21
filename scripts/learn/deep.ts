// The look-ahead bot (src/bots/learn/search.ts) with its network moves batched on the GPU (BOT-NEXT.md N5: how
// much stronger does it get with many more deals?). The same decisions as makeSearchNetBot: a winning line is
// played at once, confident moves and choices go to the network, otherwise the policy's best few options and the
// attack planner's line are each played out on `samples` deals, both sides playing the network's best moves until
// the start of my next turn, and scored by the value head there. Every rollout of a decision runs in lock step,
// so a step of all of them is one batch for the inference server. No deadline: the experiment measures deals,
// not time.
import { encode, type OptionRef } from '../../src/bots/learn/encode';
import { softmax } from '../../src/bots/learn/model';
import { actionKey, MAX_ACTIONS_PER_TURN, turnCounter } from '../../src/bots/learn/netbot';
import { MAX_ROLLOUT_ACTIONS, morePrizes, PRIZE_CHOICES } from '../../src/bots/learn/search';
import { choosePicks } from '../../src/bots/choose';
import { planFinish, runStep, sureLine, type Step } from '../../src/bots/finisher';
import { P } from '../../src/bots/params';
import { makeRand } from '../../src/bots/random';
import type { DeckPlan } from '../../src/bots/types';
import { actor, apply } from '../../src/engine/actions';
import { opp } from '../../src/engine/state';
import type { Action, GameState, PlayerId } from '../../src/engine/types';
import { determinize } from '../../src/engine/view';
import type { Answer, Ask } from './batched';

export interface DeepOptions {
  /** Options searched, best by the policy first (search.ts width). */
  width: number;
  /** Deals per option. */
  samples: number;
  confident: number;
  minPrior: number;
  /** Look for a winning line and play it at once, and check Prize choices (search.ts guards). */
  guards: boolean;
  /**
   * Leave the policy's best option only for one whose mean is higher by this many standard errors of the
   * difference over the same deals (0 = the best mean, as search.ts).
   */
  switchZ: number;
}

/** What one side keeps between its moves (search.ts keeps the same in its closure). */
export interface DeepState {
  queue: number[][];
  line: Step[];
  lineTurn: number;
  onLine: boolean;
  rand: () => number;
  count: (s: GameState, me: PlayerId) => number;
}

export function deepState(seed: number): DeepState {
  return { queue: [], line: [], lineTurn: -1, onLine: false, rand: makeRand((seed ?? 1) ^ 0x3c6ef372), count: turnCounter() };
}

/** A generator that asks one decision at a time, run inside one that may ask a batch (each answer matches its ask). */
export const one = <T>(g: Generator<Ask, T, Answer>) => g as unknown as Generator<Ask | Ask[], T, Answer | Answer[]>;

/** The network's best move, one pick at a time for a choice (makeNetBot with temperature 0). */
function* greedy(s: GameState, decks: readonly [string, string], model: string, count: (s: GameState, me: PlayerId) => number): Generator<Ask, Action, Answer> {
  const me = actor(s);
  const best = (a: Answer) => a.logits.reduce((b, x, i) => (x > a.logits[b]! ? i : b), 0);
  if (s.pending) {
    const picks: number[] = [];
    for (;;) {
      const enc = encode(s, { decks }, picks);
      const ref = enc.refs.length === 1 ? enc.refs[0]! : enc.refs[best(yield { enc, model })]!;
      if (ref.t !== 'pick') break;
      picks.push(ref.value);
    }
    return { t: 'choose', picks };
  }
  const n = count(s, me);
  if (n >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
  const enc = encode(s, { decks, actionsThisTurn: n });
  const i = enc.refs.length === 1 ? 0 : best(yield { enc, model });
  return (enc.refs[i] as Extract<OptionRef, { t: 'action' }>).action;
}

/** My chance to win after `step` on one deal: both sides play the network's best moves to the start of my next turn. */
function* rollout(s: GameState, me: PlayerId, step: Step, seed: number, decks: readonly [string, string], model: string, plan: DeckPlan | undefined): Generator<Ask, number, Answer> {
  const theirs = [decks[1], decks[0]] as const;
  try {
    const dealt = determinize(s, me, seed);
    let st = step.picks && plan ? runStep(dealt, step, plan) : apply(dealt, step.action, { trusted: true });
    const counts = { [me]: turnCounter(), [opp(me)]: turnCounter() } as Record<PlayerId, (s: GameState, me: PlayerId) => number>;
    for (let n = 0; st.winner === null && n < MAX_ROLLOUT_ACTIONS; n++) {
      if (!st.pending && st.phase === 'main' && st.current === me && st.turn > s.turn) break;
      const who = actor(st);
      st = apply(st, yield* greedy(st, who === me ? decks : theirs, model, counts[who]), { trusted: true });
    }
    if (st.winner === me) return 1;
    if (st.winner !== null) return st.winner === 'draw' ? 0.5 : 0;
    const who = actor(st);
    const v = (yield { enc: encode(st, { decks: who === me ? decks : theirs }), model }).value;
    return who === me ? v : 1 - v;
  } catch {
    return 0; // a line that breaks scores as a loss (search.ts)
  }
}

/** Run generators in lock step: each round, every unfinished one's ask goes out in one batch. */
function* lockstep<T>(gens: Generator<Ask, T, Answer>[]): Generator<Ask[], T[], Answer[]> {
  const results: T[] = new Array(gens.length);
  let live = gens.map((g, i) => ({ i, r: g.next() }));
  for (;;) {
    for (const x of live) if (x.r.done) results[x.i] = x.r.value as T;
    live = live.filter((x) => !x.r.done);
    if (!live.length) return results;
    const answers = yield live.map((x) => x.r.value as Ask);
    live = live.map((x, k) => ({ i: x.i, r: gens[x.i]!.next(answers[k]!) }));
  }
}

/** One decision of the batched look-ahead bot (search.ts makeSearchNetBot act()). */
export function* deepAct(
  s: GameState,
  st: DeepState,
  decks: readonly [string, string],
  model: string,
  plan: DeckPlan | undefined,
  o: DeepOptions,
): Generator<Ask | Ask[], Action, Answer | Answer[]> {
  const me = actor(s);
  if (s.pending) {
    const req = s.pending.request;
    const f = st.queue.shift();
    if (f && f.every((v) => req.options.some((x) => x.value === v)) && f.length >= req.min && f.length <= req.max) return { t: 'choose', picks: f };
    st.queue = [];
    if (st.onLine && plan && req.player === me) return { t: 'choose', picks: choosePicks(s, req, plan) };
    const net = yield* one(greedy(s, decks, model, st.count));
    return plan && o.guards && PRIZE_CHOICES.has(req.purpose) ? morePrizes(s, net, plan) : net;
  }
  st.onLine = false;
  if (s.phase !== 'main') return yield* one(greedy(s, decks, model, st.count));
  st.queue = [];
  const done = st.count(s, me);
  if (done >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
  const enc = encode(s, { decks, actionsThisTurn: done });
  const action = (i: number) => (enc.refs[i] as Extract<OptionRef, { t: 'action' }>).action;
  const indexOf = (a: Action) => {
    const key = actionKey(s, a);
    return enc.refs.findIndex((r) => r.t === 'action' && actionKey(s, r.action) === key);
  };
  if (st.line.length && st.lineTurn === s.turn) {
    const next = st.line.shift()!;
    const i = indexOf(next.action);
    if (i >= 0) {
      st.queue = next.picks?.slice() ?? [];
      st.onLine = true;
      return action(i);
    }
  }
  st.line = [];
  if (plan && o.guards) {
    const win = sureLine(s, me, plan, 3);
    const first = win.wins ? indexOf(win.steps[0]!.action) : -1;
    if (first >= 0) {
      st.line = win.steps.slice(1);
      st.lineTurn = s.turn;
      st.queue = win.steps[0]!.picks?.slice() ?? [];
      st.onLine = true;
      return action(first);
    }
  }
  if (enc.refs.length === 1) return action(0);
  const p = softmax(((yield { enc, model }) as Answer).logits);
  const order = Array.from(p.keys()).sort((a, b) => p[b]! - p[a]!);
  const cands = order.filter((i, k) => k === 0 || (k < o.width && p[i]! >= o.minPrior));
  let tactic = -1;
  let tacticPicks: number[][] | undefined;
  let urgent = false;
  if (plan) {
    const fin = planFinish(s, me, plan, Math.floor(st.rand() * 2 ** 31));
    const first = fin.steps[0];
    if (first && fin.value > 0) {
      tactic = indexOf(first.action);
      tacticPicks = first.picks;
      urgent = fin.value >= P.prize * 0.9;
      if (tactic >= 0 && !cands.includes(tactic)) cands.push(tactic);
    }
  }
  const sure = p[order[0]!]! >= o.confident && !(urgent && tactic >= 0 && tactic !== order[0]);
  if (sure || cands.length === 1) return action(order[0]!);
  const stepOf = (i: number): Step => ({ action: action(i), picks: i === tactic ? tacticPicks : undefined });
  const seeds = Array.from({ length: o.samples }, () => Math.floor(st.rand() * 2 ** 31));
  // Every option on the same deals; row k of `v` is option k's value on each deal.
  const gens = cands.flatMap((c) => seeds.map((seed) => rollout(s, me, stepOf(c), seed, decks, model, plan)));
  const flat = yield* (lockstep(gens) as unknown as Generator<Ask | Ask[], number[], Answer | Answer[]>);
  const v = cands.map((_, k) => flat.slice(k * o.samples, (k + 1) * o.samples));
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const score = (k: number) => mean(v[k]!) + 0.02 * p[cands[k]!]!;
  let best = 0;
  for (let k = 1; k < cands.length; k++) if (score(k) > score(best)) best = k;
  if (o.switchZ > 0 && best !== 0) {
    // Paired over the deals: leave the policy's choice (cands[0]) only when the difference is clearly above noise.
    const d = v[best]!.map((x, i) => x - v[0]![i]!);
    const m = mean(d);
    const sd = Math.sqrt(d.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, d.length - 1));
    if (m <= o.switchZ * (sd / Math.sqrt(d.length))) best = 0;
  }
  st.queue = stepOf(cands[best]!).picks?.slice() ?? [];
  return action(cands[best]!);
}
