// What a player is allowed to know. The UI renders viewFor(); bots plan on determinize(), which
// re-deals every card the player can't see (and reseeds the RNG), so look-ahead can't peek.
import { derive, shuffleInPlace } from './rng';
import { cloneState, knownTopCards, opp, revealedHand } from './state';
import type { CardId, GameState, PlayerId } from './types';

export const HIDDEN = -1;

/** A copy with hidden cards replaced by HIDDEN: the opponent's hand, both decks and both prize piles. */
export function viewFor(s: GameState, viewer: PlayerId): GameState {
  const v = cloneState(s);
  const hide = (xs: CardId[]) => xs.map(() => HIDDEN);
  for (const p of [0, 1] as const) {
    const ps = v.players[p];
    ps.deck = hide(ps.deck);
    ps.prizes = hide(ps.prizes);
    if (p !== viewer) {
      ps.hand = hide(ps.hand);
      ps.knownTop = [];
    }
    // Setup Pokémon are placed face down until both players are done.
    if (p !== viewer && v.phase === 'setup') {
      ps.active = null;
      ps.bench = [];
    }
  }
  if (v.pending && v.pending.request.secret && v.pending.request.player !== viewer) {
    v.pending = { ...v.pending, request: { ...v.pending.request, options: [], view: undefined } };
  }
  return v;
}

/**
 * A full game state consistent with what `viewer` knows: viewer's deck and prizes are re-shuffled
 * together (except the cards the viewer knows are on top of the deck, which stay there, and the Prize cards
 * when the viewer has looked through the deck since they were set), the opponent's hand, deck and prizes are
 * re-dealt (except the cards of their hand the viewer saw go there), and coin flips/shuffles are reseeded.
 * Two states that differ only in where the hidden cards are give the same result for the same seed.
 */
export function determinize(s: GameState, viewer: PlayerId, seed: number): GameState {
  if (s.pending) throw new Error('determinize a state without a pending choice');
  const d = cloneState(s);
  let r = derive(seed, 7);
  const me = d.players[viewer];
  const them = d.players[opp(viewer)];
  const known = knownTopCards(me);
  const rest = me.deck.slice(known.length);
  r = redealZones(me.prizesKnown ? [rest] : [rest, me.prizes], r);
  me.deck = [...known, ...rest];
  me.knownTop = known;
  const seen = revealedHand(them);
  const hidden = them.hand.filter((c) => !seen.includes(c));
  redealZones([hidden, them.deck, them.prizes], r);
  them.hand = [...seen, ...hidden];
  them.knownTop = [];
  d.rng = { shuffle: [derive(seed, 11), derive(seed, 12)], coin: derive(seed, 13) };
  d.quiet = true;
  // Bots look ahead taking Prize cards in order (a pick by position changes nothing they can know).
  if (d.rules.pickPrizes) d.rules = { ...d.rules, pickPrizes: false };
  return d;
}

/**
 * The real game dealt again when a saved game is picked up ("play on from here"), so going back never shows the cards
 * still to come: `viewer`'s deck and prizes, and the opponent's hand, deck and prizes, are re-dealt and the
 * RNG reseeded. Cards a player knows are on top of their own deck stay there, as do the viewer's Prize cards once
 * known and the cards of the opponent's hand the viewer saw go there; the game goes on logging.
 */
export function redeal(s: GameState, viewer: PlayerId, seed: number): GameState {
  if (s.pending) throw new Error('redeal a state without a pending choice');
  const d = cloneState(s);
  let r = derive(seed, 17);
  for (const p of [viewer, opp(viewer)]) {
    const ps = d.players[p];
    const known = knownTopCards(ps);
    const rest = ps.deck.slice(known.length);
    if (p === viewer) r = redealZones(ps.prizesKnown ? [rest] : [rest, ps.prizes], r);
    else {
      const seen = revealedHand(ps);
      const hidden = ps.hand.filter((c) => !seen.includes(c));
      r = redealZones([hidden, rest, ps.prizes], r);
      ps.hand = [...seen, ...hidden];
      // Their Prize cards are new to them.
      ps.prizesKnown = false;
    }
    ps.deck = [...known, ...rest];
  }
  d.rng = { shuffle: [derive(seed, 21), derive(seed, 22)], coin: derive(seed, 23) };
  return d;
}

/** Shuffle the cards of `zones` among them in place, keeping each zone's size; returns the RNG state after. */
function redealZones(zones: CardId[][], r: number): number {
  // Sorted first, so the deal depends only on which cards are hidden, not on where they really are.
  const pool = zones.flat().sort((a, b) => a - b);
  r = shuffleInPlace(pool, r);
  let i = 0;
  for (const z of zones) for (let j = 0; j < z.length; j++) z[j] = pool[i++]!;
  return r;
}
