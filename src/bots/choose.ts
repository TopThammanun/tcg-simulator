// Answers to pending choices, by what the choice is for.
import type { EnergyType, PokemonCard } from '../data/cards';
import { CARDS, def, hasRuleBox, isBasicEnergy, isEnergy } from '../engine/db';
import { hpLeft, isActive, ownerOf, provides, slotsWithAbility } from '../engine/rules';
import { findSlot, keyOf, opp, slotsOf, topDef, topKey } from '../engine/state';
import type { CardId, ChoiceRequest, GameState, PlayerId, Slot } from '../engine/types';
import { attackerScore, canAttackNow, cardValue, energyTarget, missingFor, roughDamage } from './knowledge';
import type { DeckPlan } from './types';

const AMOUNT_BY_SOURCE: Record<string, number> = {
  'fezandipiti-ex': 100,
  'iron-crown-ex': 50,
  kyurem: 110,
  slowking: 110,
  zeraora: 210,
  'wellspring-mask-ogerpon-ex': 120,
};

export function choosePicks(s: GameState, req: ChoiceRequest, plan: DeckPlan): number[] {
  const me = req.player;
  const custom = plan.choose?.(s, me, req);
  if (custom && custom.length >= req.min && custom.length <= req.max) return custom;
  const values = req.options.map((o) => o.value);
  const count = (n: number) => Math.max(req.min, Math.min(req.max, n));
  const top = (scored: { v: number; score: number }[], n: number) =>
    scored
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((x) => x.v);
  const slotOf = (uid: number) => findSlot(s, uid)?.slot;
  const cardsScored = (f: (c: CardId) => number) => req.options.map((o) => ({ v: o.value, score: f(o.value) }));
  const theirs = (c: CardId) => s.cards[c]!.owner !== me;

  switch (req.purpose) {
    case 'first':
      return [plan.decide?.(s, me, 'first', req.prompt) ?? 0];
    case 'mulligan-draw':
      return [values[values.length - 1]!];
    case 'setup-active': {
      const scored = cardsScored((c) => starterScore(keyOf(s, c), plan));
      return top(scored, 1);
    }
    case 'setup-bench': {
      const target = Math.min(5, plan.benchTarget?.(s, me) ?? 4);
      const seen = new Map<string, number>();
      const scored = cardsScored((c) => {
        const k = keyOf(s, c);
        const n = seen.get(k) ?? 0;
        seen.set(k, n + 1);
        return cardValue(s, me, k, plan) - n * 12 - (hasRuleBox(k) && !plan.attackers.includes(k) ? 15 : 0);
      });
      return top(scored.filter((x) => x.score > 5), count(target));
    }
    case 'promote':
    case 'switch': {
      const scored = req.options.map((o) => {
        const sl = slotOf(o.value)!;
        return { v: o.value, score: attackerScore(s, me, sl, plan) + (canAttackNow(s, sl) ? 60 : 0) };
      });
      return top(scored, 1);
    }
    case 'gust':
      return [gustTarget(s, me, req.options.map((o) => slotOf(o.value)!), plan).uid];
    case 'bench-trim': {
      const scored = req.options.map((o) => {
        const sl = slotOf(o.value)!;
        return { v: o.value, score: -(cardValue(s, me, topKey(s, sl), plan) + sl.energy.length * 10 + sl.stack.length * 10 - sl.damage / 10) };
      });
      return top(scored, req.min);
    }
    case 'counters':
      return distributeCounters(s, req.options.map((o) => slotOf(o.value)!), req.max);
    case 'target': {
      const slots = req.options.map((o) => slotOf(o.value)!);
      if (slots.every((sl) => ownerOf(s, sl) === me)) {
        // Own Pokémon (Adrena-Brain source, Tool Scrapper on our side…): most damaged first.
        return top(slots.map((sl) => ({ v: sl.uid, score: sl.damage })), count(1));
      }
      const amount = AMOUNT_BY_SOURCE[req.source ?? ''] ?? 100;
      const scored = slots.map((sl) => ({ v: sl.uid, score: targetScore(s, sl, amount) }));
      if (req.source === 'tool-scrapper') {
        return top(slots.map((sl) => ({ v: sl.uid, score: ownerOf(s, sl) === me ? -50 : 20 })).filter((x) => x.score > 0), count(2));
      }
      return top(scored, count(req.max));
    }
    case 'attach': {
      if (req.options[0]?.slot !== undefined) {
        const slots = req.options.map((o) => slotOf(o.value)!);
        const scored = slots.map((sl) => ({ v: sl.uid, score: attackerScore(s, me, sl, plan) + (plan.attackers.includes(topKey(s, sl)) ? 30 : 0) }));
        return top(scored, count(req.max));
      }
      // Which Energy card to attach: one the best attacker still needs.
      const scored = cardsScored((c) => energyNeedScore(s, me, keyOf(s, c), plan));
      return top(scored, count(req.max));
    }
    case 'energy':
      return energyChoice(s, me, req, plan);
    case 'search':
    case 'take': {
      // Face-down Prize cards picked by position (engine/rules.ts takePrizes): any of them, the first ones.
      if (req.hint === 'prizes') return req.options.slice(0, req.min).map((o) => o.value);
      const scored = cardsScored((c) => (theirs(c) ? 0 : cardValue(s, me, keyOf(s, c), plan)));
      const n = req.min === 0 ? scored.filter((x) => x.score > 0).length : req.max;
      return top(scored, count(n));
    }
    case 'order':
      return top(cardsScored((c) => cardValue(s, me, keyOf(s, c), plan)), req.max);
    case 'discard':
    case 'discard-cost': {
      if (req.hint === 'per-card-70') return bellowingThunder(s, me, req);
      if (req.options.length > 0 && theirs(req.options[0]!.value)) {
        // Taking from the opponent's hand: their best cards.
        const scored = cardsScored((c) => cardValue(s, opp(me), keyOf(s, c), plan));
        return top(scored, count(req.max));
      }
      const scored = cardsScored((c) => -cardValue(s, me, keyOf(s, c), plan));
      return top(scored, count(req.min));
    }
    case 'yesno':
      return [yesNo(s, me, req, plan)];
    case 'attack':
    case 'option':
      return [optionChoice(s, me, req, plan)];
  }
}

function starterScore(key: string, plan: DeckPlan): number {
  const i = plan.starters?.indexOf(key) ?? -1;
  if (i >= 0) return 100 - i * 5;
  const d = def(key);
  if (d.category !== 'pokemon') return 0;
  return (hasRuleBox(key) ? 0 : 20) - d.retreat * 5 + d.hp / 20;
}

/** Score an opponent's Pokémon as a damage target for `amount` damage. */
function targetScore(s: GameState, sl: Slot, amount: number): number {
  const d = topDef(s, sl);
  const benched = !isActive(s, sl);
  const owner = ownerOf(s, sl);
  if (benched && (d.tera || slotsWithAbility(s, owner, 'Spherical Shield').length > 0)) return -100;
  if (benched && !hasRuleBox(topKey(s, sl)) && slotsWithAbility(s, owner, 'Flower Curtain').length > 0) return -100;
  const left = hpLeft(s, sl);
  const ko = left <= amount;
  return (ko ? 200 + d.prizes * 100 : d.prizes * 20 + (amount / Math.max(left, 1)) * 50) + (sl.energy.length * 5);
}

export function gustTarget(s: GameState, me: PlayerId, options: Slot[], plan: DeckPlan): Slot {
  const a = s.players[me].active;
  const dmg = a ? Math.max(0, ...topDef(s, a).attacks.map((x) => roughDamage(s, a, x))) : 0;
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const sl of options) {
    const left = hpLeft(s, sl);
    const d = topDef(s, sl);
    const score = (left <= dmg ? 500 + d.prizes * 100 : d.prizes * 30 - left / 10) + d.retreat * 3 + attackerScore(s, opp(me), sl, plan) / 20;
    if (score > bestScore) {
      bestScore = score;
      best = sl;
    }
  }
  return best;
}

/** Damage counters on the opponent's Bench: Knock Out what can be Knocked Out, best Prize value first. */
function distributeCounters(s: GameState, targets: Slot[], n: number): number[] {
  const usable = targets.filter((sl) => !sl.energy.some((e) => keyOf(s, e) === 'mist-energy'));
  const pool = usable.length > 0 ? usable : targets;
  const picks: number[] = [];
  let left = n;
  const remaining = pool.slice();
  for (;;) {
    const koable = remaining
      .map((sl) => ({ sl, need: Math.ceil(hpLeft(s, sl) / 10) }))
      .filter((x) => x.need <= left)
      .sort((a, b) => topDef(s, b.sl).prizes - topDef(s, a.sl).prizes || a.need - b.need);
    const pick = koable[0];
    if (!pick) break;
    for (let i = 0; i < pick.need; i++) picks.push(pick.sl.uid);
    left -= pick.need;
    remaining.splice(remaining.indexOf(pick.sl), 1);
  }
  if (left > 0) {
    const rest = (remaining.length ? remaining : pool)
      .slice()
      .sort((a, b) => topDef(s, b).prizes - topDef(s, a).prizes || hpLeft(s, a) - hpLeft(s, b))[0]!;
    for (let i = 0; i < left; i++) picks.push(rest.uid);
  }
  return picks;
}

function energyNeedScore(s: GameState, me: PlayerId, key: string, plan: DeckPlan): number {
  if (!isEnergy(key)) return 0;
  const t = provides(key);
  return energyTarget(s, me, t, plan) ? 10 + (t === 'Colorless' ? 0 : 5) : 1;
}

function energyChoice(s: GameState, me: PlayerId, req: ChoiceRequest, plan: DeckPlan): number[] {
  const n = (k: number) => Math.max(req.min, Math.min(req.max, k));
  if (req.options[0]?.slot !== undefined) {
    // Energy Switch "from": the Pokémon that needs its Energy least.
    const scored = req.options.map((o) => {
      const sl = findSlot(s, o.value)!.slot;
      return { v: o.value, score: -attackerScore(s, me, sl, plan) };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, n(1)).map((x) => x.v);
  }
  const cards = req.options.map((o) => o.value);
  const owner = s.cards[cards[0]!]!.owner;
  if (owner !== me) {
    // Opponent's Energy: Special Energy first.
    return cards
      .map((c) => ({ c, score: isBasicEnergy(keyOf(s, c)) ? 1 : 2 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n(1))
      .map((x) => x.c);
  }
  if (req.source === 'iron-leaves-ex') {
    // Rapid Vernier: bring enough Energy for Prism Edge ({G}{G}{C}).
    const want: EnergyType[] = ['Grass', 'Grass', 'Colorless'];
    const picked: number[] = [];
    for (const c of cards.slice().sort((a, b) => (provides(keyOf(s, b)) === 'Grass' ? 1 : 0) - (provides(keyOf(s, a)) === 'Grass' ? 1 : 0))) {
      if (missingFor(picked.map((x) => provides(keyOf(s, x))), want) === 0) break;
      picked.push(c);
    }
    return picked.slice(0, req.max);
  }
  // Own Energy leaving a Pokémon: types the best attacker doesn't need go first.
  const scored = cards.map((c) => ({ c, score: -energyNeedScore(s, me, keyOf(s, c), plan) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, n(req.min || 1)).map((x) => x.c);
}

function bellowingThunder(s: GameState, me: PlayerId, req: ChoiceRequest): number[] {
  const d = s.players[opp(me)].active;
  if (!d) return [];
  const need = Math.ceil(hpLeft(s, d) / 70);
  const user = s.players[me].active!;
  // Discard from other Pokémon before Raging Bolt itself.
  const ordered = req.options
    .map((o) => o.value)
    .sort((a, b) => (user.energy.includes(a) ? 1 : 0) - (user.energy.includes(b) ? 1 : 0));
  return ordered.slice(0, Math.min(ordered.length, Math.max(need, 1)));
}

function yesNo(s: GameState, me: PlayerId, req: ChoiceRequest, plan: DeckPlan): number {
  const custom = plan.decide?.(s, me, req.source, req.prompt);
  if (custom !== undefined) return custom;
  const ps = s.players[me];
  switch (req.source) {
    case 'mew-ex': {
      const a = ps.active!;
      return hpLeft(s, a) < 100 && ps.bench.some((b) => canAttackNow(s, b)) ? 1 : 0;
    }
    case 'wellspring-mask-ogerpon-ex': {
      const targets = s.players[opp(me)].bench.filter((b) => targetScore(s, b, 120) >= 200);
      return targets.length > 0 ? 1 : 0;
    }
    case 'metagross': {
      const d = s.players[opp(me)].active;
      return d && hpLeft(s, d) > 60 * 2 ? 1 : 0;
    }
    case 'chien-pao': {
      const st = s.stadium;
      return st && st.owner !== me ? 1 : 0;
    }
    case 'iron-leaves-ex': {
      const others = slotsOf(ps).filter((sl) => topKey(s, sl) !== 'iron-leaves-ex');
      const energy = others.flatMap((sl) => sl.energy.map((e) => provides(keyOf(s, e))));
      return missingFor(energy, ['Grass', 'Grass', 'Colorless']) === 0 ? 1 : 0;
    }
  }
  return 1;
}

function optionChoice(s: GameState, me: PlayerId, req: ChoiceRequest, plan: DeckPlan): number {
  const custom = plan.decide?.(s, me, req.source, req.prompt);
  if (custom !== undefined) return custom;
  const labels = req.options.map((o) => o.label);
  if (req.purpose === 'attack') {
    // Festival Lead second attack or a copied attack: the one that does the most.
    const user = s.players[me].active;
    let best = 0;
    let bestDmg = -1;
    labels.forEach((name, i) => {
      if (name === 'ไม่โจมตีอีก') return;
      const atk = findAttack(name);
      const dmg = atk && user ? roughDamage(s, user, atk) + (name === 'Trifrost' ? 150 : 0) : 0;
      if (dmg > bestDmg) {
        bestDmg = dmg;
        best = i;
      }
    });
    // Festival Lead's second Rapid Draw also draws 2: skip it when the deck is thin and it won't Knock Out.
    if (labels[best] === 'Rapid Draw' && labels[labels.length - 1] === 'ไม่โจมตีอีก') {
      const d = s.players[opp(me)].active;
      const ko = d && user && hpLeft(s, d) <= roughDamage(s, user, findAttack('Rapid Draw')!) + 30;
      if (s.players[me].deck.length < 4 || (s.players[me].deck.length < 12 && !ko)) return req.options[labels.length - 1]!.value;
    }
    return req.options[best]!.value;
  }
  if (req.source === 'kieran') {
    const d = s.players[opp(me)].active;
    return d && hasRuleBox(topKey(s, d)) ? 0 : labels.length > 1 ? 1 : 0;
  }
  if (req.source === 'munkidori') return req.options[req.options.length - 1]!.value;
  return req.options[0]!.value;
}

const ALL_POKEMON = Object.values(CARDS).filter((c): c is PokemonCard => c.category === 'pokemon');

function findAttack(name: string) {
  for (const d of ALL_POKEMON) {
    const a = d.attacks.find((x) => x.name === name);
    if (a) return a;
  }
  return undefined;
}
