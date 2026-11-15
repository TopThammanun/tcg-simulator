import type { PokemonCard } from '../data/cards';
import { def, pokemon } from './db';
import { derive } from './rng';
import type { CardId, CardInst, DeckSpec, GameState, PlayerId, PlayerState, Rules, Slot, SlotId } from './types';

export const opp = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export const DEFAULT_RULES: Rules = { twinShotelsPiercesBenchShields: false };

export function keyOf(s: GameState, card: CardId): string {
  return s.cards[card]!.key;
}

export function nameOf(s: GameState, card: CardId): string {
  return def(keyOf(s, card)).name;
}

export function topCard(slot: Slot): CardId {
  return slot.stack[slot.stack.length - 1]!;
}

export function topKey(s: GameState, slot: Slot): string {
  return keyOf(s, topCard(slot));
}

export function topDef(s: GameState, slot: Slot): PokemonCard {
  return pokemon(topKey(s, slot));
}

export function slotsOf(ps: PlayerState): Slot[] {
  return ps.active ? [ps.active, ...ps.bench] : ps.bench.slice();
}

export function findSlot(
  s: GameState,
  uid: SlotId,
): { p: PlayerId; slot: Slot; active: boolean } | undefined {
  for (const p of [0, 1] as const) {
    const ps = s.players[p];
    if (ps.active?.uid === uid) return { p, slot: ps.active, active: true };
    const b = ps.bench.find((x) => x.uid === uid);
    if (b) return { p, slot: b, active: false };
  }
  return undefined;
}

export function mustSlot(s: GameState, uid: SlotId) {
  const f = findSlot(s, uid);
  if (!f) throw new Error(`no Pokémon in play with slot ${uid}`);
  return f;
}

export function prizesTaken(s: GameState, p: PlayerId): number {
  return 6 - s.players[p].prizes.length;
}

function emptyPlayer(deck: CardId[]): PlayerState {
  return {
    deck,
    hand: [],
    discard: [],
    prizes: [],
    active: null,
    bench: [],
    supporterPlayed: false,
    energyAttached: false,
    retreated: false,
    stadiumPlayed: false,
    namedUsed: [],
    buffs: [],
    itemLockTurn: -1,
    koLastTurn: false,
    koByAttackLastTurn: false,
    koThisTurn: false,
    koByAttackThisTurn: false,
    mulligans: 0,
  };
}

/** A new game before setup; pass it to apply(state, { t: 'setup' }) (see createGame in actions.ts). */
export function newState(opts: {
  seed: number;
  decks: [DeckSpec, DeckSpec];
  names?: [string, string];
  rules?: Partial<Rules>;
}): GameState {
  const cards: CardInst[] = [];
  const decks: [CardId[], CardId[]] = [[], []];
  for (const p of [0, 1] as const) {
    for (const key of opts.decks[p].cards) {
      def(key); // fail early on unknown cards
      const id = cards.length;
      cards.push({ id, key, owner: p });
      decks[p].push(id);
    }
  }
  return {
    seed: opts.seed,
    turn: 0,
    current: 0,
    first: 0,
    phase: 'setup',
    players: [emptyPlayer(decks[0]), emptyPlayer(decks[1])],
    stadium: null,
    cards,
    rng: { shuffle: [derive(opts.seed, 0), derive(opts.seed, 1)], coin: derive(opts.seed, 2) },
    nextUid: 1,
    pending: null,
    winner: null,
    winReason: '',
    log: [],
    quiet: false,
    steps: 0,
    rules: { ...DEFAULT_RULES, ...opts.rules },
    names: opts.names ?? [opts.decks[0].name, opts.decks[1].name],
  };
}

export function cloneSlot(sl: Slot): Slot {
  return {
    ...sl,
    stack: sl.stack.slice(),
    energy: sl.energy.slice(),
    conditions: sl.conditions.slice(),
    marks: sl.marks.slice(),
    usedAbility: { ...sl.usedAbility },
  };
}

function clonePlayer(ps: PlayerState): PlayerState {
  return {
    ...ps,
    deck: ps.deck.slice(),
    hand: ps.hand.slice(),
    discard: ps.discard.slice(),
    prizes: ps.prizes.slice(),
    active: ps.active && cloneSlot(ps.active),
    bench: ps.bench.map(cloneSlot),
    namedUsed: ps.namedUsed.slice(),
    buffs: ps.buffs.slice(),
  };
}

/** Deep copy of everything an action may change. `cards`, `rules`, `pending` and `log` are shared (never mutated in place). */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
    stadium: s.stadium && { ...s.stadium },
    rng: { shuffle: [s.rng.shuffle[0], s.rng.shuffle[1]], coin: s.rng.coin },
  };
}
