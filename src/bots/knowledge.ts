// Shared heuristics: how much a card is worth right now, which Pokémon should attack, where Energy goes.
import type { Attack, EnergyType } from '../data/cards';
import { baseDamage } from '../engine/combat';
import { def, hasRuleBox } from '../engine/db';
import { attackCost, canPay, energyOf, hpLeft } from '../engine/rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../engine/state';
import type { GameState, PlayerId, Slot } from '../engine/types';
import { P } from './params';
import type { DeckPlan } from './types';

/** Energy types still missing to pay `cost` with `have`. */
export function missingFor(have: EnergyType[], cost: EnergyType[]): number {
  const pool = have.slice();
  let missing = 0;
  let colorless = 0;
  for (const c of cost) {
    if (c === 'Colorless') {
      colorless++;
      continue;
    }
    const i = pool.indexOf(c);
    if (i < 0) missing++;
    else pool.splice(i, 1);
  }
  return missing + Math.max(0, colorless - pool.length);
}

/** Rough damage an attack does before modifiers (the "+" and "×" parts counted at a typical value). */
export function roughDamage(s: GameState, user: Slot, a: Attack): number {
  const base = baseDamage(a);
  const d = a.damage;
  const me = s.cards[user.stack[0]!]!.owner;
  if (a.name === 'Bellowing Thunder') return 70 * slotsOf(s.players[me]).reduce((n, sl) => n + sl.energy.length, 0);
  if (a.name === 'Do the Wave') return 20 * s.players[me].bench.length;
  if (a.name === 'Full Moon Rondo') return 20 + 20 * (s.players[0].bench.length + s.players[1].bench.length);
  if (a.name === 'Myriad Leaf Shower') return 30 + 30 * (user.energy.length + (s.players[opp(me)].active?.energy.length ?? 0));
  if (a.name === 'Powerful Hand') return 20 * s.players[me].hand.length;
  if (a.name === 'Irritated Outburst') return 60 * (6 - s.players[opp(me)].prizes.length);
  if (a.name === 'Rapid-Fire Combo') return 250;
  if (a.name === 'Phantom Dive') return 260;
  if (a.name === 'Seek Inspiration') return 110;
  if (a.name === 'Night Joker') return 170;
  const theirs = s.players[opp(me)];
  if (a.name === 'Thunder Raid') return theirs.bench.some((b) => hasRuleBox(topKey(s, b))) ? 210 : 0;
  if (a.name === 'Trifrost') return 110 * Math.min(3, theirs.bench.length + 1);
  if (a.name === 'Cruel Arrow') return 100;
  if (a.name === 'Twin Shotels') return 100;
  if (d.endsWith('+')) return base + 30;
  return base;
}

/** How good `slot` is as the attacking Active now: best attack damage, minus Energy still missing. */
export function attackerScore(s: GameState, me: PlayerId, slot: Slot, plan: DeckPlan, extraEnergy?: EnergyType): number {
  const d = topDef(s, slot);
  const have = energyOf(s, slot);
  if (extraEnergy) have.push(extraEnergy);
  let best = -1000;
  for (const a of d.attacks) {
    const miss = missingFor(have, attackCost(s, slot, a));
    best = Math.max(best, roughDamage(s, slot, a) - P.missingEnergy * miss);
  }
  const rank = plan.attackers.indexOf(topKey(s, slot));
  const bias = (rank >= 0 ? P.attackerRank - rank * P.attackerRankStep : 0) + (plan.attackerBias?.(s, me, slot) ?? 0);
  return best + bias + Math.min(hpLeft(s, slot), 300) / P.attackerHpDiv;
}

/** Can the Pokémon pay for one of its attacks now? */
export function canAttackNow(s: GameState, slot: Slot): boolean {
  const have = energyOf(s, slot);
  return topDef(s, slot).attacks.some((a) => canPay(have, attackCost(s, slot, a)));
}

/** Where an Energy card of type `type` helps most: the slot whose attacker score rises the most. */
export function energyTarget(s: GameState, me: PlayerId, type: EnergyType, plan: DeckPlan): Slot | undefined {
  let best: Slot | undefined;
  let bestGain = 0;
  for (const sl of slotsOf(s.players[me])) {
    const rank = plan.attackers.indexOf(topKey(s, sl));
    if (rank < 0 && !isAttackerLike(s, sl)) continue;
    const gain = attackerScore(s, me, sl, plan, type) - attackerScore(s, me, sl, plan);
    const active = s.players[me].active?.uid === sl.uid ? 5 : 0;
    const g = gain + active + (rank >= 0 ? 10 - rank : 0);
    if (g > bestGain) {
      bestGain = g;
      best = sl;
    }
  }
  return best;
}

function isAttackerLike(s: GameState, sl: Slot): boolean {
  return topDef(s, sl).attacks.some((a) => baseDamage(a) >= 60 || a.damage.endsWith('+') || a.damage.endsWith('×'));
}

/** Generic value of a card for this player right now (0–100). Plans can override per card. */
export function cardValue(s: GameState, me: PlayerId, key: string, plan: DeckPlan): number {
  const custom = plan.cardValue?.(s, me, key);
  if (custom !== undefined) return custom;
  const ps = s.players[me];
  const inPlay = slotsOf(ps);
  const names = inPlay.map((sl) => topDef(s, sl).name);
  const handKeys = ps.hand.map((c) => keyOf(s, c));
  const d = def(key);

  if (d.category === 'pokemon') {
    const attackerRank = plan.attackers.indexOf(key);
    let v = attackerRank >= 0 ? 35 - attackerRank * 3 : 15;
    if (d.stage !== 'Basic') {
      const below = d.evolvesFrom ?? '';
      if (names.includes(below)) v += 35;
      else if (handKeys.some((k) => def(k).name === below)) v += 15;
      else v -= 10;
    } else {
      const copies = names.filter((n) => n === d.name).length;
      v -= copies * 8;
      if (ps.bench.length >= 5) v -= 15;
    }
    if (d.abilities.length > 0) v += 5;
    return v;
  }
  if (d.category === 'energy') {
    if (d.energyType === 'Special') return 22;
    const t = d.provides!;
    const needs = inPlay.some((sl) => attackerScore(s, me, sl, plan, t) > attackerScore(s, me, sl, plan));
    return needs ? 28 : 10;
  }
  if (d.trainerType === 'Supporter') {
    const supporters = handKeys.filter((k) => def(k).category === 'trainer' && (def(k) as { trainerType?: string }).trainerType === 'Supporter').length;
    return supporters === 0 ? 34 : 16;
  }
  if (d.trainerType === 'Item') return 18;
  if (d.trainerType === 'Tool') return 14;
  return 12;
}

export function prizeValue(s: GameState, slot: Slot): number {
  return topDef(s, slot).prizes;
}

