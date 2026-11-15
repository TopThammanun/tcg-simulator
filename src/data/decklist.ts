// Decklists use the text format that Limitless exports:
//   Pokémon: 20
//   3 Mega Kangaskhan ex MEG 104
// Plain TypeScript with no Astro imports, so build scripts, pages and the engine share it.

export type DeckSection = 'pokemon' | 'trainer' | 'energy';

export interface DeckEntry {
  count: number;
  name: string;
  set: string;
  number: string;
  section: DeckSection;
}

export interface ParsedDecklist {
  entries: DeckEntry[];
  total: number;
}

const SECTION_RE = /^(Pok[eé]mon|Trainer|Energy)\s*(?::\s*(\d+)|\((\d+)\))?$/i;
const CARD_RE = /^(\d+)\s+(.+?)\s+([A-Z0-9]{2,5})\s+([A-Za-z0-9-]+)$/;

const SECTION_LABEL: Record<DeckSection, string> = {
  pokemon: 'Pokémon',
  trainer: 'Trainer',
  energy: 'Energy',
};

export function printKey(card: { set: string; number: string }): string {
  return `${card.set}-${card.number}`;
}

export function parseDecklist(text: string, opts: { expectedTotal?: number } = {}): ParsedDecklist {
  const expectedTotal = opts.expectedTotal ?? 60;
  const entries: DeckEntry[] = [];
  const declared = new Map<DeckSection, number>();
  let section: DeckSection | undefined;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    const heading = line.match(SECTION_RE);
    if (heading) {
      section = sectionOf(heading[1]!);
      const n = heading[2] ?? heading[3];
      if (n !== undefined) declared.set(section, Number(n));
      return;
    }

    const card = line.match(CARD_RE);
    if (!card) throw new Error(`decklist line ${i + 1}: cannot read "${line}"`);
    if (!section) throw new Error(`decklist line ${i + 1}: card before any section heading`);
    entries.push({
      count: Number(card[1]),
      name: card[2]!,
      set: card[3]!,
      number: card[4]!,
      section,
    });
  });

  for (const [s, n] of declared) {
    const actual = sum(entries.filter((e) => e.section === s));
    if (actual !== n) {
      throw new Error(`decklist: ${SECTION_LABEL[s]} heading says ${n} but lists ${actual} cards`);
    }
  }

  const total = sum(entries);
  if (total !== expectedTotal) {
    throw new Error(`decklist: has ${total} cards, expected ${expectedTotal}`);
  }
  return { entries, total };
}

/** Back to Limitless export text. */
export function formatDecklist(entries: DeckEntry[]): string {
  const blocks: string[] = [];
  for (const s of ['pokemon', 'trainer', 'energy'] as const) {
    const xs = entries.filter((e) => e.section === s);
    if (xs.length === 0) continue;
    blocks.push([`${SECTION_LABEL[s]}: ${sum(xs)}`, ...xs.map((e) => `${e.count} ${e.name} ${e.set} ${e.number}`)].join('\n'));
  }
  return blocks.join('\n\n') + '\n';
}

function sectionOf(label: string): DeckSection {
  const l = label.toLowerCase();
  if (l.startsWith('pok')) return 'pokemon';
  return l === 'trainer' ? 'trainer' : 'energy';
}

function sum(entries: DeckEntry[]): number {
  return entries.reduce((n, e) => n + e.count, 0);
}
