import type { CardDef, CardImage, CardManifest, CardPrint } from '../../src/data/cards';
import { printKey, type DeckEntry } from '../../src/data/decklist';
import { cardSlug, gameplaySignature, sameCardName, type NormalizedCard } from './normalize';

export interface ResolvedPrint {
  key: string;
  set: string;
  number: string;
  name: string;
  card: NormalizedCard;
  image: CardImage;
  tcgdexId?: string;
  ptcgioId?: string;
}

export function indexSetsByCode(sets: { id: string; code: string }[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const s of sets) {
    const code = s.code.toUpperCase();
    index.set(code, [...(index.get(code) ?? []), s.id]);
  }
  return index;
}

export function matchLocalId(localIds: string[], number: string): string | undefined {
  const exact = localIds.find((id) => id.toLowerCase() === number.toLowerCase());
  if (exact || !/^\d+$/.test(number)) return exact;
  return localIds.find((id) => /^\d+$/.test(id) && Number(id) === Number(number));
}

// One card per name + gameplay text. Same-named cards with different text get a suffix.
export function assignCardKeys(resolved: ResolvedPrint[]): {
  cards: Record<string, CardDef>;
  prints: Record<string, CardPrint>;
  variants: { name: string; keys: string[] }[];
} {
  const bySlug = new Map<string, Map<string, ResolvedPrint[]>>();
  for (const r of resolved) {
    const slug = cardSlug(r.name);
    const groups = bySlug.get(slug) ?? new Map<string, ResolvedPrint[]>();
    const sig = gameplaySignature(r.card);
    groups.set(sig, [...(groups.get(sig) ?? []), r]);
    bySlug.set(slug, groups);
  }

  const cards: Record<string, CardDef> = {};
  const prints: Record<string, CardPrint> = {};
  const variants: { name: string; keys: string[] }[] = [];

  for (const [slug, groups] of bySlug) {
    const keys: string[] = [];
    for (const group of groups.values()) {
      const key = groups.size === 1 ? slug : `${slug}-${group[0]!.key.toLowerCase()}`;
      keys.push(key);
      // pokemontcg.io may know a reprint but not the original; prefer the print with subtypes.
      const rep = group.find((r) => r.card.subtypes.length > 0) ?? group[0]!;
      cards[key] = { ...rep.card, key, prints: group.map((r) => r.key) } as CardDef;
      for (const r of group) {
        prints[r.key] = {
          key: r.key,
          set: r.set,
          number: r.number,
          name: r.name,
          card: key,
          tcgdexId: r.tcgdexId,
          ptcgioId: r.ptcgioId,
          image: r.image,
        };
      }
    }
    if (keys.length > 1) variants.push({ name: groups.values().next().value![0]!.name, keys: keys.sort() });
  }
  return { cards, prints, variants };
}

export function deckProblems(entries: DeckEntry[], manifest: CardManifest): string[] {
  const problems: string[] = [];
  const found: { entry: DeckEntry; card: CardDef }[] = [];
  for (const entry of entries) {
    const print = manifest.prints[printKey(entry)];
    const card = print && manifest.cards[print.card];
    if (!card) problems.push(`${printKey(entry)} (${entry.name}) is not in the manifest`);
    else found.push({ entry, card });
  }

  const copies: { name: string; count: number }[] = [];
  for (const { entry, card } of found) {
    if (card.category === 'energy' && card.energyType === 'Basic') continue;
    const same = copies.find((c) => sameCardName(c.name, card.name));
    if (same) same.count += entry.count;
    else copies.push({ name: card.name, count: entry.count });
  }
  for (const c of copies) if (c.count > 4) problems.push(`${c.count} copies of ${c.name} (max 4)`);

  const aceSpecs = found.reduce((n, { entry, card }) => n + (isAceSpec(card) ? entry.count : 0), 0);
  if (aceSpecs > 1) problems.push(`${aceSpecs} ACE SPEC cards (max 1)`);

  if (!found.some(({ card }) => card.category === 'pokemon' && card.stage === 'Basic')) {
    problems.push('no Basic Pokémon');
  }
  return problems;
}

export async function firstImage(steps: (() => Promise<CardImage | undefined>)[]): Promise<CardImage> {
  for (const step of steps) {
    const image = await step();
    if (image) return image;
  }
  return { source: 'none' };
}

function isAceSpec(card: CardDef): boolean {
  return card.category !== 'pokemon' && card.aceSpec;
}
