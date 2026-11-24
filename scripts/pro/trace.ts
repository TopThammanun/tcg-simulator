// What the broadcast reader saw, as games and turns (BOT-PRO.md P4). Reads .cache/pro/streams/<id>.samples.jsonl
// (scripts/pro/stream.ts), names what the OCR read by the closest card or player name (every list of
// data/pro/majors.json and the engine's cards), smooths each value over the samples around it, and cuts the samples
// into turns (the lit panel changes sides) and games (the boards start over). Each turn keeps both boards at its
// start and end, and what changed: Pokémon put down, evolved, Knocked Out, damage, Prize cards.
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
function read(s: Sample): Read | null {
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
    const player = [nameLines.map((l) => l.text).join(' '), ...nameLines.map((l) => l.text)].map((t) => closest(t, PLAYERS)).find((n) => n) ?? null;
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

function trace(samples: Sample[]): Game[] {
  const reads = smooth(samples.map(read).filter((r): r is Read => r !== null));
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
  const deckOf = (player: string | null) => (player ? (majors.flatMap((e) => e.lists).find((l) => l.player === player)?.deck ?? null) : null);
  for (let i = 0; i < reads.length; i++) {
    const r = reads[i]!;
    const players: [string | null, string | null] = [r.sides[0].player, r.sides[1].player];
    const fresh = (s: 0 | 1) => r.sides[s].bench.every((b) => b === null) || r.sides[s].active === null;
    // A new game: other players, or both boards back to an Active alone after a game was under way.
    const newMatch = !game || (players[0] && players[1] && (players[0] !== game.players[0] || players[1] !== game.players[1]));
    const restart = game && game.turns.length > 2 && fresh(0) && fresh(1) && reads.slice(i, i + 3).every((x) => x.sides.every((s) => s.bench.every((b) => b === null)));
    if (newMatch || restart) {
      close();
      turn = null;
      game = { players, decks: [deckOf(players[0]), deckOf(players[1])], from: r.t, to: r.t, turns: [] };
      games.push(game);
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
  return games.filter((g) => g.turns.length >= 2);
}

for (const id of process.argv.slice(2)) {
  const samples = readFileSync(`.cache/pro/streams/${id}.samples.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Sample);
  const games = trace(samples);
  writeFileSync(`.cache/pro/streams/${id}.trace.json`, JSON.stringify({ id, games }, null, 1));
  console.log(`${id}: ${samples.length} samples, ${games.length} games`);
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
