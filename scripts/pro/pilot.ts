// How the pros pilot each bot deck, next to the bot (BOT-PRO.md P4). The pros: the broadcast reader's games
// (.cache/pro/streams/*.trace.json, scripts/pro/trace.ts) with both players named, read from their first turn (both
// players' 6 Prize cards) and 6 turns or more. The bot: the game's bot without look-ahead (each deck's expert) playing
// that deck against every bot deck, both seats. Both measured the same way, off the board at the end of each own turn:
// Pokémon in play and on the Bench, Prize cards taken, the first Prize and the deck's main Pokémon in play by turn; and
// the Trainers played by turn (the pros': only those the stream showed big, and a sample every 3–4 seconds misses
// some, so their shares are lower bounds).
//   npx tsx scripts/pro/pilot.ts [--games 8] [--threads 8] [--out data/pro/pilot.md]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createBot, MODEL } from '../../src/bots';
import { planFor } from '../../src/bots/plans';
import { actor, apply, createGame } from '../../src/engine/actions';
import { deckKeys } from '../../src/engine/db';
import { nameOf, topDef } from '../../src/engine/state';
import { loadDeckFiles } from '../lib/decks';
import { expertModel } from '../lib/experts';
import { runTsWorker } from '../lib/workers';
import type { Game } from './trace';

/** One side of one game: the board at the end of each of its own turns. */
interface Run {
  deck: string;
  turns: { inPlay: number; bench: number; taken: number; mons: string[]; trainers: string[] }[];
}

const files = loadDeckFiles('src/content/decks').filter((f) => f.meta.side === 'bot');
const slugs = files.map((f) => f.slug);

/** The deck's main Pokémon: the one its name is after, else its Pokémon with a Rule Box played most. */
function mainOf(slug: string): string {
  const f = files.find((x) => x.slug === slug)!;
  const mons = f.list.entries.filter((e) => e.section === 'pokemon');
  return (
    mons.find((e) => f.meta.name.includes(e.name.replace(/^Mega | ex$/g, '')))?.name ??
    [...mons].sort((a, b) => Number(/ ex$/.test(b.name)) - Number(/ ex$/.test(a.name)) || b.count - a.count)[0]!.name
  );
}

// ---------- the bot ----------

interface Job {
  games: { a: string; b: string; seed: number }[];
}

function playBot(job: Job): Run[] {
  const cards = new Map(files.map((f) => [f.slug, deckKeys(f.list.entries)]));
  const runs: Run[] = [];
  for (const g of job.games)
    for (const seat of [0, 1] as const) {
      const decks = seat === 0 ? [g.a, g.b] : [g.b, g.a];
      const bots = decks.map((d, i) => createBot(planFor(d), g.seed * 2 + i, planFor(decks[1 - i]!), { fast: true, model: expertModel(d) ?? MODEL }));
      let s = createGame({ seed: g.seed, decks: decks.map((d) => ({ name: d, cards: cards.get(d)! })) as never, quiet: true });
      const mine = decks.map((d): Run => ({ deck: d, turns: [] }));
      const played: string[][] = [[], []];
      for (let n = 0; s.winner === null && n < 4000; n++) {
        const a = bots[actor(s)]!.act(s);
        if (a.t === 'trainer') played[s.current]!.push(nameOf(s, a.card));
        const [main, turn, me] = [s.phase === 'main', s.turn, s.current];
        s = apply(s, a, { trusted: true });
        if (!main || (s.turn === turn && s.winner === null)) continue;
        const ps = s.players[me];
        const slots = [...(ps.active ? [ps.active] : []), ...ps.bench];
        mine[me]!.turns.push({ inPlay: slots.length, bench: ps.bench.length, taken: 6 - ps.prizes.length, mons: slots.map((x) => topDef(s, x).name), trainers: played[me]! });
        played[me] = [];
      }
      runs.push(...mine);
    }
  return runs;
}

if (!isMainThread) {
  parentPort!.postMessage(playBot(workerData as Job));
} else {
  const arg = (name: string, d: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1]! : d;
  };
  const OUT = arg('out', 'data/pro/pilot.md');

  // ---------- the pros ----------

  const head = (slug: string) => (slug.startsWith('festival-lead') ? 'Festival Lead' : files.find((d) => d.slug === slug)!.meta.name.split(/ (?:ex|Powerful|Seek|Box)\b/)[0]!);
  /** A pro deck's bot deck: the one whose name it starts with (Festival Lead by Seaking seen or not). */
  const slugOf = (deck: string, mons: Set<string>) => {
    const d = deck.replace(/^Seaking /, '');
    if (d.startsWith('Festival Lead')) return mons.has('Seaking') ? 'festival-lead-seaking' : 'festival-lead-dipplin';
    return slugs.find((s) => !s.startsWith('festival-lead') && d.startsWith(head(s))) ?? null;
  };
  const dir = '.cache/pro/streams';
  const traces = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.trace.json')) : [];
  const pro: Run[] = [];
  const proDecks = new Map<string, number>();
  let proGames = 0;
  const videos = new Set<string>();
  for (const f of traces) {
    const { games } = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { games: Game[] };
    for (const g of games) {
      if (!g.players.every(Boolean) || g.turns.length < 6 || !g.turns[0]!.start.every((b) => b.prizes === 6)) continue;
      proGames++;
      videos.add(f);
      for (const side of [0, 1] as const) {
        const own = g.turns.filter((t) => t.side === side);
        const all = (b: (typeof own)[number]['end'][number]) => [...(b.active ? [b.active] : []), ...b.bench];
        const seen = new Set(own.flatMap((t) => all(t.end[side]).map((m) => m.name)));
        const deck = g.decks[side] ?? '?';
        proDecks.set(deck, (proDecks.get(deck) ?? 0) + 1);
        const slug = slugOf(deck, seen);
        if (!slug) continue;
        // Prizes left as read, a median of three own turns (a misread lasts one), never back up.
        const left = own.map((t) => t.end[side].prizes);
        let low = 6;
        const taken = left.map((_, k) => {
          const w = left.slice(Math.max(0, k - 1), k + 2).sort((a, b) => a - b);
          low = Math.min(low, w[Math.floor((w.length - 1) / 2)]!);
          return 6 - low;
        });
        pro.push({
          deck: slug,
          turns: own.map((t, k) => ({ inPlay: all(t.end[side]).length, bench: t.end[side].bench.length, taken: taken[k]!, mons: all(t.end[side]).map((m) => m.name), trainers: t.trainers })),
        });
      }
    }
  }

  // ---------- the bot's games ----------

  const per = Number(arg('games', '8'));
  const games: Job['games'] = [];
  let seed = 9_100_000;
  for (const a of slugs) for (const b of slugs) for (let k = 0; k < per; k++) games.push({ a, b, seed: seed++ });
  const threads = Math.min(Number(arg('threads', '8')), games.length);
  const bot = (await Promise.all(Array.from({ length: threads }, (_, t) => runTsWorker<Run[]>(import.meta.url, { games: games.filter((_, i) => i % threads === t) } satisfies Job)))).flat();

  // ---------- the measures ----------

  const at = (runs: Run[], k: number) => runs.filter((r) => r.turns.length >= k);
  const mean = (runs: Run[], k: number, f: (t: Run['turns'][number]) => number) => {
    const rs = at(runs, k);
    return rs.length ? rs.reduce((a, r) => a + f(r.turns[k - 1]!), 0) / rs.length : NaN;
  };
  /** Share of the runs that reached own turn k where `f` held at one of the turns up to k. */
  const byTurn = (runs: Run[], k: number, f: (t: Run['turns'][number]) => boolean) => {
    const rs = at(runs, k);
    return rs.length ? rs.filter((r) => r.turns.slice(0, k).some(f)).length / rs.length : NaN;
  };
  const inGame = (runs: Run[], f: (t: Run['turns'][number]) => boolean) => (runs.length ? runs.filter((r) => r.turns.some(f)).length / runs.length : NaN);
  const n1 = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(1));
  const pc = (x: number) => (Number.isNaN(x) ? '-' : `${Math.round(100 * x)}%`);
  const trio = (f: (k: number) => string, ks: number[]) => ks.map(f).join(' / ');

  const out: string[] = [
    '# How the pros pilot each deck, next to the bot',
    '',
    `Pros: ${proGames} games read off ${videos.size} broadcasts of the major events (\`scripts/pro/streams.ts\`, \`trace.ts\`) with both players named, read from`,
    `their first turn and 6 turns or more. Bot: the game's bot without look-ahead (each deck's expert), ${per} games per deck pair, both seats.`,
    'Both: the board at the end of each own turn. The reader merges some turns (a turn whose panel light it missed joins the',
    "ones around it: the pros' games read have fewer own turns than they had), so their \"by own turn k\" runs early, about a",
    'turn; it misses about 0.1 Benched Pokémon per side; their Trainers are only those the stream showed big (lower bounds).',
    "A difference is listed below only when the reader's errors would shrink it, not make it: fewer Pokémon in play or the",
    'main Pokémon later for the pros, a Trainer the pros are shown playing more than the bot plays it.',
    '',
    '## The pros\' decks read',
    '',
    '| Deck | Sides |',
    '|---|---|',
    ...[...proDecks].sort((a, b) => b[1] - a[1]).map(([d, n]) => `| ${d} | ${n} |`),
  ];
  const notes: string[] = [];
  for (const slug of slugs) {
    const p = pro.filter((r) => r.deck === slug);
    const b = bot.filter((r) => r.deck === slug);
    const main = mainOf(slug);
    const has = (t: Run['turns'][number]) => t.mons.includes(main);
    const row = (label: string, f: (runs: Run[]) => string) => `| ${label} | ${f(p)} | ${f(b)} |`;
    out.push(
      '',
      `## ${files.find((f) => f.slug === slug)!.meta.name}`,
      '',
      '| | Pros | Bot |',
      '|---|---|---|',
      row('Sides (own turns read per game)', (r) => `${r.length} (${n1(r.reduce((a, x) => a + x.turns.length, 0) / r.length)})`),
      row('Pokémon in play, end of own turn 1 / 2 / 3', (r) => trio((k) => n1(mean(r, k, (t) => t.inPlay)), [1, 2, 3])),
      row('Benched, end of own turn 1 / 2', (r) => trio((k) => n1(mean(r, k, (t) => t.bench)), [1, 2])),
      row(`${main} in play by own turn 2 / 3 / 4`, (r) => trio((k) => pc(byTurn(r, k, has)), [2, 3, 4])),
      row('First Prize by own turn 2 / 3 / 4', (r) => trio((k) => pc(byTurn(r, k, (t) => t.taken > 0)), [2, 3, 4])),
      row('Prize cards taken by own turn 3 / 4 / 5', (r) => trio((k) => n1(mean(r, k, (t) => t.taken)), [3, 4, 5])),
      row('Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench', (r) => {
        const ts = r.flatMap((x) => x.turns.slice(1));
        return ts.length ? `${n1(ts.reduce((a, t) => a + t.inPlay, 0) / ts.length)} / ${pc(ts.filter((t) => t.bench >= 5).length / ts.length)}` : '-';
      }),
      row('Pokémon in play by own turn 2 (share of games)', (r) => {
        const rs = at(r, 2);
        const count = new Map<string, number>();
        for (const x of rs) for (const n of new Set(x.turns.slice(0, 2).flatMap((t) => t.mons))) count.set(n, (count.get(n) ?? 0) + 1);
        return [...count]
          .sort((u, v) => v[1] - u[1])
          .slice(0, 6)
          .map(([n, c]) => `${n} ${pc(c / rs.length)}`)
          .join(', ');
      }),
    );
    if (!p.length) {
      out.push('', 'No pro games of this deck read yet.');
      continue;
    }
    // Trainers: the pros' most shown, then those the bot plays by turn 2 that the pros were never shown playing.
    const names = (runs: Run[]) => new Set(runs.flatMap((r) => r.turns.flatMap((t) => t.trainers)));
    const share = (runs: Run[], n: string) => [byTurn(runs, 2, (t) => t.trainers.includes(n)), inGame(runs, (t) => t.trainers.includes(n))] as const;
    const proTop = [...names(p)].map((n) => ({ n, s: share(p, n) })).sort((x, y) => y.s[1] - x.s[1]).slice(0, 8);
    const botOnly = [...names(b)]
      .filter((n) => !names(p).has(n))
      .map((n) => ({ n, s: share(b, n) }))
      .filter((x) => x.s[0] >= 0.25)
      .sort((x, y) => y.s[0] - x.s[0])
      .slice(0, 4);
    out.push('', '| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |', '|---|---|---|---|---|');
    for (const { n } of [...proTop, ...botOnly]) {
      const [sp, sb] = [share(p, n), share(b, n)];
      out.push(`| ${n} | ${pc(sp[0])} | ${pc(sp[1])} | ${pc(sb[0])} | ${pc(sb[1])} |`);
    }
    // Where they part, when the pros have enough sides to say, and only the way the reader's errors cannot make: a
    // Trainer the pros are shown playing more than the bot plays it (their share is a lower bound), the main Pokémon
    // later and fewer Pokémon in play for the pros (their turns run early).
    const name = files.find((f) => f.slug === slug)!.meta.name;
    if (p.length >= 8) {
      for (const { n, s } of proTop) {
        const sb = share(b, n);
        if (s[0] >= 0.25 && s[0] > sb[0] + 0.15) notes.push(`${name}: the pros play ${n} by their 2nd turn in ${pc(s[0])} of games, the bot in ${pc(sb[0])}.`);
      }
      for (const k of [2, 3]) {
        const [x, y] = [byTurn(p, k, has), byTurn(b, k, has)];
        if (y - x >= 0.2) notes.push(`${name}: ${main} in play by own turn ${k}: pros ${pc(x)}, bot ${pc(y)} (the pros later).`);
      }
      for (const k of [2, 3]) {
        const [x, y] = [mean(p, k, (t) => t.inPlay), mean(b, k, (t) => t.inPlay)];
        if (y - x >= 1) notes.push(`${name}: Pokémon in play after own turn ${k}: pros ${n1(x)}, bot ${n1(y)} (the pros fewer).`);
      }
      // Over the game, turn numbers aside: beyond the 0.1 Benched Pokémon the reader misses.
      const over = (r: Run[]) => r.flatMap((x) => x.turns.slice(1));
      const [op, ob] = [over(p), over(b)];
      const [x, y] = [op.reduce((a, t) => a + t.inPlay, 0) / op.length, ob.reduce((a, t) => a + t.inPlay, 0) / ob.length];
      const full = (ts: Run['turns']) => pc(ts.filter((t) => t.bench >= 5).length / ts.length);
      if (y - x >= 0.5) notes.push(`${name}: Pokémon in play over the game: pros ${n1(x)}, bot ${n1(y)}; a full Bench in ${full(op)} of the pros' own turns, ${full(ob)} of the bot's.`);
    }
  }
  const parts = notes.length ? notes.map((n) => `- ${n}`) : ["- Nothing beyond the reader's noise yet."];
  out.splice(10, 0, '## Where the bot parts from the pros', '', ...parts, '');
  writeFileSync(OUT, `${out.join('\n')}\n`);
  console.log(parts.join('\n'));
  console.log(`\nwritten ${OUT}: ${proGames} pro games, ${pro.length} sides of bot decks; ${bot.length} bot sides`);
}
