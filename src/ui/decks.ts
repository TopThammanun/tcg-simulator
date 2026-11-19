// Decks on the play screen: the meta decks (src/content/decks, the bots' lists) and your own lists
// (my-decks.ts). Plain functions of card keys, shared by the play setup and the decks page.
import { def, hasRuleBox } from '../engine/db';

export interface MetaDeck {
  slug: string;
  name: string;
  rank?: number;
  metaShare?: number;
  /** The archetype on Limitless; lists of one archetype (Festival Lead) share it. */
  archetype: string;
  cards: string[];
}

/** The deck's headline Pokémon, up to `n`: the one it is named after, then rule-box Pokémon, then most copies. */
export function headline(cards: string[], name: string, n = 3): string[] {
  const counts = new Map<string, number>();
  for (const k of cards) if (def(k).category === 'pokemon') counts.set(k, (counts.get(k) ?? 0) + 1);
  const score = (k: string) =>
    (name.includes(def(k).name.replace(/^Mega | ex$/g, '')) ? 1000 : 0) + (hasRuleBox(k) ? 100 : 0) + counts.get(k)!;
  return [...counts.keys()].sort((a, b) => score(b) - score(a) || a.localeCompare(b)).slice(0, n);
}

/** The meta deck sharing the most cards with `cards`: its plan plays your own list. */
export function nearestDeck<T extends { cards: string[] }>(cards: string[], decks: T[]): T {
  const have = new Map<string, number>();
  for (const k of cards) have.set(k, (have.get(k) ?? 0) + 1);
  let best = decks[0]!;
  let bestN = -1;
  for (const d of decks) {
    const left = new Map(have);
    let n = 0;
    for (const k of d.cards) {
      const c = left.get(k) ?? 0;
      if (c > 0) {
        n++;
        left.set(k, c - 1);
      }
    }
    if (n > bestN) [best, bestN] = [d, n];
  }
  return best;
}

/**
 * An opponent by meta share: an archetype by its share, then one of its lists. `r1`, `r2` in [0, 1).
 * An archetype with two lists counts once.
 */
export function pickOpponent<T extends Pick<MetaDeck, 'archetype' | 'metaShare'>>(decks: T[], r1: number, r2: number): T {
  const groups = new Map<string, T[]>();
  for (const d of decks) groups.set(d.archetype, [...(groups.get(d.archetype) ?? []), d]);
  const list = [...groups.values()];
  const share = (g: T[]) => g[0]!.metaShare ?? 0;
  let x = r1 * list.reduce((n, g) => n + share(g), 0);
  let pick = list[list.length - 1]!;
  for (const g of list) {
    x -= share(g);
    if (x <= 0) {
      pick = g;
      break;
    }
  }
  return pick[Math.min(pick.length - 1, Math.floor(r2 * pick.length))]!;
}
