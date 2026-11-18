// Real lists for training (gen.ts `variants`): for every deck file with a Limitless archetype, the distinct
// lists real players brought (.cache/meta/lists.json, from scripts/meta/limitless.ts) that our engine can play,
// best placings first. Decks sharing an archetype split its lists by a deciding card (Festival Lead: Seaking).
//   npx tsx scripts/meta/variants.ts [--max 150]
// Writes .cache/meta/variants.json: { slug: card-key lists }.
import { readFileSync, writeFileSync } from 'node:fs';
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
const out: Record<string, string[][]> = {};
for (const d of loadDeckFiles('src/content/decks')) {
  const id = d.meta.limitless;
  if (!id) continue;
  const seen = new Set<string>();
  const lists: string[][] = [];
  for (const l of meta.lists[id] ?? []) {
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
