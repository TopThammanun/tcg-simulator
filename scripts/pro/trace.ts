// What the broadcast reader saw, as games and turns (BOT-PRO.md P4). Reads .cache/pro/streams/<id>.samples.jsonl
// (scripts/pro/stream.ts), names what the OCR read by the closest card or player name (every list of
// data/pro/majors.json and the engine's cards), smooths each value over the samples around it, and cuts the samples
// into turns (the lit panel changes sides) and games (the boards start over). Each turn keeps both boards at its
// start and end, and what changed: Pokémon put down, evolved, Knocked Out, damage, Prize cards. A player outside
// every top 32 keeps the name as read, their deck named by the list most like the Pokémon seen; replays of other
// events' finals (data/pro/matches.json) are left out.
//   npx tsx scripts/pro/trace.ts <id> [...ids]
// Writes .cache/pro/streams/<id>.trace.json and prints the games.
import { readFileSync, writeFileSync } from 'node:fs';
import type { CardManifest } from '../../src/data/cards';
import manifestJson from '../../data/cards.manifest.json';
import type { OcrLine, Sample } from './stream';

interface MajorList {
  placing: number;
  player: string;
  deck: string;
  text: string;
}
const majors = (JSON.parse(readFileSync('data/pro/majors.json', 'utf8')) as { events: { id: number; name: string; lists: MajorList[] }[] }).events;
const manifest = manifestJson as unknown as CardManifest;

// ---------- names ----------

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}

/** The dictionary entry closest to `text`, when close enough (a quarter of its letters may be misread). */
function closest(text: string, dict: readonly string[]): string | null {
  const t = norm(text);
  if (t.length < 3) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const w of dict) {
    const n = norm(w);
    const d = lev(t, n);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best !== null && bestD <= Math.max(1, Math.floor(norm(best).length / 4)) ? best : null;
}

/** Card names by kind from every major list's sections, and the engine's cards. */
const POKEMON = new Set<string>();
const TRAINERS = new Set<string>();
for (const e of majors)
  for (const l of e.lists) {
    let section = '';
    for (const line of l.text.split('\n')) {
      const h = line.match(/^(Pokémon|Trainer|Energy):/);
      if (h) section = h[1]!;
      const m = line.match(/^\d+ (.+?) [A-Z0-9]{2,4} [A-Za-z0-9-]+$/);
      if (!m) continue;
      if (section === 'Pokémon') POKEMON.add(m[1]!);
      else if (section === 'Trainer') TRAINERS.add(m[1]!);
    }
  }
for (const c of Object.values(manifest.cards)) (c.category === 'pokemon' ? POKEMON : c.category === 'trainer' ? TRAINERS : new Set()).add(c.name);
const POKEMON_NAMES = [...POKEMON];
const TRAINER_NAMES = [...TRAINERS];
const PLAYERS = [...new Set(majors.flatMap((e) => e.lists.map((l) => l.player)))];
const vods = (JSON.parse(readFileSync('data/pro/vods.json', 'utf8')) as { videos: { event: number; id: string }[] }).videos;
/** The finals of data/pro/matches.json: their players by event (the streams open with replays of past finals). */
const FINALS = (JSON.parse(readFileSync('data/pro/matches.json', 'utf8')) as { matches: { event: number; placings: [number, number] }[] }).matches.map((m) => ({
  event: m.event,
  players: m.placings.map((p) => majors.find((e) => e.id === m.event)?.lists.find((l) => l.placing === p)?.player ?? ''),
}));

/** The Pokémon names of each major list, for naming a deck by what was seen of it. */
const LIST_MONS = majors.flatMap((e) =>
  e.lists.map((l) => {
    const mons = new Set<string>();
    let section = '';
    for (const line of l.text.split('\n')) {
      const h = line.match(/^(Pokémon|Trainer|Energy):/);
      if (h) section = h[1]!;
      const m = section === 'Pokémon' ? line.match(/^\d+ (.+?) [A-Z0-9]{2,4} [A-Za-z0-9-]+$/) : null;
      if (m) mons.add(m[1]!);
    }
    return { deck: l.deck, mons };
  }),
);

/** The deck of the major list whose Pokémon are most like those seen (Jaccard), when at least two of them were seen. */
function deckSeen(seen: Set<string>): string | null {
  let best: string | null = null;
  let bestJ = 0;
  for (const l of LIST_MONS) {
    const both = [...seen].filter((n) => l.mons.has(n)).length;
    const j = both / (seen.size + l.mons.size - both);
    if (both >= 2 && j > bestJ) {
      bestJ = j;
      best = l.deck;
    }
  }
  return best;
}

/** The words of a name, 3 letters or more, without accents. */
const words = (n: string) => n.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}]+/u).filter((w) => w.length >= 3);

/** One player read two ways: the shorter name's words all in the longer one ("Gutierrez Ruiz", "Pablo Gutierrez Ruiz", "Cox James"), a letter misread here and there. */
function samePlayer(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)].sort((u, v) => u.length - v.length) as [string[], string[]];
  return x.length > 0 && x.every((w) => y.some((v) => lev(w, v) <= Math.floor(w.length / 4)));
}

// ---------- one sample ----------

export interface Mon {
  name: string;
  hp: number | null;
  max: number | null;
}
export interface Side {
  player: string | null;
  active: Mon | null;
  bench: (Mon | null)[];
  /** Prize icons lit (calibrated in trace(): taken or left). */
  lit: number;
}
interface Read {
  t: number;
  sides: [Side, Side];
  /** The side whose panel is lit (its turn), or null when unclear. */
  turn: 0 | 1 | null;
  stadium: string | null;
  /** A Trainer card shown over a panel. */
  trainer: { side: 0 | 1; name: string } | null;
}

const hpOf = (text: string) => {
  // "90/90", "1 40/140", "40 40" (the slash lost), "210,' 210".
  const t = text.replace(/[^0-9/ ]/g, ' ').replace(/(\d) (?=\d0\/)/g, '$1').trim();
  const m = t.match(/(\d{2,3})\s*\/\s*(\d{2,3})/) ?? t.match(/^(\d{2,3})\s+(\d{2,3})$/);
  if (!m) return null;
  const [hp, max] = [Number(m[1]), Number(m[2])];
  return hp <= max && max % 10 === 0 && hp % 10 === 0 && max >= 30 && max <= 400 ? { hp, max } : null;
};

/**
 * One sample as boards. The overlays of the 2026 season (Worlds, NAIC) and of the 2027 one (from September 2026)
 * place things differently, so lines are told apart by what they say and roughly where: in a side's panel, a
 * Pokémon name near the top is the Active, below y 330 a Benched Pokémon (top to bottom); an HP pair belongs to the
 * name just above it; the player's name is on the first line.
 */
function read(s: Sample, home: readonly string[]): Read | null {
  if (!s.overlay) return null;
  const sides = ([0, 1] as const).map((side): Side => {
    const lines: OcrLine[] = [...(s.ocr[side === 0 ? 'left' : 'right'] ?? []), ...(s.ocr[side === 0 ? 'lhp' : 'rhp'] ?? [])];
    const named = lines
      .map((l) => ({ l, name: l.text.length >= 4 ? closest(l.text, POKEMON_NAMES) : null }))
      .filter((x): x is { l: OcrLine; name: string } => x.name !== null);
    const hps = lines.map((l) => ({ l, hp: hpOf(l.text) })).filter((x): x is { l: OcrLine; hp: { hp: number; max: number } } => x.hp !== null);
    const hpBelow = (y: number, upTo: number) => hps.find((h) => h.l.y > y && h.l.y <= upTo)?.hp ?? null;
    const top = named.filter((x) => x.l.y >= 50 && x.l.y <= 100).sort((a, b) => a.l.y - b.l.y)[0];
    const activeHp = hps.find((h) => h.l.y >= 245 && h.l.y <= 295)?.hp ?? null;
    // Bench: one per row, a name read twice (the panel and its HP column) counts once.
    const rows: { y: number; name: string }[] = [];
    for (const x of named.filter((x) => x.l.y > 330).sort((a, b) => a.l.y - b.l.y)) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - x.l.y) < 25) continue;
      rows.push({ y: x.l.y, name: x.name });
    }
    const bench: (Mon | null)[] = rows.slice(0, 8).map((r) => {
      const hp = hpBelow(r.y, r.y + 62);
      return { name: r.name, hp: hp?.hp ?? null, max: hp?.max ?? null };
    });
    // The player's name: one line, or two (the 2027 overlay writes first and last name on two lines).
    const nameLines = lines.filter((l) => l.y >= 10 && l.y <= 48 && /[A-Za-z]{3}/.test(l.text) && !/^\d/.test(l.text)).sort((a, b) => a.y - b.y || a.x - b.x);
    // A player of this video's event first, then of another event, else the name as read (outside every top 32).
    const tries = [nameLines.map((l) => l.text).join(' '), ...nameLines.map((l) => l.text)];
    // A name as read keeps its words of 3 letters or more (a flag or a stray letter beside it drops out): two of
    // them, or one long one.
    // (not words of narrow strokes only, "Ili", "Til": the panel's edges; nor the overlay's "SEED")
    const raw = nameLines.length <= 3 ? nameLines.flatMap((l) => l.text.split(/[^A-Za-zÀ-ž'-]+/)).filter((w) => w.length >= 3 && !/^[iltjfr'-]+$/i.test(w) && !/^seed$/i.test(w)) : [];
    const player =
      tries.map((t) => closest(t, home)).find((n) => n) ??
      tries.map((t) => closest(t, PLAYERS)).find((n) => n) ??
      (raw.length >= 2 || raw[0]?.length! >= 6 ? raw.join(' ').toLowerCase().replace(/(^|[ '-])\p{L}/gu, (c) => c.toUpperCase()) : null);
    return {
      player,
      active: top ? { name: top.name, hp: activeHp?.hp ?? null, max: activeHp?.max ?? null } : null,
      bench,
      lit: s.pixels.prizes[side].filter((b) => b > 150).length,
    };
  }) as [Side, Side];
  const [gl, gr] = s.pixels.glow;
  const turn = gr - gl > 40 ? 1 : gl - gr > 40 ? 0 : null;
  const stadium = (s.ocr.top ?? []).map((l) => closest(l.text.replace(/[,.]$/, ''), TRAINER_NAMES)).find((n) => n) ?? null;
  // A Trainer shown big over a panel: its name is read below the Active, where the Bench was.
  let trainer: Read['trainer'] = null;
  for (const side of [0, 1] as const) {
    const lines = s.ocr[side === 0 ? 'left' : 'right'] ?? [];
    const name = lines
      .filter((l) => l.y > 330 && l.text.length >= 4 && !/\d+\/\d+/.test(l.text))
      .map((l) => (norm(l.text).length >= 4 ? closest(l.text, TRAINER_NAMES) : null))
      .find((n) => n);
    if (name) trainer = { side, name };
  }
  return { t: s.t, sides, turn, stadium, trainer };
}

// ---------- smoothing ----------

/** The most common value of f over the reads around index i (nulls aside), else null. */
function mode<T>(reads: Read[], i: number, f: (r: Read) => T | null, span = 2): T | null {
  const counts = new Map<string, { v: T; n: number }>();
  for (let j = Math.max(0, i - span); j <= Math.min(reads.length - 1, i + span); j++) {
    const v = f(reads[j]!);
    if (v === null || v === undefined) continue;
    const k = JSON.stringify(v);
    const c = counts.get(k) ?? { v, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  let best: { v: T; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.v ?? null;
}

function smooth(reads: Read[]): Read[] {
  return reads.map((r, i) => {
    const side = (s: 0 | 1): Side => {
      const monAt = (pick: (x: Side) => Mon | null) => {
        const name = mode(reads, i, (x) => pick(x.sides[s])?.name ?? null);
        if (!name) return null;
        // HP: the closest read of this Pokémon (it changes only when it takes damage).
        let hp: { hp: number; max: number } | null = null;
        for (let d = 0; d <= 6 && !hp; d++)
          for (const j of [i - d, i + d]) {
            const m = reads[j] && pick(reads[j]!.sides[s]);
            if (m && m.name === name && m.hp !== null && !hp) hp = { hp: m.hp, max: m.max! };
          }
        return { name, hp: hp?.hp ?? null, max: hp?.max ?? null };
      };
      // The Bench as a whole: the set of names read most often around here (a row missed in one read shifts the
      // rows below it, so row by row would mix Pokémon), each with its closest HP read.
      const benchNames = mode(reads, i, (x) => (x.sides[s].bench.some((b) => b) ? x.sides[s].bench.filter((b): b is Mon => b !== null).map((b) => b.name).sort() : null), 3) ?? [];
      const benchHp = (name: string, nth: number) => {
        for (let d = 0; d <= 6; d++)
          for (const j of [i - d, i + d]) {
            const m = reads[j]?.sides[s].bench.filter((b): b is Mon => b !== null && b.name === name)[nth];
            if (m && m.hp !== null) return { hp: m.hp, max: m.max };
          }
        return { hp: null, max: null };
      };
      return {
        player: mode(reads, i, (x) => x.sides[s].player, 6),
        active: monAt((x) => x.active),
        bench: benchNames.map((name, k) => ({ name, ...benchHp(name, benchNames.slice(0, k).filter((n) => n === name).length) })),
        lit: mode(reads, i, (x) => x.sides[s].lit) ?? r.sides[s].lit,
      };
    };
    return { ...r, sides: [side(0), side(1)], turn: mode(reads, i, (x) => x.turn, 1), stadium: mode(reads, i, (x) => x.stadium) };
  });
}

// ---------- games and turns ----------

interface Board {
  active: Mon | null;
  bench: Mon[];
  prizes: number;
}
export interface Turn {
  side: 0 | 1;
  from: number;
  to: number;
  start: [Board, Board];
  end: [Board, Board];
  stadium: string | null;
  trainers: string[];
  /** Pokémon of the side to act new in play, those that evolved (from → to), Knocked Out on either side, damage done. */
  put: string[];
  evolved: string[];
  ko: [string[], string[]];
  damage: { name: string; amount: number }[];
}
export interface Game {
  players: [string | null, string | null];
  decks: [string | null, string | null];
  from: number;
  to: number;
  turns: Turn[];
}

const board = (s: Side, prizes: number): Board => ({ active: s.active, bench: s.bench.filter((b): b is Mon => b !== null), prizes });
const all = (b: Board) => (b.active ? [b.active, ...b.bench] : b.bench);

function diff(start: [Board, Board], end: [Board, Board], side: 0 | 1): Pick<Turn, 'put' | 'evolved' | 'ko' | 'damage'> {
  const names = (b: Board) => all(b).map((m) => m.name);
  const left = (a: string[], b: string[]) => {
    const rest = [...b];
    return a.filter((n) => {
      const i = rest.indexOf(n);
      if (i >= 0) rest.splice(i, 1);
      return i < 0;
    });
  };
  const evolvedFrom = (to: string) => {
    const c = Object.values(manifest.cards).find((x) => x.name === to && x.category === 'pokemon');
    return c && c.category === 'pokemon' ? c.evolvesFrom : undefined;
  };
  const mine = { gone: left(names(start[side]), names(end[side])), came: left(names(end[side]), names(start[side])) };
  const evolved: string[] = [];
  for (const to of [...mine.came]) {
    const from = evolvedFrom(to);
    const i = from ? mine.gone.indexOf(from) : -1;
    if (i >= 0) {
      evolved.push(`${from} → ${to}`);
      mine.gone.splice(i, 1);
      mine.came.splice(mine.came.indexOf(to), 1);
    }
  }
  const other = (1 - side) as 0 | 1;
  const ko: [string[], string[]] = [[], []];
  ko[side] = mine.gone;
  ko[other] = left(names(start[other]), names(end[other]));
  const damage: Turn['damage'] = [];
  for (const m of all(end[other])) {
    const before = all(start[other]).find((x) => x.name === m.name && x.hp !== null);
    if (before && m.hp !== null && before.hp! > m.hp) damage.push({ name: m.name, amount: before.hp! - m.hp });
  }
  return { put: mine.came, evolved, ko, damage };
}

function trace(samples: Sample[], event: number | undefined): { games: Game[]; replays: number } {
  const home = majors.find((e) => e.id === event)?.lists.map((l) => l.player) ?? [];
  const reads = smooth(samples.map((s) => read(s, home)).filter((r): r is Read => r !== null));
  // Prize icons: whether a lit icon is a Prize taken or left is read off the data: lit counts rise through a game
  // when they are Prizes taken.
  const games: Game[] = [];
  let game: Game | null = null;
  let turn: { side: 0 | 1; i0: number; i1: number; trainers: Set<string> } | null = null;
  const prizesOf = (r: Read, s: 0 | 1) => r.sides[s].lit;
  const close = () => {
    if (!game || !turn) return;
    const a = reads[turn.i0]!;
    const b = reads[turn.i1]!;
    const start: [Board, Board] = [board(a.sides[0], prizesOf(a, 0)), board(a.sides[1], prizesOf(a, 1))];
    const end: [Board, Board] = [board(b.sides[0], prizesOf(b, 0)), board(b.sides[1], prizesOf(b, 1))];
    game.turns.push({ side: turn.side, from: a.t, to: b.t, start, end, stadium: b.stadium, trainers: [...turn.trainers], ...diff(start, end, turn.side) });
    game.to = b.t;
  };
  // The list of this event first: a player's deck at another event may be another deck.
  const deckOf = (player: string | null) =>
    player ? ((majors.find((e) => e.id === event)?.lists ?? []).find((l) => l.player === player) ?? majors.flatMap((e) => e.lists).find((l) => l.player === player))?.deck ?? null : null;
  // How often each name was read on each side of each game: a game's players are its most read names.
  const named = new Map<Game, [Map<string, number>, Map<string, number>]>();
  const same = (a: string | null, b: string | null) => !a || !b || samePlayer(a, b);
  for (let i = 0; i < reads.length; i++) {
    const r = reads[i]!;
    const players: [string | null, string | null] = [r.sides[0].player, r.sides[1].player];
    const fresh = (s: 0 | 1) => r.sides[s].bench.every((b) => b === null) || r.sides[s].active === null;
    // A new game: other players (for a few samples running: a misread name lasts a sample or two), or both boards
    // back to an Active alone after a game was under way.
    const newMatch =
      !game ||
      (players[0] &&
        players[1] &&
        !(same(players[0], game.players[0]) && same(players[1], game.players[1])) &&
        reads.slice(i, i + 4).every((x) => same(x.sides[0].player, players[0]) && same(x.sides[1].player, players[1])));
    const restart = game && game.turns.length > 2 && fresh(0) && fresh(1) && reads.slice(i, i + 3).every((x) => x.sides.every((s) => s.bench.every((b) => b === null)));
    if (newMatch || restart) {
      close();
      turn = null;
      game = { players, decks: [null, null], from: r.t, to: r.t, turns: [] };
      named.set(game, [new Map(), new Map()]);
      games.push(game);
    }
    for (const s of [0, 1] as const) {
      const p = players[s];
      if (!p) continue;
      const counts = named.get(game!)![s];
      counts.set(p, (counts.get(p) ?? 0) + 1);
      if (!game!.players[s]) game!.players[s] = p;
    }
    if (r.turn === null) continue;
    if (!turn || turn.side !== r.turn) {
      // A side change counts once the other panel stays lit for two samples.
      if (turn && reads[i + 1]?.turn !== r.turn) continue;
      close();
      turn = { side: r.turn, i0: i, i1: i, trainers: new Set() };
    }
    turn.i1 = i;
    if (r.trainer && r.trainer.side === r.turn) turn.trainers.add(r.trainer.name);
  }
  close();
  const kept = games.filter((g) => g.turns.length >= 2);
  for (const g of kept)
    for (const s of [0, 1] as const) {
      const top = [...named.get(g)![s]].sort((a, b) => b[1] - a[1])[0];
      g.players[s] = top ? top[0] : null;
    }
  // A deck: the player's list at a major, else by the Pokémon seen on that player's side in all their games here.
  for (const g of kept)
    for (const s of [0, 1] as const) {
      const p = g.players[s];
      g.decks[s] = deckOf(p);
      if (g.decks[s]) continue;
      const theirs = p ? kept.flatMap((h) => ([0, 1] as const).filter((k) => h.players[k] && samePlayer(h.players[k]!, p)).map((k) => [h, k] as const)) : [[g, s] as const];
      g.decks[s] = deckSeen(new Set(theirs.flatMap(([h, k]) => h.turns.flatMap((t) => [...all(t.start[k]), ...all(t.end[k])].map((m) => m.name)))));
    }
  // A game between the two finalists of another event is a replay (the streams open with past finals).
  const replay = (g: Game) =>
    FINALS.some((f) => f.event !== event && f.players.every((p) => g.players.some((q) => q && samePlayer(p, q))));
  return { games: kept.filter((g) => !replay(g)), replays: kept.filter(replay).length };
}

for (const id of process.argv.slice(2)) {
  const samples = readFileSync(`.cache/pro/streams/${id}.samples.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Sample);
  const { games, replays } = trace(samples, vods.find((v) => v.id === id)?.event);
  writeFileSync(`.cache/pro/streams/${id}.trace.json`, JSON.stringify({ id, games }, null, 1));
  console.log(`${id}: ${samples.length} samples, ${games.length} games (${replays} replays of other events left out)`);
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  for (const g of games) {
    console.log(`\n${mmss(g.from)}–${mmss(g.to)} ${g.players[0]} (${g.decks[0]}) vs ${g.players[1]} (${g.decks[1]}), ${g.turns.length} turns`);
    for (const t of g.turns) {
      const b = (x: Board) => `${x.active?.name ?? '?'}${x.active?.hp !== null && x.active ? ` ${x.active.hp}/${x.active.max}` : ''}${x.bench.length ? ` [${x.bench.map((m) => m.name).join(', ')}]` : ''} P${x.prizes}`;
      const ev = [
        t.put.length ? `+${t.put.join(', ')}` : '',
        t.evolved.length ? `evolve ${t.evolved.join(', ')}` : '',
        t.ko[1 - t.side]!.length ? `KO ${t.ko[1 - t.side]!.join(', ')}` : '',
        t.damage.length ? `dmg ${t.damage.map((d) => `${d.name} ${d.amount}`).join(', ')}` : '',
        t.trainers.length ? `played ${t.trainers.join(', ')}` : '',
      ].filter(Boolean);
      console.log(`  ${mmss(t.from)} ${t.side === 0 ? 'L' : 'R'} | ${b(t.end[0])} || ${b(t.end[1])} | ${ev.join('; ')}`);
    }
  }
}
