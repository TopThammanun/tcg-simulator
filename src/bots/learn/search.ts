// The network bot with look-ahead: at a main-phase decision the policy's best few options are each played
// out on the same determinized deals (hidden cards re-dealt from what this player can see), both sides
// continuing with the network's own best moves, and scored by the value head at the horizon. The option
// with the best average is played. With the deck plan, the attack planner's line (finisher.ts: exact gusts,
// switches and Knock Outs, the way a chess engine keeps a mate search beside its network) is searched too,
// so a tactic the policy overlooks still gets tried, and a line that wins on every re-deal is played at once,
// like a found mate. Confident decisions (one option holds most of the policy and the planner agrees) and
// pending choices skip the search.
import { actor, apply } from '../../engine/actions';
import { opp } from '../../engine/state';
import type { Action, GameState, PlayerId } from '../../engine/types';
import { determinize } from '../../engine/view';
import { choosePicks, counterReach } from '../choose';
import { planFinish, runStep, sureLine, type Step } from '../finisher';
import { P } from '../params';
import { makeRand } from '../random';
import type { DeckPlan } from '../types';
import { encode, type OptionRef } from './encode';
import { run, softmax, type Model } from './model';
import { actionKey, makeNetBot, MAX_ACTIONS_PER_TURN, turnCounter, type SearchingBot } from './netbot';

export interface NetSearchOptions {
  /** Plan names [mine, theirs]. */
  decks: readonly [string, string];
  seed?: number;
  /** Options searched, best by the policy first. */
  width?: number;
  /** Deals per option. 0 = no look-ahead: the policy's move, still after the sure-win and Prize checks (BOT-NEXT.md N5). */
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
  /** With the plan: play a line that wins on every re-deal at once (default). Off = no such check (comparisons). */
  guards?: boolean;
  /**
   * A faster network that plays the rollouts (both sides), while `model` still picks the options and scores where
   * each rollout ends (AlphaGo's rollout policy): for a network too slow to play hundreds of moves a decision.
   */
  rollout?: Model;
  /**
   * Near ties (BOT-NEXT.md N6): an unsearched move is a random one of the options within this much of the best
   * one's probability, a searched one a random one of the options whose score is within this much of the best. 0 = never.
   */
  ties?: number;
}

export const MAX_ROLLOUT_ACTIONS = 200;

/** Choices whose result shows at once in Prizes: damage counters spread over the Bench, a target for damage. */
export const PRIZE_CHOICES = new Set(['counters', 'target']);

/**
 * Prizes the chooser takes once `picks` answers the pending choice and the rest of the move plays out (99: the game won),
 * times 100; for damage counters, plus the Prizes as many counters could Knock Out on that Bench next turn.
 */
function prizesAfter(s: GameState, picks: number[], plan: DeckPlan): number {
  const req = s.pending!.request;
  const me = req.player;
  try {
    let st = apply(s, { t: 'choose', picks });
    for (let guard = 0; st.pending && st.winner === null && guard < 30; guard++) st = apply(st, { t: 'choose', picks: choosePicks(st, st.pending.request, plan) });
    if (st.winner === me) return 9900;
    const reach = req.purpose === 'counters' ? counterReach(st, opp(me), req.max) : 0;
    return (s.players[me].prizes.length - st.players[me].prizes.length) * 100 + reach;
  } catch {
    return -100;
  }
}

/**
 * The network's answer, unless the rule-based chooser's (exact Knock Out arithmetic) or, for one pick, another
 * option takes more Prizes: the policy sometimes spreads Phantom Dive's counters so that nothing is Knocked Out.
 * Damage counters: as many Prizes now, and more for the same counters next turn (the rest set up where the next
 * Phantom Dive Knocks Out, as the 2026 finalists did; the policy's spread did so 202 Prizes to the rule's 268 in 160 games).
 */
export function morePrizes(s: GameState, net: Action, plan: DeckPlan): Action {
  if (net.t !== 'choose') return net;
  const req = s.pending!.request;
  const others = [choosePicks(s, req, plan)];
  if (req.min === 1 && req.max === 1 && !req.repeat) others.push(...req.options.map((x) => [x.value]));
  let best = net.picks;
  let most = prizesAfter(s, net.picks, plan);
  for (const picks of others) {
    const n = prizesAfter(s, picks, plan);
    if (n > most) {
      best = picks;
      most = n;
    }
  }
  return best === net.picks ? net : { t: 'choose', picks: best };
}

export function makeSearchNetBot(model: Model, o: NetSearchOptions): SearchingBot {
  const width = o.width ?? 4;
  const samples = o.samples ?? 6;
  const confident = o.confident ?? 0.9;
  const minPrior = o.minPrior ?? 0.03;
  const horizon = o.horizon ?? 'reply';
  const guards = o.guards ?? true;
  const greedy = makeNetBot(model, { decks: o.decks, seed: o.seed, temperature: 0 });
  const count = turnCounter();
  const rand = makeRand((o.seed ?? 1) ^ 0x3c6ef372);
  const theirDecks = [o.decks[1], o.decks[0]] as const;

  /** Answers planned with the move played (the planner's gust target…), used for the choices it asks. */
  let queue: number[][] = [];
  /** The rest of a winning line being played this turn. */
  let line: Step[] = [];
  let lineTurn = -1;
  /** A winning line's step is being played: its choices are made as the check made them (runStep: the plan). */
  let onLine = false;

  /** My chance to win after `step` on one deal. */
  const rollout = (s: GameState, me: PlayerId, step: Step, seed: number): number => {
    const dealt = determinize(s, me, seed);
    let st = step.picks && o.plan ? runStep(dealt, step, o.plan) : apply(dealt, step.action, { trusted: true });
    const player = o.rollout ?? model;
    const bots = { [me]: makeNetBot(player, { decks: o.decks, temperature: 0 }), [opp(me)]: makeNetBot(player, { decks: theirDecks, temperature: 0 }) };
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

  const bot: SearchingBot = {
    act(s: GameState): Action {
      bot.lastSearched = false;
      if (s.pending) {
        const req = s.pending.request;
        const f = queue.shift();
        if (f && f.every((v) => req.options.some((x) => x.value === v)) && f.length >= req.min && f.length <= req.max) return { t: 'choose', picks: f };
        queue = [];
        if (onLine && o.plan && req.player === actor(s)) return { t: 'choose', picks: choosePicks(s, req, o.plan) };
        const net = greedy.act(s);
        return o.plan && guards && PRIZE_CHOICES.has(req.purpose) ? morePrizes(s, net, o.plan) : net;
      }
      onLine = false;
      if (s.phase !== 'main') return greedy.act(s);
      queue = [];
      const me = actor(s);
      const done = count(s, me);
      if (done >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
      const enc = encode(s, { decks: o.decks, actionsThisTurn: done });
      const action = (i: number) => (enc.refs[i] as Extract<OptionRef, { t: 'action' }>).action;
      const indexOf = (a: Action) => {
        const key = actionKey(s, a);
        return enc.refs.findIndex((r) => r.t === 'action' && actionKey(s, r.action) === key);
      };
      // A winning line started earlier this turn: its next step, while it is still there.
      if (line.length && lineTurn === s.turn) {
        const next = line.shift()!;
        const i = indexOf(next.action);
        if (i >= 0) {
          queue = next.picks?.slice() ?? [];
          onLine = true;
          return action(i);
        }
      }
      line = [];
      // A sure win is never passed up: a line that wins on every re-deal of what this player can't see
      // (finisher.ts sureLine) is played at once, like a found mate. Lines that only take Prizes are left to
      // the search: forcing those made the bot weaker (BOT-RESEARCH.md, round 3).
      if (o.plan && guards) {
        const win = sureLine(s, me, o.plan, 3);
        const first = win.wins ? indexOf(win.steps[0]!.action) : -1;
        if (first >= 0) {
          line = win.steps.slice(1);
          lineTurn = s.turn;
          queue = win.steps[0]!.picks?.slice() ?? [];
          onLine = true;
          return action(first);
        }
      }
      if (enc.refs.length === 1) return action(0);
      const p = softmax(run(model, enc).logits);
      const order = Array.from(p.keys()).sort((a, b) => p[b]! - p[a]!);
      /** The policy's best option, or with `ties` a random one of those near it. */
      const policyMove = () => {
        if (!o.ties) return action(order[0]!);
        const near = order.filter((i) => p[i]! >= p[order[0]!]! - o.ties!);
        return action(near[Math.floor(rand() * near.length)]!);
      };
      if (samples === 0) return policyMove();
      const cands = order.filter((i, k) => k === 0 || (k < width && p[i]! >= minPrior));
      // The attack planner's first step, when its line gains something.
      let tactic = -1;
      let tacticPicks: number[][] | undefined;
      let urgent = false;
      if (o.plan) {
        const fin = planFinish(s, me, o.plan, Math.floor(rand() * 2 ** 31));
        const first = fin.steps[0];
        if (first && fin.value > 0) {
          tactic = indexOf(first.action);
          tacticPicks = first.picks;
          // A line that takes a Prize is worth a look even when the policy is sure of something else.
          urgent = fin.value >= P.prize * 0.9;
          if (tactic >= 0 && !cands.includes(tactic)) cands.push(tactic);
        }
      }
      const sure = p[order[0]!]! >= confident && !(urgent && tactic >= 0 && tactic !== order[0]);
      if (sure || cands.length === 1) return policyMove();
      const stepOf = (i: number): Step => ({ action: action(i), picks: i === tactic ? tacticPicks : undefined });
      bot.lastSearched = true;
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
      if (o.ties) {
        const near = cands.map((_, k) => k).filter((k) => score(k) >= score(best) - o.ties!);
        best = near[Math.floor(rand() * near.length)]!;
      }
      queue = stepOf(cands[best]!).picks?.slice() ?? [];
      return action(cands[best]!);
    },
  };
  return bot;
}
