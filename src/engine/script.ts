// A real game's deal (BOT-PRO.md). A transcribed game has no seed: the state keeps a DealScript (types.ts), the order of
// each deck after each shuffle and every coin flip, recorded as the seeded RNG made them while transcribing (ctx.ts)
// and replayed afterwards. The cards the transcript never saw are stand-ins: nameCard() turns a stand-in into the card
// seen by trading identities with an unseen copy in a hidden zone, which changes nothing already seen; redealUnknown()
// deals the never-seen cards again, for measuring the bot against the transcript on what the player could not know.
import { isBasicPokemon } from './db';
import { derive, shuffleInPlace } from './rng';
import { cloneState, keyOf } from './state';
import type { CardId, DealScript, GameState, PlayerId } from './types';

/** A script with nothing recorded yet: the game ahead is transcribed. */
export const emptyScript = (): DealScript => ({ orders: [[], []], coins: [], known: [], record: true });

/** `order` as the deck, once it lists exactly the cards the deck holds. */
export function orderDeck(deck: readonly CardId[], order: readonly CardId[], p: PlayerId, k: number): CardId[] {
  const a = [...deck].sort((x, y) => x - y);
  const b = [...order].sort((x, y) => x - y);
  if (a.length !== b.length || a.some((c, i) => c !== b[i])) throw new Error(`script: shuffle ${k} of player ${p} lists other cards than the deck holds`);
  return [...order];
}

/** The script with p's k-th shuffle recorded (it must be the next one). */
export function withOrder(sc: DealScript, p: PlayerId, k: number, order: CardId[]): DealScript {
  if (k !== sc.orders[p].length) throw new Error(`script: shuffle ${k} of player ${p} recorded out of order`);
  const orders: DealScript['orders'] = [sc.orders[0], sc.orders[1]];
  orders[p] = [...sc.orders[p], order];
  return { ...sc, orders };
}

/** Setup, transcribing: p's top 7 without a Basic (a mulligan the real game had) or with one (its last deal). */
export function forceMulligan(s: GameState, p: PlayerId, mulligan: boolean): void {
  const deck = s.players[p].deck;
  const basic = (c: CardId) => isBasicPokemon(keyOf(s, c));
  if (mulligan) {
    for (let i = 0; i < 7 && i < deck.length; i++) {
      if (!basic(deck[i]!)) continue;
      const j = deck.findIndex((c, at) => at >= 7 && !basic(c));
      if (j < 0) return;
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
  } else if (!deck.slice(0, 7).some(basic)) {
    const j = deck.findIndex((c, at) => at >= 7 && basic(c));
    if (j >= 0) [deck[0], deck[j]] = [deck[j]!, deck[0]!];
  }
}

/** The recorded setup deals stay what the real game had: no Basic in the top 7 of a mulligan's deal, one in the last. */
function setupConsistent(s: GameState, orders: DealScript['orders'], p: PlayerId): boolean {
  const m = s.script?.mulligans?.[p] ?? 0;
  const basic = (c: CardId) => isBasicPokemon(keyOf(s, c));
  for (let k = 0; k <= m && k < orders[p].length; k++) {
    const some = orders[p][k]!.slice(0, 7).some(basic);
    if (k < m ? some : !some) return false;
  }
  return true;
}

/**
 * The stand-in `card` (one the transcript had not seen, wherever the engine has moved it: a hidden zone, in play after
 * a forced choice, the discard pile) is the `key` seen: it trades places with an unseen copy of `key` in one of its
 * owner's hidden zones, in every zone and every recorded order, so nothing already seen changes, and that copy becomes
 * known. Naming a card as what it already is only marks it known. Not with a choice pending: name on the position the
 * action started from (pending.base) and run the action again, which checks the game still goes the same way.
 */
export function nameCard(s: GameState, card: CardId, key: string): GameState {
  if (s.pending) throw new Error('nameCard: answer or drop the pending choice first');
  const sc = s.script;
  if (!sc) throw new Error('nameCard: not a transcribed game');
  if (sc.known.includes(card)) throw new Error(`nameCard: card ${card} is already known to be ${keyOf(s, card)}`);
  const p = s.cards[card]!.owner;
  const d = cloneState(s);
  if (keyOf(s, card) === key) {
    d.script = { ...sc, known: [...sc.known, card] };
    return d;
  }
  const ps = d.players[p];
  const copies = [...ps.deck, ...ps.prizes, ...ps.hand].filter((c) => c !== card && keyOf(s, c) === key && !sc.known.includes(c));
  for (const other of copies) {
    const swap = (c: CardId) => (c === card ? other : c === other ? card : c);
    const orders: DealScript['orders'] = [sc.orders[0], sc.orders[1]];
    orders[p] = sc.orders[p].map((o) => o.map(swap));
    if (!setupConsistent(d, orders, p)) continue;
    for (const zone of [ps.deck, ps.hand, ps.prizes, ps.discard, ps.knownTop]) for (let i = 0; i < zone.length; i++) zone[i] = swap(zone[i]!);
    for (const slot of ps.active ? [ps.active, ...ps.bench] : ps.bench) {
      slot.stack = slot.stack.map(swap);
      slot.energy = slot.energy.map(swap);
      if (slot.tool !== null) slot.tool = swap(slot.tool);
    }
    if (d.stadium && d.stadium.owner === p) d.stadium = { ...d.stadium, card: swap(d.stadium.card) };
    if (ps.revealed) ps.revealed = ps.revealed.map(swap);
    if (ps.played) ps.played = ps.played.map(swap);
    if (ps.lastPlayed) ps.lastPlayed = ps.lastPlayed.map(swap);
    d.script = { ...sc, orders, known: [...sc.known, other] };
    return d;
  }
  throw new Error(copies.length ? `nameCard: no unseen copy of ${key} can be card ${card} without changing the setup` : `nameCard: no unseen copy of ${key} is left in a hidden zone`);
}

/** p's stand-ins by where the engine has put them: the hand, in play (a forced choice put them there), the discard pile. */
export function standInsOf(s: GameState, p: PlayerId): { hand: CardId[]; play: CardId[]; discard: CardId[] } {
  const known = s.script?.known;
  if (!known) return { hand: [], play: [], discard: [] };
  const unseen = (c: CardId) => !known.includes(c);
  const ps = s.players[p];
  const slots = ps.active ? [ps.active, ...ps.bench] : ps.bench;
  const play = slots.flatMap((sl) => [...sl.stack, ...sl.energy, ...(sl.tool !== null ? [sl.tool] : [])]).filter(unseen);
  if (s.stadium && s.stadium.owner === p && unseen(s.stadium.card)) play.push(s.stadium.card);
  return { hand: ps.hand.filter(unseen), play, discard: ps.discard.filter(unseen) };
}

/** p's cards the transcript never saw (stand-ins), in a transcribed game; none otherwise. */
export function unknownCards(s: GameState, p: PlayerId): CardId[] {
  const known = s.script?.known;
  if (!known) return [];
  return s.cards.filter((c) => c.owner === p && !known.includes(c.id)).map((c) => c.id);
}

/**
 * The never-seen cards dealt again among the hidden places they hold (each player's deck, hand and Prize cards): one
 * way the game could really have stood, for playing on or judging a move. A hypothetical, so it carries no script.
 */
export function redealUnknown(s: GameState, seed: number): GameState {
  if (s.pending) throw new Error('redealUnknown a state without a pending choice');
  const d = cloneState(s);
  let r = derive(seed, 41);
  for (const p of [0, 1] as const) {
    const unknown = new Set(unknownCards(s, p));
    const ps = d.players[p];
    const slots: [CardId[], number][] = [];
    for (const zone of [ps.deck, ps.hand, ps.prizes]) for (let i = 0; i < zone.length; i++) if (unknown.has(zone[i]!)) slots.push([zone, i]);
    // Sorted first, so the deal depends only on which cards are unknown, not on where they stood.
    const pool = slots.map(([zone, i]) => zone[i]!).sort((a, b) => a - b);
    r = shuffleInPlace(pool, r);
    slots.forEach(([zone, i], j) => (zone[i] = pool[j]!));
  }
  d.rng = { shuffle: [derive(seed, 42), derive(seed, 43)], coin: derive(seed, 44) };
  delete d.script;
  delete d.scriptPos;
  return d;
}
