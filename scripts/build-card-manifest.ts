// Phase 0: build data/cards.manifest.json (card text + image URLs) for every card in
// src/content/decks, and data/cards.report.md describing coverage and anything to check.
//
//   npm run cards              uses .cache/http for responses already downloaded
//   npm run cards -- --refresh  downloads everything again
//
// Optional: POKEMONTCG_API_KEY raises pokemontcg.io rate limits (works without it).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CardImage, CardManifest } from '../src/data/cards';
import { printKey } from '../src/data/decklist';
import {
  assignCardKeys,
  deckProblems,
  firstImage,
  indexSetsByCode,
  matchLocalId,
  type ResolvedPrint,
} from './lib/assemble';
import { loadDeckFiles } from './lib/decks';
import { createHttp } from './lib/http';
import {
  compareSources,
  fromTcgdex,
  gameplaySignature,
  sameCardName,
  type NormalizedCard,
  type PtcgCard,
  type TcgdexCard,
} from './lib/normalize';
import { buildReport, type PrintIssue } from './lib/report';
import { PokemonTcgIo, Tcgdex, tcgdexImage } from './lib/sources';

const http = createHttp({ cacheDir: '.cache/http', refresh: process.argv.includes('--refresh') });
const tcgdex = new Tcgdex(http);
const ptcgio = new PokemonTcgIo(http, process.env.POKEMONTCG_API_KEY);
let sveEnergies: Promise<PtcgCard[]> | undefined; // see basicEnergyImage

const decks = loadDeckFiles('src/content/decks');

// Unique printings across all decks. The same set/number must always carry the same name.
const wanted = new Map<string, { set: string; number: string; name: string }>();
for (const deck of decks) {
  for (const e of deck.list.entries) {
    const key = printKey(e);
    const seen = wanted.get(key);
    if (seen && !sameCardName(seen.name, e.name)) {
      throw new Error(`${key} is "${seen.name}" in one deck and "${e.name}" in ${deck.slug}`);
    }
    wanted.set(key, { set: e.set, number: e.number, name: e.name });
  }
}
// The card pool: cards real lists play that no deck file has yet (data/card-pool.txt, decklist lines).
for (const line of readFileSync('data/card-pool.txt', 'utf8').split(/\r?\n/)) {
  const m = line.trim().match(/^\d+\s+(.+?)\s+([A-Z0-9]{2,5})\s+([A-Za-z0-9-]+)$/);
  if (!m || line.trim().startsWith('#')) continue;
  const e = { name: m[1]!, set: m[2]!, number: m[3]! };
  const seen = wanted.get(printKey(e));
  if (seen && !sameCardName(seen.name, e.name)) throw new Error(`${printKey(e)} is "${seen.name}" in a deck and "${e.name}" in the card pool`);
  if (!seen) wanted.set(printKey(e), e);
}
const codes = new Set([...wanted.values()].map((p) => p.set));
console.log(`${decks.length} decks, ${wanted.size} printings, ${codes.size} set codes`);

// Set codes -> API set ids, read from each API's own set list.
const tSets = await tcgdex.setsForCodes(codes);
const tSetById = new Map(tSets.map((s) => [s.id, s]));
const tIndex = indexSetsByCode(
  tSets.flatMap((s) => (s.abbreviation?.official ? [{ id: s.id, code: s.abbreviation.official }] : [])),
);
const pSets = await ptcgio.sets();
const pIndex = indexSetsByCode(pSets);

// pokemontcg.io records, fetched one request per set. It is the secondary source, so a set
// that keeps failing is reported (its cards show up as "no pokemontcg.io") instead of aborting.
const ptcgByPrint = new Map<string, PtcgCard>();
await Promise.all(
  [...codes].map(async (code) => {
    const prints = [...wanted.entries()].filter(([, p]) => p.set === code);
    for (const setId of pIndex.get(code) ?? []) {
      const remaining = prints.filter(([key]) => !ptcgByPrint.has(key));
      if (remaining.length === 0) break;
      let found: PtcgCard[];
      try {
        found = await ptcgio.cards(setId, remaining.map(([, p]) => p.number));
      } catch (e) {
        console.warn(`pokemontcg.io ${setId}: ${(e as Error).message.slice(-60)} (re-run to retry)`);
        continue;
      }
      for (const card of found) {
        const hit = remaining.find(([, p]) => matchLocalId([card.number ?? ''], p.number) && sameCardName(card.name, p.name));
        if (hit) ptcgByPrint.set(hit[0], card);
      }
    }
  }),
);

const issues: PrintIssue[] = [];
const results = await Promise.all([...wanted.entries()].map(([key, p]) => resolvePrint(key, p)));
const resolved = results.filter((r): r is ResolvedPrint => r !== undefined);

const { cards, prints, variants } = assignCardKeys(resolved.sort((a, b) => a.key.localeCompare(b.key)));
const manifest: CardManifest = { version: 1, generatedAt: new Date().toISOString(), cards, prints };

const deckChecks = decks.map((d) => ({ slug: d.slug, problems: deckProblems(d.list.entries, manifest) }));
const report = buildReport({
  decks,
  manifest,
  issues,
  variants,
  deckChecks,
  setMap: [...codes].sort().map((code) => ({
    code,
    tcgdex: (tIndex.get(code) ?? []).map((id) => `${id} (${tSetById.get(id)?.name})`),
    ptcgio: (pIndex.get(code) ?? []).map((id) => `${id} (${pSets.find((s) => s.id === id)?.name})`),
  })),
});

mkdirSync('data', { recursive: true });
writeFileSync('data/cards.manifest.json', JSON.stringify(manifest, null, 2) + '\n');
writeFileSync('data/cards.report.md', report.markdown);
console.log(report.summary);
if (!report.gatePassed) process.exitCode = 1;

async function resolvePrint(
  key: string,
  p: { set: string; number: string; name: string },
): Promise<ResolvedPrint | undefined> {
  const ptcg = ptcgByPrint.get(key);
  let raw: TcgdexCard | undefined;
  for (const setId of tIndex.get(p.set) ?? []) {
    const set = tSetById.get(setId)!;
    const localId = matchLocalId(set.cards.map((c) => c.localId), p.number);
    const brief = localId && set.cards.find((c) => c.localId === localId);
    if (!brief) continue;
    if (!sameCardName(brief.name, p.name)) {
      issues.push({ key, kind: 'error', text: `TCGdex ${brief.id} is "${brief.name}", decklist says "${p.name}"` });
      continue;
    }
    raw = await tcgdex.card(brief.id);
    break;
  }
  if (!raw) {
    issues.push({ key, kind: 'error', text: `not found on TCGdex${ptcg ? ` (pokemontcg.io has ${ptcg.id})` : ''}` });
    return undefined;
  }
  if (!ptcg) issues.push({ key, kind: 'no-ptcgio', text: 'pokemontcg.io has no record: subtypes/rules (Tera, ACE SPEC) unverified' });

  let card: NormalizedCard;
  try {
    card = fromTcgdex(raw, ptcg);
  } catch (e) {
    issues.push({ key, kind: 'error', text: (e as Error).message });
    return undefined;
  }
  for (const diff of ptcg ? compareSources(card, ptcg) : []) issues.push({ key, kind: 'diff', text: diff });

  const base = raw.image;
  const image = await firstImage([
    async () =>
      base && (await http.exists(tcgdexImage(base, 'high'))) && (await http.exists(tcgdexImage(base, 'low')))
        ? { source: 'tcgdex', high: tcgdexImage(base, 'high'), low: tcgdexImage(base, 'low') }
        : undefined,
    async () => {
      const large = ptcg?.images?.large;
      return large && (await http.exists(large))
        ? { source: 'pokemontcg.io', high: large, low: ptcg.images?.small ?? large }
        : undefined;
    },
    () => basicEnergyImage(card),
    () => altPrintImage(raw, card),
  ]);

  return { key, ...p, name: card.name, card, image, tcgdexId: raw.id, ptcgioId: ptcg?.id };
}

// Basic Energy plays the same in any print. Neither API has images for MEE (or TCGdex for SVE),
// so use the standard Scarlet & Violet Energy art (pokemontcg.io sve 1–8) for a consistent look.
async function basicEnergyImage(card: NormalizedCard): Promise<CardImage | undefined> {
  if (card.category !== 'energy' || card.energyType !== 'Basic') return undefined;
  sveEnergies ??= ptcgio.cards('sve', ['1', '2', '3', '4', '5', '6', '7', '8']).catch(() => []);
  const hit = (await sveEnergies).find((c) => sameCardName(c.name, card.name));
  const large = hit?.images?.large;
  return large && (await http.exists(large))
    ? { source: 'pokemontcg.io', high: large, low: hit.images?.small ?? large, altOf: hit.id }
    : undefined;
}

// A reprint with the same name and identical gameplay text shows the same card.
async function altPrintImage(raw: TcgdexCard, card: NormalizedCard): Promise<CardImage | undefined> {
  const signature = gameplaySignature(card);
  for (const c of await tcgdex.byName(raw.name)) {
    if (!c.image || c.id === raw.id) continue;
    const other = await tcgdex.card(c.id);
    if (!other) continue;
    try {
      if (gameplaySignature(fromTcgdex(other)) !== signature) continue;
    } catch {
      continue;
    }
    if (await http.exists(tcgdexImage(c.image, 'high'))) {
      return { source: 'alt-print', high: tcgdexImage(c.image, 'high'), low: tcgdexImage(c.image, 'low'), altOf: c.id };
    }
  }
  return undefined;
}
