// Real lists for training (gen.ts `variants`): for every deck file with a Limitless archetype, the distinct
// lists real players brought (.cache/meta/lists.json, from scripts/meta/limitless.ts) that our engine can play,
// best placings first. Decks sharing an archetype split its lists by a deciding card (Festival Lead: Seaking).
// The lists of major events (data/pro/majors.json, scripts/pro/majors.ts: Worlds, ICs, Regionals) come first: a list
// whose deck name starts with a deck file's (Dragapult, Dragapult Dusknoir…) is that deck's, the rest are off-meta.
// A list lists.json could not play when it was written is read again from its text, for cards added to the engine
// since (BOT-PRO.md: the Dusknoir line, Blaziken ex…).
//   npx tsx scripts/meta/variants.ts [--max 150]
// Writes .cache/meta/variants.json: { slug: card-key lists }, and .cache/meta/offmeta.json: the playable lists of
// archetypes no deck file covers (BOT-NEXT.md N6: opponents unlike the meta decks), { train, heldOut } with
// a fixed 50 held out (chosen by a hash of the list, so the same ones every run) for measuring.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fromText } from '../../src/ui/builder';
import type { MajorEvent } from '../pro/majors';
import { loadDeckFiles } from '../lib/decks';
import type { MetaLists } from './limitless';

const i = process.argv.indexOf('--max');
const MAX = i > 0 ? Number(process.argv[i + 1]) : 150;

/** Decks of one archetype: which of its lists each takes. */
const SPLIT: Record<string, (cards: Record<string, number>) => boolean> = {
  'festival-lead-seaking': (c) => (c.seaking ?? 0) >= 2,
  'festival-lead-dipplin': (c) => (c.seaking ?? 0) < 2,
};

const meta = JSON.parse(readFileSync('.cache/meta/lists.json', 'utf8')) as MetaLists;

/** A list's cards by key from its export text, or null when the engine can't play it (or it isn't 60 cards). */
function resolve(text: string): Record<string, number> | null {
  const r = fromText(text);
  if (r.unsupported.length || r.ambiguous.length || r.unreadable.length || r.refused.length) return null;
  const cards: Record<string, number> = {};
  for (const l of r.deck) cards[l.key] = (cards[l.key] ?? 0) + l.count;
  return Object.values(cards).reduce((a, b) => a + b, 0) === 60 ? cards : null;
}
let readAgain = 0;
for (const ls of Object.values(meta.lists)) {
  for (const l of ls) {
    if (l.cards) continue;
    const cards = resolve(l.text);
    if (cards) {
      l.cards = cards;
      readAgain++;
    }
  }
}

// The major events' lists, by the deck file whose name theirs starts with (or none: off-meta).
const decks = loadDeckFiles('src/content/decks');
const headName = (slug: string) => (slug.startsWith('festival-lead') ? 'Festival Lead' : decks.find((d) => d.slug === slug)!.meta.name.split(/ (?:ex|Powerful|Seek|Box)\b/)[0]!);
const majors = existsSync('data/pro/majors.json') ? (JSON.parse(readFileSync('data/pro/majors.json', 'utf8')) as { events: MajorEvent[] }).events : [];
const pro: { deck: string; cards: Record<string, number> }[] = majors
  .flatMap((e) => e.lists)
  .sort((a, b) => a.placing - b.placing)
  .flatMap((l) => {
    const cards = l.missing.length ? null : resolve(l.text);
    return cards ? [{ deck: l.deck, cards }] : [];
  });
const proOf = (slug: string) => {
  const head = headName(slug);
  return pro.filter((l) => l.deck.replace(/^Seaking /, '').startsWith(head)).map((l) => l.cards);
};
const proTaken = new Set<Record<string, number>>();

const out: Record<string, string[][]> = {};
for (const d of decks) {
  const id = d.meta.limitless;
  if (!id) continue;
  const seen = new Set<string>();
  const lists: string[][] = [];
  const theirs = proOf(d.slug);
  theirs.forEach((c) => proTaken.add(c));
  for (const l of [...theirs.map((cards) => ({ cards })), ...(meta.lists[id] ?? [])]) {
    if (!l.cards || (SPLIT[d.slug] && !SPLIT[d.slug]!(l.cards))) continue;
    const cards = Object.entries(l.cards).flatMap(([k, n]) => Array.from({ length: n }, () => k)).sort();
    if (cards.length !== 60) continue;
    const key = cards.join();
    if (seen.has(key)) continue;
    seen.add(key);
    lists.push(cards);
    if (lists.length >= MAX) break;
  }
  out[d.slug] = lists;
  console.log(`${d.slug.padEnd(24)} ${String(lists.length).padStart(4)} lists (${id})`);
}
writeFileSync('.cache/meta/variants.json', JSON.stringify(out));

// Off-meta: every archetype without a deck file, its distinct playable lists (the major events' under their deck name).
const covered = new Set(decks.map((d) => d.meta.limitless).filter(Boolean));
const off: { archetype: string; cards: string[]; key: string }[] = [];
const offLists: [string, { cards: Record<string, number> | null }[]][] = [
  ...Object.entries(meta.lists),
  ...Object.entries(
    pro.filter((l) => !proTaken.has(l.cards)).reduce<Record<string, { cards: Record<string, number> }[]>>((t, l) => {
      const id = `major:${l.deck.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      (t[id] ??= []).push({ cards: l.cards });
      return t;
    }, {}),
  ),
];
for (const [id, ls] of offLists) {
  if (covered.has(id)) continue;
  const seen = new Set<string>();
  for (const l of ls) {
    if (!l.cards) continue;
    const cards = Object.entries(l.cards).flatMap(([k, n]) => Array.from({ length: n }, () => k)).sort();
    if (cards.length !== 60) continue;
    const key = cards.join();
    if (seen.has(key)) continue;
    seen.add(key);
    off.push({ archetype: id, cards, key: createHash('sha1').update(key).digest('hex') });
  }
}
off.sort((a, b) => a.key.localeCompare(b.key));
const HELD_OUT = Math.min(50, Math.floor(off.length / 4));
const strip = ({ archetype, cards }: { archetype: string; cards: string[] }) => ({ archetype, cards });
writeFileSync('.cache/meta/offmeta.json', JSON.stringify({ heldOut: off.slice(0, HELD_OUT).map(strip), train: off.slice(HELD_OUT).map(strip) }));
const by = (xs: typeof off) => Object.entries(xs.reduce<Record<string, number>>((t, x) => ((t[x.archetype] = (t[x.archetype] ?? 0) + 1), t), {})).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`read again (cards added since lists.json): ${readAgain} lists; major events: ${pro.length} playable lists, ${proTaken.size} as a deck file's`);
console.log(`off-meta: ${off.length - HELD_OUT} lists to train with (${by(off.slice(HELD_OUT))}), ${HELD_OUT} held out (${by(off.slice(0, HELD_OUT))})`);
