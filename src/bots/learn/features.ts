// A position as numbers for the value network (pro.ts): one player's view of the board, both sides,
// scaled to roughly 0–1. Besides the board: the hard bot's hand-made score (so the network can learn
// how far to trust it) and what is in that player's own hand. Never the other hand, a deck or a Prize
// pile, so the same features work on a determinized copy (bots) and on a real game.
import { applyWR } from '../../engine/combat';
import { def, isBasicPokemon } from '../../engine/db';
import { benchLimit, attackCost, canPay, energyOf, hpLeft, maxHp } from '../../engine/rules';
import { keyOf, opp, slotsOf, topDef } from '../../engine/state';
import type { GameState, PlayerId, Slot } from '../../engine/types';
import { evaluate } from '../hard';
import { missingFor, roughDamage } from '../knowledge';

/** The decks the bots know, by plan name (DeckPlan.name); others get no deck feature. */
export const DECK_NAMES = [
  'player',
  'basic-box',
  'Dragapult ex',
  'Slowking Seek Inspiration',
  "N's Zoroark ex",
  'Alakazam Powerful Hand',
  'Festival Lead (Seaking)',
  'Festival Lead (Dipplin)',
] as const;

/** Values per side (mine first, then theirs). */
export const SIDE = 22;
const GAME = 7;
const HAND = 6;
export const FEATURES = 2 * SIDE + GAME + HAND + 2 * DECK_NAMES.length;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Best damage `user` can do to `target` now (payable attacks only) and at all (ignoring Energy). */
function damageTo(s: GameState, user: Slot, target: Slot | null, me: PlayerId): { now: number; any: number; missing: number } {
  let now = 0;
  let any = 0;
  let missing = 9;
  const have = energyOf(s, user);
  for (const a of topDef(s, user).attacks) {
    const cost = attackCost(s, user, a);
    const raw = roughDamage(s, user, a);
    const dmg = target ? applyWR(s, user, target, raw, me) : raw;
    any = Math.max(any, dmg);
    if (canPay(have, cost)) now = Math.max(now, dmg);
    missing = Math.min(missing, missingFor(have, cost));
  }
  return { now, any, missing };
}

function side(s: GameState, p: PlayerId, out: number[]): void {
  const ps = s.players[p];
  const them = s.players[opp(p)];
  const act = ps.active;
  const target = them.active;
  out.push(ps.prizes.length / 6);
  if (act) {
    const left = hpLeft(s, act);
    const d = damageTo(s, act, target, p);
    const theirLeft = target ? hpLeft(s, target) : 0;
    out.push(
      1,
      clamp01(left / 340),
      act.damage / maxHp(s, act),
      clamp01(act.energy.length / 5),
      clamp01(d.missing / 4),
      clamp01(d.now / 340),
      clamp01(d.any / 340),
      target && d.now >= theirLeft ? 1 : 0,
      target ? clamp01(d.now / Math.max(1, theirLeft)) : 0,
      topDef(s, act).prizes / 3,
      act.conditions.length > 0 ? 1 : 0,
    );
  } else out.push(0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0);
  let benchHp = 0;
  let benchEnergy = 0;
  let ready = 0;
  let evolved = 0;
  let liability = 0;
  let energy = 0;
  for (const sl of slotsOf(ps)) {
    energy += sl.energy.length;
    liability += topDef(s, sl).prizes;
    if (sl.stack.length > 1) evolved++;
    if (sl === act) continue;
    benchHp += hpLeft(s, sl);
    benchEnergy += sl.energy.length;
    if (damageTo(s, sl, target, p).missing === 0) ready++;
  }
  out.push(
    ps.bench.length / benchLimit(s, p),
    clamp01(benchHp / 1200),
    clamp01(benchEnergy / 8),
    clamp01(ready / 3),
    clamp01(evolved / 4),
    clamp01(liability / 12),
    clamp01(energy / 10),
    clamp01(ps.hand.length / 12),
    ps.deck.length / 60,
    s.stadium?.owner === p ? 1 : 0,
  );
}

/** What is in my own hand (I can see it; of the other hand only the count). */
function hand(s: GameState, me: PlayerId, out: number[]): void {
  const ps = s.players[me];
  const inPlay = new Set(slotsOf(ps).map((sl) => topDef(s, sl).name));
  let supporters = 0;
  let items = 0;
  let energy = 0;
  let basics = 0;
  let evolves = 0;
  let gust = 0;
  for (const c of ps.hand) {
    const k = keyOf(s, c);
    const d = def(k);
    if (d.category === 'energy') energy++;
    else if (d.category === 'trainer') {
      if (d.trainerType === 'Supporter') supporters++;
      else if (d.trainerType === 'Item') items++;
      if (k === 'bosss-orders') gust++;
    } else if (isBasicPokemon(k)) basics++;
    else if (d.evolvesFrom && inPlay.has(d.evolvesFrom)) evolves++;
  }
  out.push(clamp01(supporters / 3), clamp01(items / 5), clamp01(energy / 4), clamp01(basics / 3), clamp01(evolves / 3), gust > 0 ? 1 : 0);
}

/**
 * Features of `s` from `me`'s side: my side, their side, the game (with the hand-made score and the
 * Prize race), my hand, then which deck each side plays (`decks` = [my plan name, their plan name]).
 */
export function features(s: GameState, me: PlayerId, decks: readonly [string, string]): number[] {
  const out: number[] = [];
  side(s, me, out);
  side(s, opp(me), out);
  out.push(
    clamp01(s.turn / 30),
    s.current === me ? 1 : 0,
    s.first === me ? 1 : 0,
    s.current === me && s.players[me].supporterPlayed ? 1 : 0,
    s.current === me && s.players[me].energyAttached ? 1 : 0,
    (Math.tanh(evaluate(s, me) / 300) + 1) / 2,
    (s.players[opp(me)].prizes.length - s.players[me].prizes.length + 6) / 12,
  );
  hand(s, me, out);
  for (const name of decks) for (const d of DECK_NAMES) out.push(name === d ? 1 : 0);
  return out;
}
