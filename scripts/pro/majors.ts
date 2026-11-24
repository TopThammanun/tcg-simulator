// The lists the pros played at major events (BOT-PRO.md P0 and its parallel track), from Limitless's main site
// (limitlesstcg.com: Worlds, International Championships, Regionals, Special Events, Champions League), which the
// play.limitlesstcg.com API of scripts/meta/limitless.ts doesn't have. Each list comes as Limitless export text with
// the cards our engine can't play yet.
//   npx tsx scripts/pro/majors.ts [--events 515,518,…] [--top 32] [--refresh]
// Without --events: every event on limitlesstcg.com/tournaments (its first page). Writes data/pro/majors.json
// ({ events: [{ id, name, date, players, lists: [...] }] }, the top `--top` of each) and prints, per event, which of
// the top 8's lists the engine can play and the cards missing most often. Finished events never change, so their
// pages are kept in .cache/pro/html.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardManifest } from '../../src/data/cards';
import { printKey } from '../../src/data/decklist';
import manifestJson from '../../data/cards.manifest.json';
import { cardSlug } from '../lib/normalize';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TOP = Number(opt('top') ?? 32);
const REFRESH = args.includes('--refresh');
const CACHE = '.cache/pro/html';
const OUT = 'data/pro/majors.json';

export interface MajorCard {
  count: number;
  name: string;
  set: string;
  number: string;
  type: 'pokemon' | 'trainer' | 'energy';
}

export interface MajorList {
  placing: number;
  player: string;
  deck: string;
  /** Limitless export text (Pokémon / Trainer / Energy with counts): paste it into /transcribe/ or the deck builder. */
  text: string;
  /** The cards our engine can't play yet ("2 Talonflame ex PFL 33"); none: the engine plays the list as it is. */
  missing: string[];
}

export interface MajorEvent {
  id: number;
  name: string;
  date: string;
  players: number;
  lists: MajorList[];
}

const manifest = manifestJson as unknown as CardManifest;
const byName = new Map<string, string[]>();
for (const [key, card] of Object.entries(manifest.cards)) {
  const n = cardSlug(card.name);
  byName.set(n, [...(byName.get(n) ?? []), key]);
}
/** Our key for a card: its print, else the only card of that name (a reprint plays the same). */
function cardKey(c: MajorCard): string | undefined {
  const print = manifest.prints[printKey({ set: c.set, number: c.number })];
  if (print) return print.card;
  const keys = byName.get(cardSlug(c.name));
  return keys?.length === 1 ? keys[0] : undefined;
}

async function page(url: string, file: string, refresh = REFRESH): Promise<string> {
  const path = join(CACHE, file);
  if (!refresh && existsSync(path)) return readFileSync(path, 'utf8');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (tcg-simulator research script)' }, signal: AbortSignal.timeout(120_000) });
    if (res.ok) {
      const text = await res.text();
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(path, text);
      return text;
    }
    if (attempt >= 3 || res.status === 404) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

const unescape = (s: string) => s.replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&eacute;/g, 'é');

/** The events on limitlesstcg.com/tournaments: id, date, name, players. */
function eventsOf(html: string): { id: number; date: string; name: string; players: number }[] {
  const out: { id: number; date: string; name: string; players: number }[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const id = m[1]!.match(/href="\/tournaments\/(\d+)"/)?.[1];
    if (!id) continue;
    const cells = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => unescape(c[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
    const players = Number(cells.find((c) => /^\d+$/.test(c)) ?? 0);
    const date = cells.find((c) => /^\d\d \w{3} \d\d$/.test(c)) ?? '';
    const name = cells.find((c) => c && !/^\d/.test(c) && c !== date) ?? `event ${id}`;
    out.push({ id: Number(id), date, name, players });
  }
  return out;
}

/** Every decklist on an event's decklists page, in placing order. */
function listsOf(html: string): MajorList[] {
  const out: MajorList[] = [];
  const blocks = html.split('<div class="tournament-decklist">').slice(1);
  for (const block of blocks) {
    const head = block.match(/data-toggle[^>]*>\s*(\d+)\w*\s+([^<]+?)\s*<\/div>/);
    const deck = unescape(block.match(/data-title="([^"]*)"/)?.[1] ?? '');
    if (!head) continue;
    const cards: MajorCard[] = [];
    for (const c of block.matchAll(/<div class="decklist-card"([^>]*)>[\s\S]*?<span class="card-count">(\d+)<\/span>/g)) {
      const attr = (n: string) => unescape(c[1]!.match(new RegExp(`data-${n}="([^"]*)"`))?.[1] ?? '');
      cards.push({ count: Number(c[2]), name: attr('name'), set: attr('set'), number: attr('number'), type: attr('type') as MajorCard['type'] });
    }
    const section = (type: MajorCard['type'], title: string) => {
      const cs = cards.filter((c) => c.type === type);
      return cs.length ? [`${title}: ${cs.reduce((n, c) => n + c.count, 0)}`, ...cs.map((c) => `${c.count} ${c.name} ${c.set} ${c.number}`.trim()), ''] : [];
    };
    const text = [...section('pokemon', 'Pokémon'), ...section('trainer', 'Trainer'), ...section('energy', 'Energy')].join('\n').trim();
    const missing = cards.filter((c) => !cardKey(c)).map((c) => `${c.count} ${c.name} ${c.set} ${c.number}`);
    out.push({ placing: Number(head[1]), player: unescape(head[2]!), deck, text, missing });
  }
  return out;
}

const index = eventsOf(await page('https://limitlesstcg.com/tournaments', 'tournaments.html', true));
const wanted = opt('events')?.split(',').map(Number) ?? index.map((e) => e.id);
const previous: MajorEvent[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as { events: MajorEvent[] }).events : [];
const events = new Map(previous.map((e) => [e.id, e]));
const missingCount = new Map<string, number>();

for (const id of wanted) {
  const info = index.find((e) => e.id === id) ?? events.get(id) ?? { id, date: '', name: `event ${id}`, players: 0 };
  const lists = listsOf(await page(`https://limitlesstcg.com/tournaments/${id}/decklists`, `t${id}.html`)).slice(0, TOP);
  if (!lists.length) {
    console.log(`${id} ${info.name}: no decklists`);
    continue;
  }
  events.set(id, { id, name: info.name, date: info.date, players: info.players, lists });
  const top8 = lists.filter((l) => l.placing <= 8);
  console.log(`\n${id} ${info.name} (${info.date}, ${info.players} players): ${lists.filter((l) => !l.missing.length).length}/${lists.length} playable`);
  for (const l of top8) console.log(`  ${l.placing}. ${l.player} — ${l.deck}: ${l.missing.length ? `missing ${l.missing.join(', ')}` : 'playable'}`);
  for (const l of lists) for (const m of l.missing) missingCount.set(m.replace(/^\d+ /, ''), (missingCount.get(m.replace(/^\d+ /, '')) ?? 0) + 1);
}

const all = [...events.values()].sort((a, b) => b.id - a.id);
mkdirSync('data/pro', { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ fetched: new Date().toISOString(), top: TOP, events: all })}
`);
console.log(`\nCards missing most often (lists of the top ${TOP}):`);
for (const [card, n] of [...missingCount].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${n}× ${card}`);
console.log(`\nwritten ${OUT}`);
