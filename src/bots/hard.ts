// "ยาก": Monte Carlo at key decisions (PLAN.md v3). The normal bot proposes a few candidates; each is
// played forward on several determinized states (unknown cards re-dealt) with normal bots on both sides
// until the end of the opponent's next turn, and the candidate with the best average outcome is taken.
import { actor, apply, legalActions } from '../engine/actions';
import { def, isTrainerType } from '../engine/db';
import { hpLeft, maxHp } from '../engine/rules';
import { keyOf, opp, slotsOf, topDef } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { determinize } from '../engine/view';
import { choosePicks } from './choose';
import { decide, finishStep, makeBot, rankDevelopment } from './core';
import { planFinish, runStep } from './finisher';
import { makeRand } from './random';
import type { Bot, DeckPlan } from './types';

const SAMPLES = 4;
const MAX_ROLLOUT_ACTIONS = 160;

/** Static evaluation from `me`'s side: prizes, board health, resources. */
export function evaluate(s: GameState, me: PlayerId): number {
  if (s.winner === me) return 1e5;
  if (s.winner === opp(me)) return -1e5;
  const side = (p: PlayerId) => {
    const ps = s.players[p];
    let v = (6 - ps.prizes.length) * 100;
    for (const sl of slotsOf(ps)) {
      const d = topDef(s, sl);
      // A damaged Pokémon is a Prize the other side is closer to taking.
      v -= (sl.damage / maxHp(s, sl)) * 40 * d.prizes;
      v += sl.energy.length * 6 + (sl.stack.length - 1) * 12 + (hpLeft(s, sl) > 0 ? 4 : 0);
    }
    v += Math.min(ps.hand.length, 10) * 3;
    if (ps.deck.length < 6) v -= (6 - ps.deck.length) * 15;
    return v;
  };
  return side(me) - side(opp(me));
}

/** Is this a decision worth simulating (Supporter, gust, attack, Stadium)? */
function isKey(s: GameState, a: Action): boolean {
  if (a.t === 'attack' || a.t === 'retreat' || a.t === 'end') return true;
  if (a.t === 'trainer') {
    const k = keyOf(s, a.card);
    return isTrainerType(k, 'Supporter') || isTrainerType(k, 'Stadium') || def(k).name === 'Ultra Ball';
  }
  return false;
}

export function makeHardBot(plan: DeckPlan, oppPlan: DeckPlan, opts: { seed?: number } = {}): Bot {
  const normal = makeBot(plan, { level: 'normal', seed: opts.seed });
  const rand = makeRand((opts.seed ?? 1) ^ 0x68e31da4);
  let queue: number[][] = [];

  return {
    act(s: GameState): Action {
      if (s.pending) {
        const forced = queue.shift();
        const req = s.pending.request;
        if (forced && forced.every((v) => req.options.some((o) => o.value === v)) && forced.length >= req.min && forced.length <= req.max) {
          return { t: 'choose', picks: forced };
        }
        queue = [];
        return normal.act(s);
      }
      const me = actor(s);
      const first = decide(s, me, plan, rand);
      if (!isKey(s, first.action)) {
        queue = first.picks?.slice() ?? [];
        return first.action;
      }
      // Candidates: the normal choice, the planner's line, the best development moves, and ending the turn.
      const fin = planFinish(s, me, plan, Math.floor(rand() * 2 ** 31));
      const cands = [first, finishStep(s, fin), ...rankDevelopment(s, me, plan).slice(0, 2), { action: { t: 'end' } as Action, score: 0, reason: '' }];
      const seen = new Set<string>();
      const unique = cands.filter((c) => {
        const k = JSON.stringify('card' in c.action ? { ...c.action, card: keyOf(s, c.action.card) } : c.action);
        if (seen.has(k)) return false;
        seen.add(k);
        return legalActions(s).some((x) => JSON.stringify('card' in x ? { ...x, card: keyOf(s, x.card) } : x) === k);
      });
      if (unique.length <= 1) {
        queue = first.picks?.slice() ?? [];
        return first.action;
      }
      let best = unique[0]!;
      let bestValue = -Infinity;
      const seeds = Array.from({ length: SAMPLES }, () => Math.floor(rand() * 2 ** 31));
      for (const c of unique) {
        let total = 0;
        for (const seed of seeds) total += rollout(s, me, c.action, c.picks, seed, plan, oppPlan);
        const v = total / seeds.length;
        if (v > bestValue) {
          bestValue = v;
          best = c;
        }
      }
      queue = best.picks?.slice() ?? [];
      return best.action;
    },
  };
}

function rollout(s: GameState, me: PlayerId, action: Action, picks: number[][] | undefined, seed: number, plan: DeckPlan, oppPlan: DeckPlan): number {
  const mineBot = makeBot(plan, { seed: seed + 1 });
  const theirBot = makeBot(oppPlan, { seed: seed + 2 });
  let st: GameState;
  try {
    st = runStep(determinize(s, me, seed), { action, picks }, plan);
    // Finish this turn and the opponent's next one; stop when it is our turn again.
    let n = 0;
    while (st.winner === null && n++ < MAX_ROLLOUT_ACTIONS) {
      if (!st.pending && st.current === me && st.turn > s.turn) break;
      const p = actor(st);
      const a: Action = st.pending
        ? { t: 'choose', picks: choosePicks(st, st.pending.request, p === me ? plan : oppPlan) }
        : (p === me ? mineBot : theirBot).act(st);
      st = apply(st, a, { trusted: true });
    }
  } catch {
    return -1e4;
  }
  return evaluate(st, me);
}
