// A decision as numbers for the policy/value network (model.ts): what the acting player can see, and one
// row per option. Pokémon in play are tokens (card + HP, Energy, damage race…); cards out of play are
// counts per card ("bags"); the options are the legal actions, or the choices of a pending request.
// Never reads the other hand, a deck order or a Prize pile: hidden zones only enter as the combined
// count of what is left (for the opponent: their hand + deck + Prizes), which their list already tells.
import type { EnergyType } from '../../data/cards';
import { legalActions } from '../../engine/actions';
import { applyWR } from '../../engine/combat';
import { CARDS, def, hasRuleBox } from '../../engine/db';
import { attackCost, benchLimit, canPay, energyOf, hpLeft, maxHp, retreatCost } from '../../engine/rules';
import { findSlot, keyOf, opp, topDef, topKey } from '../../engine/state';
import type { Action, ChoiceRequest, GameState, PlayerId, Purpose, Slot } from '../../engine/types';
import { missingFor, roughDamage } from '../knowledge';

/** Card keys known to the network, in a fixed order (index + 1 is the card's number; 0 = none). */
export const CARD_KEYS: readonly string[] = Object.keys(CARDS).sort();

/** Plan names (DeckPlan.name) with a deck feature; other decks get none. */
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

const ENERGY: readonly EnergyType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless'];
const PURPOSES: readonly Purpose[] = [
  'first',
  'mulligan-draw',
  'setup-active',
  'setup-bench',
  'promote',
  'search',
  'take',
  'discard',
  'discard-cost',
  'gust',
  'switch',
  'target',
  'attach',
  'counters',
  'energy',
  'yesno',
  'option',
  'order',
  'attack',
  'bench-trim',
];
const KINDS = ['bench', 'evolve', 'energy', 'tool', 'trainer', 'ability', 'stadium', 'retreat', 'attack', 'end', 'pick', 'stop'] as const;
type Kind = (typeof KINDS)[number];

/** Pokémon tokens: my Active, my Bench (8), their Active, their Bench (8). */
export const SLOTS = 18;
/** Numbers per Pokémon token. */
export const SLOT_F = 44;
/** Bags: my hand, my deck + Prizes, my discard, their hand + deck + Prizes, their discard, the Stadium. */
export const BAGS = 6;
/** Numbers for the whole position. */
export const GLOB_F = 2 + 2 * 19 + 2 * DECK_NAMES.length + PURPOSES.length + 7;
/** Numbers per option. */
export const OPT_F = KINDS.length + 18;
export const VOCAB = CARD_KEYS.length + 1;

const CARD_INDEX = new Map(CARD_KEYS.map((k, i) => [k, i + 1]));
const cardIndex = (k: string | undefined) => (k === undefined ? 0 : (CARD_INDEX.get(k) ?? 0));

/** What an option does when chosen: a main-phase action, a pick (option value) or ending the picks. */
export type OptionRef = { t: 'action'; action: Action } | { t: 'pick'; value: number } | { t: 'stop' };

export interface Encoded {
  /** SLOTS × SLOT_F */
  slots: Float32Array;
  /** SLOTS × 2: top card and Tool (card numbers, 0 = none). */
  slotCards: Int32Array;
  /** BAGS × VOCAB counts. */
  bags: Float32Array;
  glob: Float32Array;
  /** Card whose effect asked (pending choices), 0 otherwise. */
  source: number;
  /** One row per option: OPT_F numbers, the card it plays/picks, and the token it points at (-1 = none). */
  optX: Float32Array;
  optCard: Int32Array;
  optSlot: Int32Array;
  refs: OptionRef[];
}

const clamp = (x: number, hi = 1) => (x < 0 ? 0 : x > hi ? hi : x);

/** Token index of a slot from `me`'s side (-1 if not in play). */
function tokenOf(s: GameState, me: PlayerId, uid: number): number {
  for (const p of [me, opp(me)] as const) {
    const ps = s.players[p];
    const base = p === me ? 0 : 9;
    if (ps.active?.uid === uid) return base;
    const i = ps.bench.findIndex((b) => b.uid === uid);
    if (i >= 0 && i < 8) return base + 1 + i;
  }
  return -1;
}

/** Best damage `user` does to `target` with a payable attack, and how much Energy its cheapest attack lacks. */
function threat(s: GameState, user: Slot, target: Slot | null, owner: PlayerId): { now: number; any: number; missing: number } {
  let now = 0;
  let any = 0;
  let missing = 6;
  const have = energyOf(s, user);
  for (const a of topDef(s, user).attacks) {
    const cost = attackCost(s, user, a);
    const raw = roughDamage(s, user, a);
    const dmg = target ? applyWR(s, user, target, raw, owner) : raw;
    any = Math.max(any, dmg);
    if (canPay(have, cost)) now = Math.max(now, dmg);
    missing = Math.min(missing, missingFor(have, cost));
  }
  return { now, any, missing };
}

function slotRow(s: GameState, sl: Slot, owner: PlayerId, me: PlayerId, active: boolean, out: Float32Array, at: number): void {
  const d = topDef(s, sl);
  const them = s.players[opp(owner)];
  const target = them.active;
  const left = hpLeft(s, sl);
  const t = threat(s, sl, target, owner);
  const theirLeft = target ? hpLeft(s, target) : 0;
  const types = energyOf(s, sl);
  let i = at;
  const put = (v: number) => (out[i++] = v);
  put(1);
  put(active ? 1 : 0);
  put(owner === me ? 1 : 0);
  put(clamp(left / 300, 2));
  put(clamp(sl.damage / 300, 2));
  put(clamp(maxHp(s, sl) / 300, 2));
  put(clamp(left / Math.max(1, maxHp(s, sl))));
  for (const e of ENERGY) put(types.filter((x) => x === e).length / 3);
  put(sl.energy.length / 4);
  put((sl.stack.length - 1) / 2);
  put(sl.enteredTurn === s.turn ? 1 : 0);
  put(sl.evolvedTurn === s.turn ? 1 : 0);
  put(sl.tool !== null ? 1 : 0);
  put(sl.conditions.includes('poisoned') ? 1 : 0);
  put(sl.conditions.includes('confused') ? 1 : 0);
  for (const kind of ['cant-attack', 'cant-use', 'cant-retreat', 'protected'] as const) put(sl.marks.some((m) => m.kind === kind && m.turn >= s.turn) ? 1 : 0);
  put(d.prizes / 3);
  put(retreatCost(s, owner, sl) / 4);
  put(clamp(t.now / 300, 2));
  put(clamp(t.any / 300, 2));
  put(t.missing / 4);
  put(target && t.now >= theirLeft ? 1 : 0);
  put(target ? clamp(t.now / Math.max(1, theirLeft), 2) : 0);
  put(Object.values(sl.usedAbility).some((turn) => turn === s.turn) ? 1 : 0);
  put(hasRuleBox(topKey(s, sl)) ? 1 : 0);
  put(d.tera ? 1 : 0);
  put(d.abilities.length > 0 ? 1 : 0);
  // How hard their Active hits this Pokémon if it is (or becomes) the Active.
  const back = target ? threat(s, target, sl, opp(owner)) : { now: 0, any: 0, missing: 6 };
  put(clamp(back.any / Math.max(1, left), 2));
  put(back.any >= left ? 1 : 0);
  if (i > at + SLOT_F) throw new Error(`slot row has ${i - at} values, SLOT_F is ${SLOT_F}`);
  while (i < at + SLOT_F) put(0);
}

function playerRow(s: GameState, p: PlayerId, out: number[]): void {
  const ps = s.players[p];
  out.push(
    ps.prizes.length / 6,
    ps.deck.length / 60,
    clamp(ps.hand.length / 15, 2),
    ps.discard.length / 60,
    ps.bench.length / 8,
    benchLimit(s, p) / 8,
    ps.supporterPlayed ? 1 : 0,
    ps.energyAttached ? 1 : 0,
    ps.retreated ? 1 : 0,
    ps.stadiumPlayed ? 1 : 0,
    ps.itemLockTurn === s.turn ? 1 : 0,
    ps.buffs.includes('gladion') ? 1 : 0,
    ps.buffs.includes('black-belt') ? 1 : 0,
    ps.buffs.includes('kieran') ? 1 : 0,
    ps.koLastTurn ? 1 : 0,
    ps.koByAttackLastTurn ? 1 : 0,
    ps.koThisTurn ? 1 : 0,
    clamp(ps.namedUsed.length / 4),
    s.stadium?.owner === p ? 1 : 0,
  );
}

export interface EncodeContext {
  /** Plan names [mine, theirs] from the acting player's side. */
  decks: readonly [string, string];
  /** Actions the acting player has taken this turn (loop guard, also a feature). */
  actionsThisTurn?: number;
}

/**
 * The decision in `s` for the player who must act. Pending choices are answered one pick at a time:
 * `picked` holds the picks made so far (options already picked drop out unless the request repeats).
 */
export function encode(s: GameState, ctx: EncodeContext, picked: number[] = []): Encoded {
  const req = s.pending?.request;
  const me: PlayerId = req ? req.player : s.current;
  const them = opp(me);
  const slots = new Float32Array(SLOTS * SLOT_F);
  const slotCards = new Int32Array(SLOTS * 2);
  for (const p of [me, them] as const) {
    const ps = s.players[p];
    const base = p === me ? 0 : 9;
    const list: [Slot, number][] = [];
    if (ps.active) list.push([ps.active, base]);
    ps.bench.slice(0, 8).forEach((b, i) => list.push([b, base + 1 + i]));
    for (const [sl, tok] of list) {
      slotRow(s, sl, p, me, tok === base, slots, tok * SLOT_F);
      slotCards[tok * 2] = cardIndex(topKey(s, sl));
      slotCards[tok * 2 + 1] = sl.tool === null ? 0 : cardIndex(keyOf(s, sl.tool));
    }
  }

  const bags = new Float32Array(BAGS * VOCAB);
  const bag = (b: number, cards: readonly number[]) => {
    for (const c of cards) bags[b * VOCAB + cardIndex(keyOf(s, c))] += 0.25;
  };
  const mine = s.players[me];
  const theirs = s.players[them];
  bag(0, mine.hand);
  bag(1, [...mine.deck, ...mine.prizes]);
  bag(2, mine.discard);
  bag(3, [...theirs.hand, ...theirs.deck, ...theirs.prizes]);
  bag(4, theirs.discard);
  if (s.stadium) bag(5, [s.stadium.card]);

  const g: number[] = [clamp(s.turn / 30, 2), s.current === me ? 1 : 0];
  playerRow(s, me, g);
  playerRow(s, them, g);
  for (const name of ctx.decks) for (const d of DECK_NAMES) g.push(name === d ? 1 : 0);
  for (const pu of PURPOSES) g.push(req?.purpose === pu ? 1 : 0);
  g.push(
    s.first === me ? 1 : 0,
    s.phase === 'setup' ? 1 : 0,
    req ? clamp(req.min / 5) : 0,
    req ? clamp(req.max / 10) : 0,
    clamp(picked.length / 10),
    req?.repeat ? 1 : 0,
    clamp((ctx.actionsThisTurn ?? 0) / 30),
  );
  const glob = Float32Array.from(g);

  const rows = req ? pickOptions(s, me, req, picked) : actionOptions(s, me);
  const optX = new Float32Array(rows.length * OPT_F);
  const optCard = new Int32Array(rows.length);
  const optSlot = new Int32Array(rows.length);
  rows.forEach((r, i) => {
    optX.set(r.x, i * OPT_F);
    optCard[i] = r.card;
    optSlot[i] = r.slot;
  });
  return { slots, slotCards, bags, glob, source: cardIndex(req?.source), optX, optCard, optSlot, refs: rows.map((r) => r.ref) };
}

interface Row {
  x: number[];
  card: number;
  slot: number;
  ref: OptionRef;
}

function row(kind: Kind, card: number, slot: number, ref: OptionRef, extra: number[] = []): Row {
  const x: number[] = KINDS.map((k) => (k === kind ? 1 : 0));
  x.push(...extra);
  while (x.length < OPT_F) x.push(0);
  return { x, card, slot, ref };
}

/** Option numbers after the kind: [mine, theirs, Active, dmg, KO, dmg/HP, cost, borrowed, attack 2nd, energy fills, missing, retreat cost, HP gain, index, times picked, …] */
function actionOptions(s: GameState, me: PlayerId): Row[] {
  const out: Row[] = [];
  const ps = s.players[me];
  const target = s.players[opp(me)].active;
  const tok = (uid: number) => tokenOf(s, me, uid);
  for (const a of legalActions(s)) {
    const ref: OptionRef = { t: 'action', action: a };
    switch (a.t) {
      case 'bench':
        out.push(row('bench', cardIndex(keyOf(s, a.card)), -1, ref));
        break;
      case 'evolve': {
        const sl = findSlot(s, a.target)!.slot;
        const gain = (def(keyOf(s, a.card)) as { hp?: number }).hp ?? 0;
        out.push(row('evolve', cardIndex(keyOf(s, a.card)), tok(a.target), ref, [1, 0, ps.active?.uid === a.target ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, clamp((gain - topDef(s, sl).hp) / 300, 2)]));
        break;
      }
      case 'energy': {
        const sl = findSlot(s, a.target)!.slot;
        const before = threat(s, sl, target, me).missing;
        const have = [...energyOf(s, sl), ...energyTypes(keyOf(s, a.card))];
        let after = 6;
        for (const at of topDef(s, sl).attacks) after = Math.min(after, missingFor(have, attackCost(s, sl, at)));
        out.push(row('energy', cardIndex(keyOf(s, a.card)), tok(a.target), ref, [1, 0, ps.active?.uid === a.target ? 1 : 0, 0, 0, 0, 0, 0, 0, before > 0 && after === 0 ? 1 : 0, after / 4]));
        break;
      }
      case 'tool':
        out.push(row('tool', cardIndex(keyOf(s, a.card)), tok(a.target), ref, [1, 0, ps.active?.uid === a.target ? 1 : 0]));
        break;
      case 'trainer':
        out.push(row('trainer', cardIndex(keyOf(s, a.card)), -1, ref));
        break;
      case 'ability': {
        const sl = findSlot(s, a.slot)!.slot;
        out.push(row('ability', cardIndex(topKey(s, sl)), tok(a.slot), ref, [1, 0, ps.active?.uid === a.slot ? 1 : 0]));
        break;
      }
      case 'stadium':
        out.push(row('stadium', s.stadium ? cardIndex(keyOf(s, s.stadium.card)) : 0, -1, ref));
        break;
      case 'retreat': {
        const sl = findSlot(s, a.to)!.slot;
        out.push(row('retreat', cardIndex(topKey(s, sl)), tok(a.to), ref, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ps.active ? retreatCost(s, me, ps.active) / 4 : 0]));
        break;
      }
      case 'attack': {
        const user = ps.active!;
        const owner = a.from === undefined ? user : findSlot(s, a.from)!.slot;
        const atks = topDef(s, owner).attacks;
        const idx = Math.max(0, atks.findIndex((x) => x.name === a.name));
        const atk = atks[idx]!;
        const raw = roughDamage(s, user, atk);
        const dmg = target ? applyWR(s, user, target, raw, me) : raw;
        const left = target ? hpLeft(s, target) : 1;
        out.push(
          row('attack', cardIndex(topKey(s, owner)), tok(owner.uid), ref, [
            1,
            0,
            1,
            clamp(dmg / 300, 2),
            target && dmg >= left ? 1 : 0,
            clamp(dmg / Math.max(1, left), 2),
            atk.cost.length / 4,
            a.from === undefined ? 0 : 1,
            idx,
          ]),
        );
        break;
      }
      case 'end':
        out.push(row('end', 0, -1, ref));
        break;
    }
  }
  return out;
}

function energyTypes(k: string): EnergyType[] {
  const d = def(k);
  if (d.category !== 'energy') return [];
  return [d.provides ?? 'Colorless'];
}

function pickOptions(s: GameState, me: PlayerId, req: ChoiceRequest, picked: number[]): Row[] {
  const out: Row[] = [];
  const max = req.repeat ? req.max : Math.min(req.max, req.options.length);
  const min = Math.min(req.min, max);
  if (picked.length < max) {
    req.options.forEach((o, i) => {
      const times = picked.filter((v) => v === o.value).length;
      if (times > 0 && !req.repeat) return;
      const ref: OptionRef = { t: 'pick', value: o.value };
      const extra = (slot: Slot | undefined) => {
        const owner = slot ? (s.cards[slot.stack[0]!]!.owner as PlayerId) : me;
        return [
          slot ? (owner === me ? 1 : 0) : 0,
          slot ? (owner === me ? 0 : 1) : 0,
          slot && s.players[owner].active?.uid === slot.uid ? 1 : 0,
          0,
          slot ? (hpLeft(s, slot) <= 10 * (times + 1) ? 1 : 0) : 0,
          slot ? clamp(hpLeft(s, slot) / 300, 2) : 0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          clamp(i / 10),
          clamp(times / 5),
        ];
      };
      if (o.slot !== undefined) {
        const sl = findSlot(s, o.slot)?.slot;
        out.push(row('pick', sl ? cardIndex(topKey(s, sl)) : 0, sl ? tokenOf(s, me, sl.uid) : -1, ref, extra(sl)));
      } else if (o.card !== undefined) {
        out.push(row('pick', cardIndex(keyOf(s, o.card)), -1, ref, extra(undefined)));
      } else {
        out.push(row('pick', 0, -1, ref, [...extra(undefined).slice(0, 13), clamp(o.value / 10), 0]));
      }
    });
  }
  if (picked.length >= min || out.length === 0) out.push(row('stop', 0, -1, { t: 'stop' }));
  return out;
}

