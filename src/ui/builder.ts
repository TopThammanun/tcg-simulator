// The deck builder (/builder/, components/builder/DeckBuilder.svelte), modelled on Limitless's
// (my.limitlesstcg.com/builder): the deck is card counts, kept in the order Limitless's "Sort Deck" puts them
// (Pokémon by evolution line, the biggest line first; Supporters, Items, Tools, Stadiums; Special Energy, then Basic).
// A copy over the limits (4 of a name, 1 ACE SPEC) is refused with the reason; the rest (exactly 60 cards, a Basic
// Pokémon) is reported until it holds. The card search has Limitless's filter chips plus the Pokémon types, and the
// list goes to and from text in the format Limitless and Pokémon TCG Live export (my-decks.ts keeps decks as that text).
import manifestJson from '../../data/cards.manifest.json';
import type { CardDef, CardManifest, EnergyType } from '../data/cards';
import { formatDecklist, type DeckEntry, type DeckSection } from '../data/decklist';
import { tx } from '../i18n';
import { cardFor, norm, SUPPORTED } from './decklist';

const manifest = manifestJson as CardManifest;

export const DECK_SIZE = 60;
export const MAX_COPIES = 4;

/** One card in the deck: its identity (manifest.cards), the print its line names (manifest.prints), how many. */
export interface BuildLine {
  key: string;
  print: string;
  count: number;
}

export const cardOf = (key: string): CardDef => manifest.cards[key]!;
const isBasicEnergy = (c: CardDef) => c.category === 'energy' && c.energyType === 'Basic';
const isAce = (c: CardDef) => c.category !== 'pokemon' && c.aceSpec;
const sum = (lines: readonly BuildLine[]) => lines.reduce((n, l) => n + l.count, 0);

export const total = (deck: readonly BuildLine[]): number => sum(deck);
export const countOf = (deck: readonly BuildLine[], key: string): number => deck.find((l) => l.key === key)?.count ?? 0;

/** How many more copies of `key` the deck may take (Infinity for Basic Energy), and the rule that stops more. */
export function room(deck: readonly BuildLine[], key: string): { n: number; why: string } {
  const c = cardOf(key);
  if (isBasicEnergy(c)) return { n: Infinity, why: '' };
  const named = sum(deck.filter((l) => cardOf(l.key).name === c.name));
  if (isAce(c)) {
    const aces = sum(deck.filter((l) => isAce(cardOf(l.key))));
    return { n: aces ? 0 : 1, why: tx('ACE SPEC ใส่ได้ใบเดียวทั้งเด็ค', 'Only 1 ACE SPEC card in a deck') };
  }
  return { n: Math.max(0, MAX_COPIES - named), why: tx(`การ์ดชื่อ ${c.name} ใส่ได้ไม่เกิน ${MAX_COPIES} ใบ`, `${MAX_COPIES} copies of ${c.name} at most`) };
}

/** The deck with `key` at `n` copies, as many as the limits allow (`refused`: the rule that stopped it short). */
export function setCount(deck: readonly BuildLine[], key: string, n: number, print?: string): { deck: BuildLine[]; refused?: string } {
  const have = countOf(deck, key);
  let want = Math.max(0, Math.floor(n));
  let refused: string | undefined;
  if (want > have) {
    const r = room(deck, key);
    if (want - have > r.n) {
      want = have + r.n;
      refused = r.why;
    }
  }
  const rest = deck.filter((l) => l.key !== key);
  if (want === 0) return { deck: rest, refused };
  const line = { key, print: print ?? deck.find((l) => l.key === key)?.print ?? cardOf(key).prints[0]!, count: want };
  return { deck: sortDeck([...rest, line]), refused };
}

export const addCard = (deck: readonly BuildLine[], key: string, n = 1) => setCount(deck, key, countOf(deck, key) + n);
export const removeCard = (deck: readonly BuildLine[], key: string, n = 1) => setCount(deck, key, countOf(deck, key) - n);

const NAMED = new Map<string, CardDef>();
for (const c of SUPPORTED) if (!NAMED.has(c.name)) NAMED.set(c.name, c);

/** The Basic Pokémon an evolution line starts from (by name): a line's cards stay together. */
function lineRoot(c: CardDef): string {
  let cur = c;
  for (let i = 0; i < 3 && cur.category === 'pokemon' && cur.evolvesFrom; i++) {
    const prev = NAMED.get(cur.evolvesFrom);
    if (!prev) return cur.evolvesFrom;
    cur = prev;
  }
  return cur.name;
}

const STAGE = { Basic: 0, Stage1: 1, Stage2: 2 } as const;
const TRAINER = { Supporter: 0, Item: 1, Tool: 2, Stadium: 3 } as const;

function compare(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  }
  return 0;
}

/** Limitless's deck order: Pokémon by line (most copies first, Basic → Stage 2), then Trainers, then Energy. */
export function sortDeck(deck: readonly BuildLine[]): BuildLine[] {
  const lines = new Map<string, number>();
  for (const l of deck) {
    const c = cardOf(l.key);
    if (c.category === 'pokemon') lines.set(lineRoot(c), (lines.get(lineRoot(c)) ?? 0) + l.count);
  }
  const rank = (l: BuildLine): (number | string)[] => {
    const c = cardOf(l.key);
    if (c.category === 'pokemon') return [0, -(lines.get(lineRoot(c)) ?? 0), lineRoot(c), STAGE[c.stage], -l.count, c.name];
    if (c.category === 'trainer') return [1, TRAINER[c.trainerType], -l.count, c.name, 0, ''];
    return [2, c.energyType === 'Special' ? 0 : 1, -l.count, c.name, 0, ''];
  };
  return [...deck].sort((a, b) => compare(rank(a), rank(b)));
}

export interface Section {
  section: DeckSection;
  label: string;
  lines: BuildLine[];
  count: number;
}

const LABEL: Record<DeckSection, string> = { pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energy' };

/** The deck's Pokémon, Trainers and Energy, each sorted, with their counts (empty sections left out). */
export function sections(deck: readonly BuildLine[]): Section[] {
  const sorted = sortDeck(deck);
  return (['pokemon', 'trainer', 'energy'] as const)
    .map((s) => {
      const lines = sorted.filter((l) => cardOf(l.key).category === s);
      return { section: s, label: LABEL[s], lines, count: sum(lines) };
    })
    .filter((s) => s.lines.length);
}

/** What keeps the deck from being played: none means it is a legal 60-card deck. */
export function problems(deck: readonly BuildLine[]): string[] {
  const out: string[] = [];
  const n = total(deck);
  if (n < DECK_SIZE) out.push(tx(`ขาดอีก ${DECK_SIZE - n} ใบ (เด็คต้องมี 60 ใบพอดี)`, `${DECK_SIZE - n} more cards needed (a deck is exactly 60)`));
  if (n > DECK_SIZE) out.push(tx(`เกินมา ${n - DECK_SIZE} ใบ (เด็คต้องมี 60 ใบพอดี)`, `${n - DECK_SIZE} cards too many (a deck is exactly 60)`));
  const basic = deck.some((l) => {
    const c = cardOf(l.key);
    return c.category === 'pokemon' && c.stage === 'Basic';
  });
  if (!basic) out.push(tx('ต้องมี Basic Pokémon อย่างน้อย 1 ใบ', 'At least 1 Basic Pokémon is needed'));
  return out;
}

/** Legal but worth a look: an Evolution with nothing to evolve from (Rare Candy counts for a Stage 2 with its Basic). */
export function hints(deck: readonly BuildLine[]): string[] {
  const names = new Set(deck.map((l) => cardOf(l.key).name));
  const candy = deck.some((l) => l.key === 'rare-candy');
  const out: string[] = [];
  for (const l of deck) {
    const c = cardOf(l.key);
    if (c.category !== 'pokemon' || !c.evolvesFrom || names.has(c.evolvesFrom)) continue;
    if (c.stage === 'Stage2' && candy && names.has(lineRoot(c))) continue;
    out.push(tx(`${c.name} วิวัฒนาการจาก ${c.evolvesFrom} แต่ยังไม่มี ${c.evolvesFrom} ในเด็ค`, `${c.name} evolves from ${c.evolvesFrom}, which isn't in the deck`));
  }
  return out;
}

/** The deck's 60 (or however many) card keys, in deck order. */
export const deckKeys = (deck: readonly BuildLine[]): string[] => sortDeck(deck).flatMap((l) => Array<string>(l.count).fill(l.key));

/** The list as Limitless / Pokémon TCG Live export it ("Pokémon: 18", then "4 Dreepy TWM 128" lines). */
export function toText(deck: readonly BuildLine[]): string {
  const entries: DeckEntry[] = sortDeck(deck).map((l) => {
    const p = manifest.prints[l.print]!;
    return { count: l.count, name: p.name, set: p.set, number: p.number, section: cardOf(l.key).category };
  });
  return entries.length ? formatDecklist(entries) : '';
}

export interface Imported {
  deck: BuildLine[];
  /** Card names the site can't play yet. */
  unsupported: string[];
  /** Names that stand for several cards with different text (the line needs its set and number). */
  ambiguous: string[];
  /** Lines that aren't a card ("4 Dreepy TWM 128") or a heading. */
  unreadable: string[];
  /** Copies left out by the limits, with the rule. */
  refused: string[];
}

const LINE = /^\*?\s*(\d+)\s+(.+?)(?:\s+([A-Z0-9]{2,5})\s+([A-Za-z0-9-]+))?$/;
const HEADING = /^(Pok[eé]mon|Trainers?|Energy|Total Cards)\b/i;
const LETTER: Record<string, string> = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' };

/** "Basic {P} Energy" and "Basic Psychic Energy" (Pokémon TCG Live) are "Psychic Energy". */
const energyName = (name: string) => name.replace(/^Basic \{([A-Z])\} Energy$/, (_, l: string) => `${LETTER[l] ?? l} Energy`).replace(/^Basic (\w+) Energy$/, '$1 Energy');

/** A pasted list (any of the export formats, any count) as a deck, with what couldn't come along and why. */
export function fromText(text: string): Imported {
  const out: Imported = { deck: [], unsupported: [], ambiguous: [], unreadable: [], refused: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || HEADING.test(line)) continue;
    const m = line.match(LINE);
    if (!m) {
      out.unreadable.push(line);
      continue;
    }
    const name = energyName(m[2]!);
    const c = cardFor({ name, set: m[3], number: m[4] });
    if (c === 'ambiguous') out.ambiguous.push(name);
    else if (!c) out.unsupported.push(name);
    else {
      const print = m[3] && m[4] && manifest.prints[`${m[3]}-${m[4]}`]?.card === c.key ? `${m[3]}-${m[4]}` : undefined;
      const r = setCount(out.deck, c.key, countOf(out.deck, c.key) + Number(m[1]), countOf(out.deck, c.key) ? undefined : print);
      out.deck = r.deck;
      if (r.refused && !out.refused.includes(r.refused)) out.refused.push(r.refused);
    }
  }
  return out;
}

// ---------- the card search ----------

/** Limitless's filter chips: a card shows when it has any of the chips picked. */
export type Chip = 'pokemon' | 'trainer' | 'energy' | 'Supporter' | 'Item' | 'Tool' | 'Stadium' | 'basic' | 'special';

export const CHIPS: readonly { id: Chip; label: string }[] = [
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'trainer', label: 'Trainer' },
  { id: 'energy', label: 'Energy' },
  { id: 'Supporter', label: 'Supporter' },
  { id: 'Item', label: 'Item' },
  { id: 'Tool', label: 'Tool' },
  { id: 'Stadium', label: 'Stadium' },
  { id: 'basic', label: 'Basic Energy' },
  { id: 'special', label: 'Special Energy' },
];

function hasChip(c: CardDef, chip: Chip): boolean {
  switch (chip) {
    case 'pokemon':
    case 'trainer':
    case 'energy':
      return c.category === chip;
    case 'basic':
      return c.category === 'energy' && c.energyType === 'Basic';
    case 'special':
      return c.category === 'energy' && c.energyType === 'Special';
    default:
      return c.category === 'trainer' && c.trainerType === chip;
  }
}

/** The Pokémon types among the cards the site plays, in the game's order. */
const TYPE_ORDER: EnergyType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless'];
export const POKEMON_TYPES: readonly EnergyType[] = TYPE_ORDER.filter((t) => SUPPORTED.some((c) => c.category === 'pokemon' && c.types.includes(t)));

/** The words a card is found by: its name, kinds and types, Abilities and attacks, and its text. */
function words(c: CardDef): { name: string; rest: string } {
  const rest =
    c.category === 'pokemon'
      ? [c.stage, ...c.types, ...c.subtypes, ...c.abilities.flatMap((a) => [a.name, a.effect]), ...c.attacks.flatMap((a) => [a.name, a.effect]), ...c.rules]
      : [c.category === 'trainer' ? c.trainerType : `${c.energyType} Energy`, ...c.subtypes, c.effect, c.aceSpec ? 'ACE SPEC' : ''];
  return { name: norm(c.name), rest: norm(rest.join(' ')) };
}
const INDEX = new Map(SUPPORTED.map((c) => [c.key, words(c)]));

/** The order results are listed in: Pokémon by type then line, Trainers by kind, Energy special first. */
function browseRank(c: CardDef): (number | string)[] {
  if (c.category === 'pokemon') return [0, TYPE_ORDER.indexOf(c.types[0] ?? 'Colorless'), lineRoot(c), STAGE[c.stage], c.name];
  if (c.category === 'trainer') return [1, TRAINER[c.trainerType], 0, 0, c.name];
  return [2, c.energyType === 'Special' ? 0 : 1, 0, 0, c.name];
}
const BROWSE = [...SUPPORTED].sort((a, b) => compare(browseRank(a), browseRank(b)));

/** The cards matching the query (every word, in the name first) with any of the chips and types picked. */
export function searchCards(query: string, chips: readonly Chip[] = [], types: readonly EnergyType[] = []): CardDef[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const out = BROWSE.filter((c) => {
    if (chips.length && !chips.some((ch) => hasChip(c, ch))) return false;
    if (types.length && !(c.category === 'pokemon' && c.types.some((t) => types.includes(t)))) return false;
    const w = INDEX.get(c.key)!;
    return terms.every((t) => w.name.includes(t) || w.rest.includes(t));
  });
  if (!terms.length) return out;
  // Cards whose name has every word come first, in the same order.
  const named = (c: CardDef) => terms.every((t) => INDEX.get(c.key)!.name.includes(t));
  return [...out.filter(named), ...out.filter((c) => !named(c))];
}
