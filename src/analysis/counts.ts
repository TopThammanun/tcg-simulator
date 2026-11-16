// Card counting: the opponent's Trainer cards by their archetype's reference list (the list on /decks, the
// one a prepared player knows), against what you have seen of them: their discard pile, their Pokémon in
// play and the Stadium they put down. The rest is in their hand, deck or Prizes.
import { def } from '../engine/db';
import { keyOf, slotsOf } from '../engine/state';
import type { CardId, GameState, PlayerId } from '../engine/types';

export interface CardCount {
  key: string;
  name: string;
  trainerType: string;
  /** Copies in the reference list. */
  total: number;
  /** Copies you have seen (discard, in play). */
  seen: number;
}

const ORDER = ['Supporter', 'Item', 'Tool', 'Stadium'];

/** Cards of `owner` you can see: discard pile, everything on their Pokémon, their Stadium. */
export function seenCards(s: GameState, owner: PlayerId): CardId[] {
  const ps = s.players[owner];
  const out = [...ps.discard];
  for (const sl of slotsOf(ps)) {
    out.push(...sl.stack, ...sl.energy);
    if (sl.tool !== null) out.push(sl.tool);
  }
  if (s.stadium && s.stadium.owner === owner) out.push(s.stadium.card);
  return out;
}

/** The Trainer cards of `list` (card keys, one per card), Supporters first, with how many of each `owner` has shown. */
export function trainerCounts(s: GameState, owner: PlayerId, list: readonly string[]): CardCount[] {
  const total = new Map<string, number>();
  for (const k of list) {
    if (def(k).category === 'trainer') total.set(k, (total.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const c of seenCards(s, owner)) {
    const k = keyOf(s, c);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...total.entries()]
    .map(([key, n]) => {
      const d = def(key) as { name: string; trainerType?: string };
      return { key, name: d.name, trainerType: d.trainerType ?? '', total: n, seen: Math.min(n, seen.get(key) ?? 0) };
    })
    .sort((a, b) => ORDER.indexOf(a.trainerType) - ORDER.indexOf(b.trainerType) || a.name.localeCompare(b.name));
}
