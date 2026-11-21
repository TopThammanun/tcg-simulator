// Attack planning: simulate short setup sequences (switch in an attacker, attach Energy, gust a target,
// boost damage) followed by each attack, on a determinized state, and keep the best outcome.
// Uses the engine itself, so damage, Weakness and every card effect are counted exactly.
import { actor, apply, legalActions } from '../engine/actions';
import { isBasicEnergy } from '../engine/db';
import { energyOf, hpLeft, provides, retreatCost } from '../engine/rules';
import { keyOf, opp, slotsOf, topDef } from '../engine/state';
import type { Action, GameState, PlayerId, Slot } from '../engine/types';
import { determinize } from '../engine/view';
import { choosePicks } from './choose';
import { attackerScore, missingFor, roughDamage } from './knowledge';
import type { DeckPlan } from './types';
import { P } from './params';

export interface Step {
  action: Action;
  /** Answers for the choices this action asks, in order (the rest use the normal chooser). */
  picks?: number[][];
}

export interface Finish {
  steps: Step[];
  value: number;
  usesSupporter: boolean;
  usesEnergy: boolean;
}

type Category = 'switch' | 'energy' | 'supporter' | 'tool';
const NODE_BUDGET = 70;

/** Apply one step, answering its player's choices with the forced picks first, then the chooser (the opponent's: the chooser). */
export function runStep(s: GameState, step: Step, plan: DeckPlan): GameState {
  const me = actor(s);
  let cur = apply(s, step.action, { trusted: true });
  const forced = (step.picks ?? []).slice();
  let guard = 0;
  while (cur.pending && cur.winner === null && guard++ < 60) {
    const req = cur.pending.request;
    const f = req.player === me ? forced.shift() : undefined;
    const valid = f && f.every((v) => req.options.some((o) => o.value === v)) && f.length >= req.min && f.length <= req.max;
    cur = apply(cur, { t: 'choose', picks: valid ? f! : choosePicks(cur, req, plan) });
  }
  return cur;
}

/** Value of `after` relative to `before` for player `me` (prizes, damage, resources). */
export function outcome(before: GameState, after: GameState, me: PlayerId): number {
  if (after.winner === me) return 1e6;
  if (after.winner === opp(me)) return -1e6;
  if (after.winner === 'draw') return 0;
  const o = opp(me);
  let v = 0;
  v += P.prize * (before.players[me].prizes.length - after.players[me].prizes.length);
  v -= P.prize * (before.players[o].prizes.length - after.players[o].prizes.length);
  const beforeSlots = new Map<number, Slot>();
  for (const p of [0, 1] as const) for (const sl of slotsOf(before.players[p])) beforeSlots.set(sl.uid, sl);
  for (const sl of slotsOf(after.players[o])) {
    const prev = beforeSlots.get(sl.uid);
    const dmg = sl.damage - (prev?.damage ?? sl.damage);
    if (dmg <= 0) continue;
    const prizes = topDef(after, sl).prizes;
    const left = hpLeft(after, sl);
    v += dmg * P.damage * (1 + P.ruleBoxDamage * (prizes - 1)) + (left <= 60 ? P.nearKo : 0);
  }
  for (const sl of slotsOf(after.players[me])) {
    const prev = beforeSlots.get(sl.uid);
    if (prev) v -= Math.max(0, sl.damage - prev.damage) * P.selfDamage;
  }
  const energyOnBoard = (st: GameState, p: PlayerId) => slotsOf(st.players[p]).reduce((n, sl) => n + sl.energy.length, 0);
  const energyDiscarded = (st: GameState, p: PlayerId) =>
    st.players[p].discard.filter((c) => keyOf(st, c).endsWith('-energy')).length;
  v += P.discardTheirEnergy * Math.max(0, energyDiscarded(after, o) - energyDiscarded(before, o));
  v -= P.discardMyEnergy * Math.max(0, energyDiscarded(after, me) - energyDiscarded(before, me));
  v += P.energyOnBoard * (energyOnBoard(after, me) - energyOnBoard(before, me));
  v += P.handCard * (after.players[me].hand.length - before.players[me].hand.length);
  return v;
}

export function planFinish(s: GameState, me: PlayerId, plan: DeckPlan, seed: number): Finish {
  const root = determinize(s, me, seed);
  let nodes = 0;
  let best: { steps: Step[]; value: number } = { steps: [], value: 0 };

  const visit = (state: GameState, steps: Step[], used: Set<Category>) => {
    if (nodes++ > NODE_BUDGET) return;
    // Attack from here.
    for (const a of legalActions(state).filter((x) => x.t === 'attack')) {
      const after = runStep(state, { action: a }, plan);
      const v = outcome(root, after, me) + attackBias(state, a);
      if (v > best.value) best = { steps: [...steps, { action: a }], value: v };
    }
    if (steps.length >= 3) return;
    for (const cat of ['switch', 'energy', 'supporter', 'tool'] as Category[]) {
      if (used.has(cat)) continue;
      for (const step of candidates(state, me, cat, plan)) {
        if (nodes > NODE_BUDGET) return;
        let next: GameState;
        try {
          next = runStep(state, step, plan);
        } catch {
          continue;
        }
        if (next.winner !== null || next.current !== me) {
          const v = outcome(root, next, me);
          if (v > best.value) best = { steps: [...steps, step], value: v };
          continue;
        }
        visit(next, [...steps, step], new Set([...used, cat]));
      }
    }
  };
  visit(root, [], new Set());

  return {
    steps: best.steps,
    value: best.value,
    usesSupporter: best.steps.some((st) => st.action.t === 'trainer' && isSupporterAction(s, st.action)),
    usesEnergy: best.steps.some((st) => st.action.t === 'energy'),
  };
}

function isSupporterAction(s: GameState, a: Action): boolean {
  return a.t === 'trainer' && ['bosss-orders', 'gladions-final-battle', 'black-belts-training', 'kieran'].includes(keyOf(s, a.card));
}

/** Small preferences between attacks of equal outcome (keep the Pokémon able to attack next turn). */
function attackBias(s: GameState, a: Action): number {
  if (a.t !== 'attack') return 0;
  if (['Eon Blade', 'Prism Edge', 'Blood Moon', 'Rampaging Thunder'].includes(a.name)) return -6;
  if (a.name === 'Burst Roar') return s.players[s.current].hand.length <= 2 ? 15 : -40;
  if (a.name === 'Tuck Tail') return -10;
  return 0;
}

function candidates(s: GameState, me: PlayerId, cat: Category, plan: DeckPlan): Step[] {
  const legal = legalActions(s);
  const ps = s.players[me];
  const active = ps.active;
  if (!active) return [];
  const goodSwitchTargets = ps.bench
    .filter((b) => missingFor(energyOf(s, b), cheapestCost(s, b)) <= (ps.energyAttached ? 0 : 1))
    .sort((a, b) => attackerScore(s, me, b, plan) - attackerScore(s, me, a, plan))
    .slice(0, 2);
  const key = (a: Action) => ('card' in a ? keyOf(s, a.card) : '');

  if (cat === 'switch') {
    const out: Step[] = [];
    for (const b of goodSwitchTargets) {
      if (legal.some((a) => a.t === 'retreat' && a.to === b.uid)) out.push({ action: { t: 'retreat', to: b.uid } });
      const sw = legal.find((a) => a.t === 'trainer' && key(a) === 'switch');
      if (sw) out.push({ action: sw, picks: [[b.uid]] });
      const kieran = legal.find((a) => a.t === 'trainer' && key(a) === 'kieran');
      if (kieran) out.push({ action: kieran, picks: [[1], [b.uid]] });
    }
    const leaves = legal.find((a) => a.t === 'bench' && key(a) === 'iron-leaves-ex');
    if (leaves) out.push({ action: leaves, picks: [[1]] });
    const chains = legal.find((a) => a.t === 'ability' && a.name === 'Subjugating Chains');
    if (chains) out.push({ action: chains });
    return out;
  }
  if (cat === 'energy') {
    const out: Step[] = [];
    const seen = new Set<string>();
    const needRetreatEnergy = active.energy.length < retreatCost(s, me, active) && ps.bench.some((b) => goodSwitchTargets.includes(b));
    for (const a of legal) {
      if (a.t !== 'energy') continue;
      const k = key(a);
      const target = slotsOf(ps).find((sl) => sl.uid === a.target)!;
      const isAct = target.uid === active.uid;
      if (!isAct && !goodSwitchTargets.includes(target)) continue;
      if (seen.has(`${k}:${target.uid}`)) continue;
      seen.add(`${k}:${target.uid}`);
      // Energy that brings an attack closer, or pays for retreating to a ready attacker.
      const have = energyOf(s, target);
      const before = minMissing(s, target, have);
      const after = minMissing(s, target, [...have, provides(k)]);
      if (after < before || (isAct && (before === 0 || needRetreatEnergy))) out.push({ action: a });
    }
    const es = legal.find((a) => a.t === 'trainer' && key(a) === 'energy-switch');
    if (es) {
      for (const from of slotsOf(ps)) {
        if (from.uid === active.uid) continue;
        const basics = from.energy.filter((e) => isBasicEnergy(keyOf(s, e)));
        const kinds = new Map<string, number>();
        for (const e of basics) kinds.set(keyOf(s, e), e);
        for (const e of kinds.values()) out.push({ action: es, picks: [[from.uid], [e], [active.uid]] });
      }
    }
    return out.slice(0, 6);
  }
  if (cat === 'supporter') {
    const out: Step[] = [];
    const boss = legal.find((a) => a.t === 'trainer' && key(a) === 'bosss-orders');
    if (boss) {
      const dmg = Math.max(0, ...topDef(s, active).attacks.map((x) => roughDamage(s, active, x)));
      const targets = s.players[opp(me)].bench
        .map((b) => ({ b, score: (hpLeft(s, b) <= dmg + 80 ? 100 : 0) + topDef(s, b).prizes * 20 - hpLeft(s, b) / 20 }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 3);
      for (const t of targets) out.push({ action: boss, picks: [[t.b.uid]] });
    }
    for (const k of ['gladions-final-battle', 'black-belts-training']) {
      const a = legal.find((x) => x.t === 'trainer' && key(x) === k);
      if (a) out.push({ action: a });
    }
    const kieran = legal.find((a) => a.t === 'trainer' && key(a) === 'kieran');
    if (kieran) out.push({ action: kieran, picks: [[0]] });
    return out;
  }
  // tool
  const bangle = legal.find((a) => a.t === 'tool' && key(a) === 'brave-bangle' && a.target === active.uid);
  return bangle ? [{ action: bangle }] : [];
}

function cheapestCost(s: GameState, sl: Slot) {
  const atks = topDef(s, sl).attacks;
  return atks.reduce((best, a) => (a.cost.length < best.length && roughDamage(s, sl, a) > 0 ? a.cost : best), atks[atks.length - 1]?.cost ?? []);
}

function minMissing(s: GameState, sl: Slot, have: ReturnType<typeof energyOf>): number {
  return Math.min(...topDef(s, sl).attacks.map((a) => missingFor(have, a.cost)));
}

/** The planner searches with these seeds (several, as its search is cut short); fixed, so a position always gets the same answer. */
const SURE_SEEDS = [1, 2, 3];

/** Positions the win search tries at most (each a move and its choices played on the engine). */
const WIN_BUDGET = 2500;

/** A win this turn is worth looking for: a single Knock Out, or two, could take the last Prizes, or they have nothing to promote. */
export function winPlausible(s: GameState, me: PlayerId): boolean {
  const left = s.players[me].prizes.length;
  const theirs = s.players[opp(me)];
  if (left <= 2 || theirs.bench.length === 0) return true;
  return slotsOf(theirs).some((sl) => topDef(s, sl).prizes >= left);
}

/**
 * The attack planner tries a few set patterns; this tries every order of the moves a sure win can be made of
 * (Benching, evolving, Energy, retreating, gusts, Energy Switch, Tools, Abilities, the attack), on one deal of
 * what `me` can't see, and returns a line that wins this turn. Moves that draw, search, shuffle or flip a coin are
 * left out, so a line found here wins whatever the hidden cards are (sureLine still checks it on re-deals).
 * Choices with one pick among a few options are each tried; the others are made by the chooser.
 */
export function winLine(s: GameState, me: PlayerId, plan: DeckPlan, seed: number, budget = WIN_BUDGET): Step[] | null {
  const root = determinize(s, me, seed);
  const o = opp(me);
  const seen = new Set<string>();
  let nodes = 0;
  const hidden = (st: GameState) => [st.players[me].deck.length, st.players[o].deck.length, st.players[o].hand.length, st.rng.coin, ...st.rng.shuffle].join();
  const position = (st: GameState) =>
    JSON.stringify([st.players.map((p) => [p.hand, p.active, p.bench, p.discard.length, p.prizes.length, p.supporterPlayed, p.energyAttached, p.retreated, p.stadiumPlayed]), st.stadium]);

  /** Every way to play `action` through its choices: the position after it and the picks made. */
  const ways = (st: GameState, action: Action): { next: GameState; picks: number[][] }[] => {
    const out: { next: GameState; picks: number[][] }[] = [];
    const before = hidden(st);
    const go = (cur: GameState, picks: number[][]) => {
      if (nodes++ > budget) return;
      if (hidden(cur) !== before) return;
      if (!cur.pending || cur.winner !== null) {
        out.push({ next: cur, picks });
        return;
      }
      const req = cur.pending.request;
      const options =
        req.player === me && req.min === 1 && req.max === 1 && !req.repeat && req.options.length <= 6
          ? req.options.map((x) => [x.value])
          : [choosePicks(cur, req, plan)];
      for (const p of options) {
        let next: GameState;
        try {
          next = apply(cur, { t: 'choose', picks: p });
        } catch {
          continue;
        }
        go(next, req.player === me ? [...picks, p] : picks);
      }
    };
    try {
      go(apply(st, action, { trusted: true }), []);
    } catch {
      // not playable here
    }
    return out;
  };

  const dfs = (st: GameState): Step[] | null => {
    const legal = legalActions(st);
    // Attacks first: they end the turn, and a win is usually one attack away.
    const order = [...legal.filter((a) => a.t === 'attack'), ...legal.filter((a) => a.t !== 'attack' && a.t !== 'end')];
    for (const action of order) {
      for (const { next, picks } of ways(st, action)) {
        const step: Step = picks.length ? { action, picks } : { action };
        if (next.winner === me) return [step];
        if (next.winner !== null || next.current !== me || action.t === 'attack') continue;
        const key = position(next);
        if (seen.has(key)) continue;
        seen.add(key);
        const rest = dfs(next);
        if (rest) return [step, ...rest];
      }
      if (nodes > budget) return null;
    }
    return null;
  };
  return dfs(root);
}

/** Prizes `steps` take from `s` on `checks` re-deals (the least), and whether they win on every one; null if they break. */
function checkLine(s: GameState, me: PlayerId, plan: DeckPlan, steps: Step[], checks: number): { prizes: number; wins: boolean } | null {
  let prizes = Infinity;
  let wins = true;
  try {
    for (let k = 0; k < checks; k++) {
      let st = determinize(s, me, 7919 * (k + 1));
      for (const step of steps) {
        if (st.winner !== null || st.current !== me || st.pending) break;
        st = runStep(st, step, plan);
      }
      prizes = Math.min(prizes, s.players[me].prizes.length - st.players[me].prizes.length);
      if (st.winner !== me) wins = false;
    }
  } catch {
    return null;
  }
  return prizes === Infinity ? null : { prizes, wins };
}

/**
 * The attack planner's best line from `s` checked on `checks` re-deals of what `me` can't see: the Prizes
 * it takes on all of them (the least), and whether it wins on all of them. The search and the re-deals use
 * fixed seeds, so the same position always gets the same answer. (The review's "พลาดชัด" check, and the
 * bot's last look before it ends a turn.)
 */
export function sureLine(s: GameState, me: PlayerId, plan: DeckPlan, checks: number): { prizes: number; wins: boolean; steps: Step[] } {
  let best: { prizes: number; wins: boolean; steps: Step[] } = { prizes: 0, wins: false, steps: [] };
  for (const seed of SURE_SEEDS) {
    const fin = planFinish(s, me, plan, seed);
    if (!fin.steps.length) continue;
    const r = checkLine(s, me, plan, fin.steps, checks);
    if (!r) continue;
    if (Number(r.wins) > Number(best.wins) || (r.wins === best.wins && r.prizes > best.prizes)) best = { ...r, steps: fin.steps };
  }
  // The planner's patterns found no win; the wider search may (a win made of more moves than they cover).
  if (!best.wins && s.phase === 'main' && !s.pending && s.current === me && winPlausible(s, me)) {
    const steps = winLine(s, me, plan, SURE_SEEDS[0]!);
    const r = steps && checkLine(s, me, plan, steps, checks);
    if (steps && r?.wins) best = { ...r, steps };
  }
  return best;
}
