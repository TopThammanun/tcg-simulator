// Why the better way of playing a turn is better, next to the way you played it (the review's "ได้อะไร" and
// "play around"), read off the two positions once the turn has passed:
// - now: what it takes or sets up: Prizes and Knock Outs, damage left on their Pokémon, attackers set for next turn,
//   Pokémon in play, Energy in play, cards kept in hand, the opponent's hand, the cards left in your deck,
// - around: what it plays around: the opponent's next turn played out from both positions (threat.ts: what you
//   couldn't see re-dealt, their deck's rule-based bot, calibrated per deck): their chance to win then, the Prizes
//   they are expected to take, and which of your Pokémon are much safer,
// - yours: the same comparison the other way, what your way had going for it, so the trade is shown whole.
// Both positions are judged from your side: the opponent's turn only ever sees what you could.
import { choosePicks } from '../bots/choose';
import { missingFor, roughDamage } from '../bots/knowledge';
import { actor, apply } from '../engine/actions';
import { def } from '../engine/db';
import { attackCost, energyOf, hpLeft } from '../engine/rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../engine/state';
import type { GameState, PlayerId } from '../engine/types';
import { tx } from '../i18n';
import { threats, type Plans, type ThreatReport } from './threat';

export interface Gains {
  /** Whose way the facts describe: the line that was missed, or the bot's turn. */
  of: 'missed' | 'bot';
  /** What it takes or sets up, next to yours. */
  now: string[];
  /** What it plays around on the opponent's next turn, next to yours. */
  around: string[];
  /** The opponent's next turn is about the same either way: the Prizes they are expected to take (no `around`). */
  even?: number;
  /** What your way had going for it. */
  yours: string[];
}

export interface GainsOptions {
  /** Re-deals of the opponent's next turn, per position (threat.ts). */
  samples?: number;
  seed?: number;
  /** The opponent's deck slug, for the correction of its chances (calibration.ts). */
  theirDeck?: string;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
/** Most facts of each kind shown: the strongest first. */
const MOST = 4;

/** Card keys counted: the multiset difference a − b. */
function minus(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const k of b) left.set(k, (left.get(k) ?? 0) + 1);
  return a.filter((k) => {
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    return n === 0;
  });
}

const names = (keys: string[]) => [...new Set(keys)].map((k) => def(k).name).join(', ');

/** Damage an attack must do to count as an attacker set for next turn (not a chip or a set-up attack). */
const ATTACKER = 60;

/** Each of your Pokémon's best attack for next turn: usable now, or one Energy (next turn's attachment) away. */
function setAttacks(s: GameState, me: PlayerId): { key: string; attack: string; missing: number; dmg: number }[] {
  const out: { key: string; attack: string; missing: number; dmg: number }[] = [];
  for (const sl of slotsOf(s.players[me])) {
    const have = energyOf(s, sl);
    let best: { attack: string; missing: number; dmg: number } | undefined;
    for (const at of topDef(s, sl).attacks) {
      const missing = missingFor(have, attackCost(s, sl, at));
      const dmg = roughDamage(s, sl, at);
      if (missing > 1 || dmg < ATTACKER) continue;
      if (!best || missing < best.missing || (missing === best.missing && dmg > best.dmg)) best = { attack: at.name, missing, dmg };
    }
    if (best) out.push({ key: topKey(s, sl), ...best });
  }
  return out;
}

/**
 * What position `a` has over `b`, both reached from `start` by `me` playing a turn; `other` names b's way in the text
 * ("ทางของคุณ" for yours).
 */
export function boardFacts(start: GameState, a: GameState, b: GameState, me: PlayerId, other: string): string[] {
  const o = opp(me);
  const out: string[] = [];
  const pa = a.players[me];
  const pb = b.players[me];
  if (a.winner === me && b.winner !== me) return [tx('ชนะเกมในเทิร์นนี้', 'Wins the game this turn')];

  // Prizes, and the Pokémon of theirs Knocked Out for them.
  const took = (s: GameState) => start.players[me].prizes.length - s.players[me].prizes.length;
  if (took(a) > took(b)) {
    const gone = (s: GameState) => new Set(slotsOf(s.players[o]).map((sl) => sl.uid));
    const inA = gone(a);
    const inB = gone(b);
    const kos = slotsOf(start.players[o]).filter((sl) => !inA.has(sl.uid) && inB.has(sl.uid)).map((sl) => topDef(start, sl).name);
    const ko = kos.length ? `KO ${kos.join(', ')}: ` : '';
    out.push(
      tx(
        `${ko}ได้ ${took(a)} Prize (${other} ${took(b)}) เหลืออีก ${pa.prizes.length} ใบก็ชนะ`,
        `${ko}takes ${took(a)} Prize ${took(a) === 1 ? 'card' : 'cards'} (${other}: ${took(b)}), ${pa.prizes.length} left to win`,
      ),
    );
  }

  // Damage left on their Pokémon: a Knock Out next turn comes cheaper.
  const theirsB = new Map(slotsOf(b.players[o]).map((sl) => [sl.uid, sl]));
  for (const sl of slotsOf(a.players[o])) {
    const sb = theirsB.get(sl.uid);
    if (!sb) continue;
    const ha = hpLeft(a, sl);
    const hb = hpLeft(b, sb);
    if (hb - ha >= 30)
      out.push(tx(`${topDef(a, sl).name} ของอีกฝั่งเหลือ ${ha} HP (${other} ${hb}): KO ได้ง่ายขึ้นเทิร์นหน้า`, `Their ${topDef(a, sl).name} is down to ${ha} HP (${other}: ${hb}): easier to Knock Out next turn`));
  }

  // Attackers set for next turn.
  const sig = (x: { key: string; attack: string; missing: number }) => `${x.key}|${x.attack}|${x.missing}`;
  const setB = setAttacks(b, me).map(sig);
  const setA = setAttacks(a, me);
  const extra = new Set(minus(setA.map(sig), setB));
  for (const x of setA.filter((y) => extra.has(sig(y))).sort((y, z) => y.missing - z.missing || z.dmg - y.dmg).slice(0, 2)) {
    const name = def(x.key).name;
    out.push(
      x.missing === 0
        ? tx(`${name} พร้อมใช้ ${x.attack} (~${x.dmg}) เทิร์นหน้า`, `${name} is ready to use ${x.attack} (~${x.dmg}) next turn`)
        : tx(`${name} ขาดอีกแค่ 1 พลังงานสำหรับ ${x.attack} (~${x.dmg}): ติดเทิร์นหน้าแล้วตีได้เลย`, `${name} is 1 Energy short of ${x.attack} (~${x.dmg}): attach next turn and attack`),
    );
  }

  // Pokémon in play (evolved, or on the Bench) that b's way doesn't have.
  const inPlay = (s: GameState) => slotsOf(s.players[me]).map((sl) => topKey(s, sl));
  const more = minus(inPlay(a), inPlay(b));
  if (more.length) out.push(tx(`มี ${names(more)} บนสนามแล้ว (${other} ไม่มี)`, `${names(more)} in play already (${other}: not yet)`));

  // Energy in play.
  const energy = (s: GameState) => slotsOf(s.players[me]).reduce((n, sl) => n + sl.energy.length, 0);
  if (energy(a) > energy(b)) out.push(tx(`พลังงานบนสนาม ${energy(a)} ใบ (${other} ${energy(b)})`, `${energy(a)} Energy in play (${other}: ${energy(b)})`));

  // Cards kept: what b's way played or discarded this turn that a still holds, and the size of the hand.
  const handKeys = (s: GameState) => s.players[me].hand.map((c) => keyOf(s, c));
  const spent = (s: GameState) => {
    const was = new Set(start.players[me].discard);
    return s.players[me].discard.filter((c) => !was.has(c)).map((c) => keyOf(s, c));
  };
  const kept = minus(handKeys(a), handKeys(b)).filter((k) => spent(b).includes(k) && def(k).category === 'trainer');
  if (kept.length) out.push(tx(`เก็บ ${names(kept)} ไว้ในมือ (${other} ใช้หรือทิ้งไปแล้ว)`, `Keeps ${names(kept)} in hand (${other}: played or discarded)`));
  if (pa.hand.length - pb.hand.length >= 2)
    out.push(tx(`การ์ดในมือ ${pa.hand.length} ใบ (${other} ${pb.hand.length}): มีทรัพยากรไว้เล่นเทิร์นหน้า`, `${pa.hand.length} cards in hand (${other}: ${pb.hand.length}): more to play next turn`));

  // Their hand.
  const oa = a.players[o].hand.length;
  const ob = b.players[o].hand.length;
  if (ob - oa >= 2) out.push(tx(`มืออีกฝั่งเหลือ ${oa} ใบ (${other} ${ob}): มีทางเล่นน้อยลง`, `Their hand is down to ${oa} cards (${other}: ${ob}): fewer ways to play`));

  // Your deck, when it is running low.
  if (pb.deck.length <= 12 && pa.deck.length - pb.deck.length >= 3)
    out.push(tx(`การ์ดในเด็คเหลือ ${pa.deck.length} ใบ (${other} ${pb.deck.length}): ห่างจากการจั่วหมดเด็ค`, `${pa.deck.length} cards left in your deck (${other}: ${pb.deck.length}): further from decking out`));
  return out.slice(0, MOST);
}

/** What report `a` (the opponent's next turn from one position) spares you next to `b` (from the other). */
export function threatFacts(a: ThreatReport, b: ThreatReport, other: string): string[] {
  const out: string[] = [];
  if (b.winChance - a.winChance >= 0.1)
    out.push(tx(`อีกฝั่งมีโอกาสชนะในเทิร์นถัดไปแค่ ${pct(a.winChance)} (${other} ${pct(b.winChance)})`, `Their chance to win on their next turn is only ${pct(a.winChance)} (${other}: ${pct(b.winChance)})`));
  // Your Pokémon much safer, the most Prizes at stake first.
  const used = new Set<number>();
  const risky = b.slots.filter((x) => x.chance >= 0.3).sort((x, y) => y.chance * y.prizes - x.chance * x.prizes);
  for (const y of risky) {
    const x = a.slots.find((z) => z.uid === y.uid && !used.has(z.uid)) ?? a.slots.find((z) => z.key === y.key && !used.has(z.uid));
    if (x) used.add(x.uid);
    const chance = x?.chance ?? 0;
    if (y.chance - chance < 0.25) continue;
    const how = y.lines[0]?.label;
    const prizes = tx(`${y.prizes} Prize`, `${y.prizes} Prize ${y.prizes === 1 ? 'card' : 'cards'}`);
    out.push(
      x
        ? tx(
            `${y.name} (ให้ ${prizes}) มีโอกาสโดน KO ${pct(chance)} (${other} ${pct(y.chance)}${how ? ` ด้วย ${how}` : ''})`,
            `${y.name} (worth ${prizes}) is Knocked Out ${pct(chance)} of the time (${other}: ${pct(y.chance)}${how ? `, by ${how}` : ''})`,
          )
        : tx(
            `ไม่มี ${y.name} (ให้ ${prizes}) บนสนามให้อีกฝั่งเก็บ (${other} โดน KO ${pct(y.chance)}${how ? ` ด้วย ${how}` : ''})`,
            `No ${y.name} (worth ${prizes}) in play for them to take (${other}: Knocked Out ${pct(y.chance)} of the time${how ? `, by ${how}` : ''})`,
          ),
    );
    if (out.length >= 3) break;
  }
  if (b.expected - a.expected >= 0.4 && out.length < 3)
    out.push(tx(`อีกฝั่งน่าจะได้ Prize ${one(a.expected)} ใบในเทิร์นถัดไป (${other} ${one(b.expected)})`, `They are expected to take ${one(a.expected)} Prize cards on their next turn (${other}: ${one(b.expected)})`));
  return out;
}

/** Play on until the turn has passed: answers to choices (each side by its deck), then the end of the turn. */
export function settle(s: GameState, me: PlayerId, plans: Plans): GameState {
  let st = s;
  for (let n = 0; n < 60 && st.winner === null; n++) {
    if (st.pending) st = apply(st, { t: 'choose', picks: choosePicks(st, st.pending.request, actor(st) === me ? plans.mine : plans.theirs) }, { trusted: true });
    else if (st.current === me) st = apply(st, { t: 'end' }, { trusted: true });
    else break;
  }
  return st;
}

/**
 * Why `better` (the position the better way reaches once the turn has passed) beats `yours`, both from `start`;
 * `of` names that way.
 */
export function gainsOf(start: GameState, yours: GameState, better: GameState, me: PlayerId, plans: Plans, of: Gains['of'], opts: GainsOptions = {}): Gains {
  const mine = tx('ทางของคุณ', 'yours');
  const its = of === 'bot' ? tx('ทางของบอท', "the bot's") : tx('ทางที่พลาดไป', 'the missed line');
  const gains: Gains = { of, now: boardFacts(start, better, yours, me, mine), around: [], yours: boardFacts(start, yours, better, me, its) };
  if (yours.winner !== null || better.winner !== null) return gains;
  const opt = { samples: opts.samples ?? 24, seed: opts.seed, theirDeck: opts.theirDeck, ending: null };
  const ty = threats(yours, me, plans, opt);
  const tb = threats(better, me, plans, opt);
  gains.around = threatFacts(tb, ty, mine);
  gains.yours.push(...threatFacts(ty, tb, its));
  if (!gains.around.length) gains.even = Math.round(tb.expected * 10) / 10;
  gains.yours = gains.yours.slice(0, MOST);
  return gains;
}
