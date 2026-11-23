// What happened between two states, as the play screen animates it: cards moving between zones, the
// attack, coins, damage, Knock Outs, shuffles, the next turn, the end of the game. Read from the states
// (and the new log lines), so it covers every card effect without knowing about them.
// Only what the viewer may see is named: cards in a deck, a Prize pile or the other hand stay face down,
// and so do the other side's Pokémon while setup is still going.
import { def } from '../../engine/db';
import { knockedOut, maxHp } from '../../engine/rules';
import { slotsOf, topDef, topKey } from '../../engine/state';
import type { Action, CardId, GameState, PlayerId, Slot, SlotId } from '../../engine/types';

export type Place =
  | { zone: 'deck' | 'hand' | 'discard' | 'prizes' | 'stadium'; player: PlayerId }
  | { zone: 'pokemon' | 'energy' | 'tool'; player: PlayerId; uid: SlotId };

/** Played in this order; events in one phase play together. */
export const PHASES = ['play', 'act', 'coin', 'hit', 'ko', 'move', 'turn', 'end'] as const;
export type Phase = (typeof PHASES)[number];

export type AnimEvent = { phase: Phase } & (
  | {
      t: 'move';
      card: CardId;
      /** null when the card is face down the whole way. */
      key: string | null;
      from: Place;
      to: Place;
      /** Face up at the start / at the end. */
      faceUp: [boolean, boolean];
      /** A Trainer played from the hand: shown in the middle of the table on its way to the discard pile. */
      stage?: boolean;
    }
  | { t: 'evolve'; player: PlayerId; uid: SlotId }
  | { t: 'shuffle'; player: PlayerId }
  | { t: 'coin'; heads: boolean }
  | { t: 'attack'; player: PlayerId; uid: SlotId; name: string; type: string }
  | { t: 'ability'; player: PlayerId; uid: SlotId; name: string }
  /** amount < 0 is healing. */
  | { t: 'damage'; player: PlayerId; uid: SlotId; amount: number }
  | { t: 'condition'; player: PlayerId; uid: SlotId; condition: string }
  | { t: 'ko'; player: PlayerId; uid: SlotId; key: string }
  | { t: 'reveal' }
  | { t: 'turn'; turn: number; player: PlayerId }
  | { t: 'over'; winner: PlayerId | 'draw'; reason: string }
);

/** Where every card is. */
export function locate(s: GameState): Map<CardId, Place> {
  const at = new Map<CardId, Place>();
  for (const player of [0, 1] as const) {
    const ps = s.players[player];
    for (const zone of ['deck', 'hand', 'discard', 'prizes'] as const) for (const c of ps[zone]) at.set(c, { zone, player });
    for (const sl of slotsOf(ps)) {
      for (const c of sl.stack) at.set(c, { zone: 'pokemon', player, uid: sl.uid });
      for (const c of sl.energy) at.set(c, { zone: 'energy', player, uid: sl.uid });
      if (sl.tool !== null) at.set(sl.tool, { zone: 'tool', player, uid: sl.uid });
    }
  }
  if (s.stadium) at.set(s.stadium.card, { zone: 'stadium', player: s.stadium.owner });
  return at;
}

const samePlace = (a: Place, b: Place) =>
  a.zone === b.zone && a.player === b.player && ('uid' in a ? a.uid : -1) === ('uid' in b ? b.uid : -1);

function slotMap(s: GameState): Map<SlotId, { player: PlayerId; slot: Slot }> {
  const m = new Map<SlotId, { player: PlayerId; slot: Slot }>();
  for (const player of [0, 1] as const) for (const slot of slotsOf(s.players[player])) m.set(slot.uid, { player, slot });
  return m;
}

// The engine's log lines it reads, in either language (src/engine/ctx.ts, effects/common.ts, combat.ts).
const COIN = /^(?:โยนเหรียญ: (หัว|ก้อย)|Coin flip: (heads|tails))$/;
/** A hand shuffled into the deck (engine/effects/common.ts shuffleHandIn), by the log entry's player. */
const HAND_IN = / (?:สับการ์ดในมือ \d+ ใบเข้าเด็ค|shuffles? \d+ cards? from hand into the deck)$/;

/**
 * Events from `prev` to `next` for `viewer`. `action` is the action applied to `prev` (a `choose`
 * continues the pending action). Without `prev` (a new game) only the coin flips in the log are shown.
 */
export function animEvents(prev: GameState | null, next: GameState, action?: Action, viewer: PlayerId = 0): AnimEvent[] {
  const out: AnimEvent[] = [];
  const lines = next.log.slice(prev?.log.length ?? 0).map((l) => l.text);
  const coins = (): AnimEvent[] =>
    lines.flatMap((text) => {
      const m = text.match(COIN);
      return m ? [{ t: 'coin', heads: m[1] === 'หัว' || m[2] === 'heads', phase: 'coin' } as const] : [];
    });
  if (!prev) return coins();

  const act = action?.t === 'choose' ? prev.pending?.action : action;
  const inSetup = prev.phase === 'setup' || next.phase === 'setup';
  const seen = (pl: Place) => {
    if (pl.zone === 'deck' || pl.zone === 'prizes') return false;
    if (pl.zone === 'hand') return pl.player === viewer;
    if (pl.zone === 'pokemon' || pl.zone === 'energy' || pl.zone === 'tool') return pl.player === viewer || !inSetup;
    return true;
  };
  const turnChanged = next.phase === 'main' && next.turn !== prev.turn;

  // Pokémon: damage, healing, new conditions, Knock Outs.
  const before = slotMap(prev);
  const after = slotMap(next);
  const at = locate(next);
  const kos = knockedOut(prev, next);
  const knocked = new Set<SlotId>();
  for (const [uid, { player, slot }] of before) {
    const now = after.get(uid);
    if (now) {
      const d = now.slot.damage - slot.damage;
      if (d !== 0) out.push({ t: 'damage', player, uid, amount: d, phase: 'hit' });
      for (const c of now.slot.conditions) {
        if (!slot.conditions.includes(c)) out.push({ t: 'condition', player, uid, condition: c, phase: 'hit' });
      }
      continue;
    }
    const top = slot.stack[slot.stack.length - 1]!;
    if (at.get(top)?.zone !== 'discard') continue;
    // Discarded without a Knock Out (a Bench over its limit): its cards just move to the discard pile.
    if (kos && !kos.has(uid)) continue;
    knocked.add(uid);
    const name = topDef(prev, slot).name;
    const hit = [`${name} โดน `, `${name} takes `];
    const hitLine = lines.findLast((l) => hit.some((h) => l.startsWith(h)));
    const dealt = hitLine ? Number(hitLine.slice(hit.find((h) => hitLine.startsWith(h))!.length)) : NaN;
    const amount = Number.isFinite(dealt) && dealt > 0 ? dealt : maxHp(prev, slot) - slot.damage;
    if (amount > 0) out.push({ t: 'damage', player, uid, amount, phase: 'hit' });
    out.push({ t: 'ko', player, uid, key: topKey(prev, slot), phase: 'ko' });
  }

  // The attack or Ability, when its line is written.
  if (act?.t === 'attack' && lines.some((l) => (l.endsWith(`ใช้ ${act.name}`) || l.endsWith(` uses ${act.name}`)) && l.includes(': '))) {
    const player = prev.current;
    const user = act.from !== undefined ? before.get(act.from)?.slot : prev.players[player].active;
    if (user) {
      const d = def(topKey(prev, user));
      const type = (d.category === 'pokemon' && d.types[0]) || 'Colorless';
      out.push({ t: 'attack', player, uid: user.uid, name: act.name, type, phase: 'act' });
    }
  }
  if (act?.t === 'ability' && lines.some((l) => l.includes(`Ability ${act.name}`))) {
    const owner = before.get(act.slot);
    if (owner) out.push({ t: 'ability', player: owner.player, uid: act.slot, name: act.name, phase: 'act' });
  }
  out.push(...coins());

  // Cards that changed place.
  const from = locate(prev);
  const played = act && 'card' in act ? act.card : null;
  const away: AnimEvent[] = [];
  const rest: AnimEvent[] = [];
  for (const [card, a] of from) {
    const b = at.get(card);
    if (!b || samePlace(a, b)) continue;
    const faceUp: [boolean, boolean] = [seen(a), seen(b)];
    const key = faceUp[0] || faceUp[1] ? next.cards[card]!.key : null;
    const move = { t: 'move' as const, card, key, from: a, to: b, faceUp };
    if ('uid' in a && knocked.has(a.uid) && b.zone === 'discard') out.push({ ...move, phase: 'ko' });
    else if (card === played && a.zone === 'hand') {
      const stage = act!.t === 'trainer' && b.zone === 'discard';
      out.push(stage ? { ...move, stage, phase: 'play' } : { ...move, phase: 'play' });
    } else if (turnChanged && a.zone === 'deck' && b.zone === 'hand' && b.player === next.current) {
      rest.push({ ...move, phase: 'turn' });
    } else if (b.zone === 'deck' || b.zone === 'discard') away.push({ ...move, phase: 'move' });
    else rest.push({ ...move, phase: 'move' });
    if (b.zone === 'pokemon' && before.has(b.uid) && a.zone !== 'pokemon') {
      out.push({ t: 'evolve', player: b.player, uid: b.uid, phase: card === played ? 'play' : 'move' });
    }
  }
  // A hand shuffled into the deck (Judge, Lillie's Determination…): every card goes in, also the ones drawn straight
  // back; read from the states alone those never left the hand and would stay put on the table.
  const handIn = new Set(next.log.slice(prev.log.length).filter((l) => l.player !== null && HAND_IN.test(l.text)).map((l) => l.player!));
  for (const p of handIn) {
    for (const card of prev.players[p].hand) {
      const a = from.get(card)!;
      const b = at.get(card);
      if (card === played || !b || !samePlace(a, b)) continue;
      const deck: Place = { zone: 'deck', player: p };
      const key = seen(a) ? next.cards[card]!.key : null;
      away.push({ t: 'move', card, key, from: a, to: deck, faceUp: [seen(a), false], phase: 'move' });
      rest.push({ t: 'move', card, key, from: deck, to: b, faceUp: [false, seen(b)], phase: 'move' });
    }
  }
  // Cards leave first, then the deck shuffles, then cards come out.
  out.push(...away);
  for (const p of [0, 1] as const) {
    if (next.rng.shuffle[p] !== prev.rng.shuffle[p]) out.push({ t: 'shuffle', player: p, phase: 'move' });
  }
  if (prev.phase === 'setup' && next.phase !== 'setup') out.push({ t: 'reveal', phase: 'turn' });
  if (turnChanged) out.push({ t: 'turn', turn: next.turn, player: next.current, phase: 'turn' });
  out.push(...rest);
  if (prev.winner === null && next.winner !== null) out.push({ t: 'over', winner: next.winner, reason: next.winReason, phase: 'end' });

  const rank = (e: AnimEvent) => PHASES.indexOf(e.phase);
  return out.map((e, i) => [e, i] as const).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([e]) => e);
}
