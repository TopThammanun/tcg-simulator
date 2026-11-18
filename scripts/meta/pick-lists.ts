// A representative real list for each bot deck: the list our engine can play that is closest to the average
// card counts (by card name) of every list that finished near the top of the last weeks' tournaments
// (.cache/meta/lists.json, scripts/meta/limitless.ts), playable or not. Prints each as a deck file body (Limitless format) with its source,
// next to how far the deck file's list is from that average.
//   npx tsx scripts/meta/pick-lists.ts [--min-players 64] [--write]
// --write replaces the lists (and listSource / listUrl) of the bot deck files; --only a,b limits it to those decks.
import { readFileSync, writeFileSync } from 'node:fs';
import manifestJson from '../../data/cards.manifest.json';
import type { CardManifest } from '../../src/data/cards';
import { printKey } from '../../src/data/decklist';
import { loadDeckFiles } from '../lib/decks';
import type { MetaList, MetaLists } from './limitless';

const i = process.argv.indexOf('--min-players');
const MIN_PLAYERS = i > 0 ? Number(process.argv[i + 1]) : 64;
const WRITE = process.argv.includes('--write');
const j = process.argv.indexOf('--only');
const ONLY = j > 0 ? new Set(process.argv[j + 1]!.split(',')) : null;

/** Decks of one archetype: which of its lists each takes (as in variants.ts). */
const SPLIT: Record<string, (cards: Record<string, number>) => boolean> = {
  'festival-lead-seaking': (c) => (c.seaking ?? 0) >= 2,
  'festival-lead-dipplin': (c) => (c.seaking ?? 0) < 2,
};

const meta = JSON.parse(readFileSync('.cache/meta/lists.json', 'utf8')) as MetaLists;
/** Card counts by name ("4 Abra MEG 54" lines). */
const byNames = (text: string) =>
  text.split(/\r?\n/).reduce<Record<string, number>>((m, line) => {
    const [n, ...rest] = line.split(' ');
    const name = rest.slice(0, -2).join(' ');
    m[name] = (m[name] ?? 0) + Number(n);
    return m;
  }, {});
const distance = (a: Record<string, number>, mean: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(mean)])].reduce((t, k) => t + Math.abs((a[k] ?? 0) - (mean[k] ?? 0)), 0);

const manifest = manifestJson as unknown as CardManifest;
const byName = new Map<string, string[]>();
for (const [key, card] of Object.entries(manifest.cards)) byName.set(card.name, [...(byName.get(card.name) ?? []), key]);
/** Section of a list line, from the card it names (the list is playable, so every card is in the manifest). */
function sectionOf(line: string): 'Pokémon' | 'Trainer' | 'Energy' {
  const m = line.match(/^\d+ (.+?) ([A-Z0-9]{2,5}) ([A-Za-z0-9-]+)$/)!;
  const key = manifest.prints[printKey({ set: m[2]!, number: m[3]! })]?.card ?? byName.get(m[1]!)?.[0];
  const c = key ? manifest.cards[key] : undefined;
  return c?.category === 'pokemon' ? 'Pokémon' : c?.category === 'energy' ? 'Energy' : 'Trainer';
}

/** Limitless list text (one "count Name SET NUM" per line) as a deck file body with section headers. */
function deckBody(l: MetaList): string {
  const sections: Record<string, string[]> = { Pokémon: [], Trainer: [], Energy: [] };
  for (const line of l.text.split('\n')) sections[sectionOf(line)]!.push(line);
  return Object.entries(sections)
    .filter(([, ls]) => ls.length)
    .map(([h, ls]) => `${h}: ${ls.reduce((t, x) => t + Number(x.split(' ')[0]), 0)}\n${ls.join('\n')}`)
    .join('\n\n');
}

for (const d of loadDeckFiles('src/content/decks')) {
  const id = d.meta.limitless;
  if (!id || d.meta.side !== 'bot') continue;
  if (ONLY && !ONLY.has(d.slug)) continue;
  const split = (l: MetaList) => !SPLIT[d.slug] || SPLIT[d.slug]!(l.cards ?? { seaking: byNames(l.text).Seaking ?? 0 });
  const top = (meta.lists[id] ?? []).filter((l) => l.players >= MIN_PLAYERS && l.placing !== null && l.placing <= Math.max(8, l.players / 8) && split(l));
  const playable = top.filter((l) => l.cards);
  if (playable.length === 0) {
    console.log(`${d.slug}: no playable top lists`);
    continue;
  }
  const mean: Record<string, number> = {};
  for (const l of top) for (const [k, n] of Object.entries(byNames(l.text))) mean[k] = (mean[k] ?? 0) + n / top.length;
  const best = playable.reduce((a, b) => (distance(byNames(b.text), mean) < distance(byNames(a.text), mean) ? b : a));
  const ours = distance(byNames(d.list.entries.map((e) => `${e.count} ${e.name} ${e.set} ${e.number}`).join('\n')), mean);
  console.log(`\n=== ${d.slug} (${id}): ${top.length} top lists (${playable.length} playable); deck file ${ours.toFixed(1)} cards from their average, pick ${distance(byNames(best.text), mean).toFixed(1)}`);
  console.log(`${best.player} — ${best.placing}/${best.players}, ${best.tournament}, ${best.date}`);
  const body = deckBody(best);
  console.log(body);
  if (WRITE) {
    const file = `src/content/decks/${d.slug}.md`;
    const text = readFileSync(file, 'utf8');
    const [, front] = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)!;
    const fm = front!
      .split(/\r?\n/)
      .filter((x) => !x.startsWith('listUrl:') && !x.startsWith('listSource:'))
      .concat(
        `listUrl: https://play.limitlesstcg.com/tournament/${best.tournamentId}/player/${encodeURIComponent(best.player)}/decklist`,
        `listSource: "${best.player} — placed ${best.placing} of ${best.players}, ${best.tournament.replace(/"/g, "'")} (Limitless online), ${best.date}"`,
      );
    writeFileSync(file, `---\n${fm.join('\n')}\n---\n${body}\n`);
  }
}
