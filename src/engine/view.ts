// What a player is allowed to know. The UI renders viewFor(); bots plan on determinize(), which
// re-deals every card the player can't see (and reseeds the RNG), so look-ahead can't peek.
import { derive, shuffleInPlace } from './rng';
import { cloneState, opp } from './state';
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
    if (p !== viewer) ps.hand = hide(ps.hand);
    // Setup Pokémon are placed face down until both players are done.
    if (p !== viewer && v.phase === 'setup') {
      ps.active = null;
      ps.bench = [];
    }
  }
  if (v.pending && v.pending.request.secret && v.pending.request.player !== viewer) {
    v.pending = { ...v.pending, request: { ...v.pending.request, options: [] } };
  }
  return v;
}

/**
 * A full game state consistent with what `viewer` knows: viewer's deck and prizes are re-shuffled
 * together, the opponent's hand, deck and prizes are re-dealt, and coin flips/shuffles are reseeded.
 * Two states that differ only in where the hidden cards are give the same result for the same seed.
 */
export function determinize(s: GameState, viewer: PlayerId, seed: number): GameState {
  if (s.pending) throw new Error('determinize a state without a pending choice');
  const d = cloneState(s);
  let r = derive(seed, 7);
  const redeal = (zones: CardId[][]) => {
    // Sorted first, so the deal depends only on which cards are hidden, not on where they really are.
    const pool = zones.flat().sort((a, b) => a - b);
    r = shuffleInPlace(pool, r);
    let i = 0;
    for (const z of zones) for (let j = 0; j < z.length; j++) z[j] = pool[i++]!;
  };
  const me = d.players[viewer];
  const them = d.players[opp(viewer)];
  redeal([me.deck, me.prizes]);
  redeal([them.hand, them.deck, them.prizes]);
  d.rng = { shuffle: [derive(seed, 11), derive(seed, 12)], coin: derive(seed, 13) };
  d.quiet = true;
  return d;
}
