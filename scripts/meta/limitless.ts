// Real tournament results from Limitless (play.limitlesstcg.com, public API, no key): who played what, and
// who beat whom. Gives the meta share and win rate of every archetype, the archetype-vs-archetype matchups
// played by real players, and the lists they played (which of them our engine can play).
//   npx tsx scripts/meta/limitless.ts [--days 30] [--min-players 32] [--refresh]
// Writes data/meta/limitless.json (archetypes and matchups) and .cache/meta/lists.json (every list, ~15 MB: not
// committed; training reads it). Finished tournaments never change, so their answers stay cached in .cache/http;
// the tournament list itself is fetched again every day.
import { mkdirSync, writeFileSync } from 'node:fs';
import { printKey } from '../../src/data/decklist';
import type { CardManifest } from '../../src/data/cards';
import manifestJson from '../../data/cards.manifest.json';
import { createHttp } from '../lib/http';
import { cardSlug } from '../lib/normalize';

const API = 'https://play.limitlesstcg.com/api';
const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const DAYS = arg('days', 30);
const MIN_PLAYERS = arg('min-players', 32);
const REFRESH = process.argv.includes('--refresh');

interface Tournament { id: string; name: string; date: string; format: string; players: number }
interface ListCard { count: number; set: string; number: string; name: string }
interface Standing {
  player: string;
  placing: number | null;
  deck?: { id: string; name: string } | null;
  decklist?: { pokemon?: ListCard[]; trainer?: ListCard[]; energy?: ListCard[] } | null;
  record?: { wins: number; losses: number; ties: number };
}
interface Pairing { round: number; winner: string | number | null; player1: string; player2?: string }

export interface MetaList {
  tournament: string;
  tournamentId: string;
  date: string;
  player: string;
  placing: number | null;
  players: number;
  /** Card keys of our manifest, or null when a card isn't in it (our engine can't play the list). */
  cards: Record<string, number> | null;
  /** The cards our manifest doesn't have. */
  missing: string[];
  text: string;
}

export interface MetaData {
  fetched: string;
  days: number;
  minPlayers: number;
  tournaments: number;
  players: number;
  archetypes: Record<string, { name: string; players: number; share: number; wins: number; losses: number; ties: number }>;
  /** matchups[a][b]: games a played against b (a's wins, losses, ties), mirrors left out. */
  matchups: Record<string, Record<string, { w: number; l: number; t: number }>>;
}

export interface MetaLists {
  fetched: string;
  /** By archetype, best placings (relative to the field) first. */
  lists: Record<string, MetaList[]>;
}

const manifest = manifestJson as unknown as CardManifest;
// Card key by print, then by name for prints our manifest doesn't list (a reprint plays the same).
const byName = new Map<string, string[]>();
for (const [key, card] of Object.entries(manifest.cards)) {
  const n = cardSlug(card.name);
  byName.set(n, [...(byName.get(n) ?? []), key]);
}
function cardKey(c: ListCard): string | undefined {
  const print = manifest.prints[printKey(c)];
  if (print) return print.card;
  const keys = byName.get(cardSlug(c.name));
  return keys?.length === 1 ? keys[0] : undefined;
}

const http = createHttp({ cacheDir: '.cache/http', concurrency: 1 });
const fresh = createHttp({ cacheDir: `.cache/http/limitless-list-${new Date().toISOString().slice(0, 10)}`, refresh: REFRESH });

const since = Date.now() - DAYS * 86400_000;
const all = (await fresh.getJson<Tournament[]>(`${API}/tournaments?game=PTCG&format=STANDARD&limit=1000`)) ?? [];
const events = all.filter((t) => t.players >= MIN_PLAYERS && Date.parse(t.date) >= since && Date.parse(t.date) < Date.now() - 86400_000);
console.log(`${events.length} tournaments with ${MIN_PLAYERS}+ players in the last ${DAYS} days`);

const data: MetaData = {
  fetched: new Date().toISOString(),
  days: DAYS,
  minPlayers: MIN_PLAYERS,
  tournaments: 0,
  players: 0,
  archetypes: {},
  matchups: {},
};
const lists: MetaLists = { fetched: data.fetched, lists: {} };
// A pause after every answer that came from the network (cached ones are instant): the API rate-limits.
const get = async <T>(url: string) => {
  const t0 = Date.now();
  const r = await (REFRESH ? fresh : http).getJson<T>(url);
  if (Date.now() - t0 > 30) await new Promise((ok) => setTimeout(ok, 1500));
  return r;
};

// One request at a time: the API answers 429 to bursts.
for (const [i, t] of events.entries()) {
  {
    const standings = await get<Standing[]>(`${API}/tournaments/${t.id}/standings`);
    const pairings = await get<Pairing[]>(`${API}/tournaments/${t.id}/pairings`);
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${events.length}`);
    if (!standings?.length || !pairings?.length) continue;
    data.tournaments++;
    const deckOf = new Map<string, string>();
    for (const s of standings) {
      const id = s.deck?.id;
      if (!id || id === 'other') continue;
      deckOf.set(s.player, id);
      data.players++;
      const a = (data.archetypes[id] ??= { name: s.deck!.name, players: 0, share: 0, wins: 0, losses: 0, ties: 0 });
      a.players++;
      const cards = [...(s.decklist?.pokemon ?? []), ...(s.decklist?.trainer ?? []), ...(s.decklist?.energy ?? [])];
      if (cards.length) {
        const keys: Record<string, number> = {};
        const missing: string[] = [];
        for (const c of cards) {
          const k = cardKey(c);
          if (k) keys[k] = (keys[k] ?? 0) + c.count;
          else missing.push(`${c.count} ${c.name} ${c.set} ${c.number}`);
        }
        (lists.lists[id] ??= []).push({
          tournament: t.name,
          tournamentId: t.id,
          date: t.date.slice(0, 10),
          player: s.player,
          placing: s.placing,
          players: t.players,
          cards: missing.length ? null : keys,
          missing,
          text: cards.map((c) => `${c.count} ${c.name} ${c.set} ${c.number}`).join('\n'),
        });
      }
    }
    for (const p of pairings) {
      if (!p.player2 || typeof p.winner !== 'string' && p.winner !== 0) continue; // byes, unfinished
      const a = deckOf.get(p.player1);
      const b = deckOf.get(p.player2);
      if (!a || !b) continue;
      const result = p.winner === 0 ? 't' : p.winner === p.player1 ? 'w' : p.winner === p.player2 ? 'l' : null;
      if (!result) continue;
      const flip = { w: 'l', l: 'w', t: 't' } as const;
      for (const [x, y, r] of [[a, b, result], [b, a, flip[result]]] as const) {
        if (x === y) continue;
        const m = ((data.matchups[x] ??= {})[y] ??= { w: 0, l: 0, t: 0 });
        m[r]++;
        const arch = data.archetypes[x]!;
        if (r === 'w') arch.wins++;
        else if (r === 'l') arch.losses++;
        else arch.ties++;
      }
    }
  }
}
for (const a of Object.values(data.archetypes)) a.share = a.players / Math.max(1, data.players);
for (const l of Object.values(lists.lists)) l.sort((x, y) => (x.placing ?? 999) / x.players - (y.placing ?? 999) / y.players);

writeFileSync('data/meta/limitless.json', `${JSON.stringify(data, null, 1)}
`);
mkdirSync('.cache/meta', { recursive: true });
writeFileSync('.cache/meta/lists.json', JSON.stringify(lists));
const top = Object.entries(data.archetypes).sort((x, y) => y[1].players - x[1].players).slice(0, 25);
console.log(`${data.tournaments} tournaments, ${data.players} players with a known deck`);
for (const [id, a] of top) {
  const n = a.wins + a.losses + a.ties;
  const playable = (lists.lists[id] ?? []).filter((l) => l.cards).length;
  console.log(
    `${id.padEnd(32)} ${(a.share * 100).toFixed(1).padStart(5)}%  win ${((a.wins + a.ties / 2) / Math.max(1, n) * 100).toFixed(1).padStart(5)}% of ${String(n).padStart(5)}  lists ${String((lists.lists[id] ?? []).length).padStart(4)} (playable ${playable})`,
  );
}
