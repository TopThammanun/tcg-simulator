// How close the game's bots come to real players: each matchup's win rate when the bots play it against
// each other, next to the same archetypes' results in real tournaments (data/meta/limitless.json, from
// scripts/meta/limitless.ts). A matchup far from the real one points at a deck the bot plays badly (or a
// card that works differently).
//   npx tsx scripts/meta/compare.ts [--games 4000] [--search] [--base 31000000]
// Writes data/meta/compare.md.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDeckFiles } from '../lib/decks';
import type { MetaData } from './limitless';

const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const GAMES = arg('games', 4000);
const BASE = arg('base', 31_000_000);
const SEARCH = process.argv.includes('--search');

const meta = JSON.parse(readFileSync('data/meta/limitless.json', 'utf8')) as MetaData;
const decks = loadDeckFiles('src/content/decks').filter((d) => d.meta.limitless);
const idOf = new Map(decks.map((d) => [d.slug, d.meta.limitless!]));

const cfgPath = `.cache/learn/compare-${process.pid}.json`;
writeFileSync(
  cfgPath,
  JSON.stringify({
    out: `.cache/learn/compare-${process.pid}`,
    games: GAMES,
    base: BASE,
    players: { A: { kind: 'bot', fast: !SEARCH }, B: { kind: 'bot', fast: !SEARCH } },
    pairs: [{ a: 'A', b: 'B', share: 1 }],
  }),
);
const run = spawnSync('npx', ['tsx', 'scripts/learn/gen.ts', cfgPath], { shell: true, encoding: 'utf8', maxBuffer: 1 << 26 });
const line = run.stdout.split('\n').find((l) => l.startsWith('{'));
if (!line) throw new Error(`gen failed:\n${run.stdout.slice(-2000)}\n${run.stderr.slice(-2000)}`);
const byDeck = (JSON.parse(line) as { byDeck: Record<string, { score: number; n: number }> }).byDeck;

// Sim score of deck x against deck y, both seats and both bots.
const sim = new Map<string, { score: number; n: number }>();
for (const [key, v] of Object.entries(byDeck)) {
  const [, x, , y] = key.split(' ');
  const s = (sim.get(`${x}|${y}`) ?? { score: 0, n: 0 });
  sim.set(`${x}|${y}`, { score: s.score + v.score, n: s.n + v.n });
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rows: string[] = [];
const gaps: { x: string; y: string; real: number; sim: number; n: number }[] = [];
for (const x of decks) {
  for (const y of decks) {
    if (x.slug === y.slug) continue;
    const s = sim.get(`${x.slug}|${y.slug}`);
    const r = meta.matchups[idOf.get(x.slug)!]?.[idOf.get(y.slug)!];
    const rn = r ? r.w + r.l + r.t : 0;
    const real = r && rn ? (r.w + r.t / 2) / rn : NaN;
    const simScore = s && s.n ? s.score / s.n : NaN;
    if (rn >= 30 && s) gaps.push({ x: x.slug, y: y.slug, real, sim: simScore, n: rn });
    rows.push(`| ${x.slug} | ${y.slug} | ${rn ? `${pct(real)} (${rn})` : '—'} | ${s ? `${pct(simScore)} (${s.n})` : '—'} | ${rn && s ? `${((simScore - real) * 100).toFixed(1)}` : ''} |`);
  }
}

// Each deck against the field: matchups weighted by the real share of the opponent's archetype.
const field: string[] = [];
for (const x of decks) {
  let simT = 0;
  let realT = 0;
  let w = 0;
  for (const y of decks) {
    if (y.slug === x.slug) continue;
    const share = meta.archetypes[idOf.get(y.slug)!]?.share ?? 0;
    const s = sim.get(`${x.slug}|${y.slug}`);
    const r = meta.matchups[idOf.get(x.slug)!]?.[idOf.get(y.slug)!];
    const rn = r ? r.w + r.l + r.t : 0;
    if (!s || !rn || !share) continue;
    simT += share * (s.score / s.n);
    realT += share * ((r!.w + r!.t / 2) / rn);
    w += share;
  }
  const a = meta.archetypes[idOf.get(x.slug)!];
  const overall = a ? (a.wins + a.ties / 2) / Math.max(1, a.wins + a.losses + a.ties) : NaN;
  if (w) field.push(`| ${x.slug} | ${idOf.get(x.slug)} | ${pct(overall)} | ${pct(realT / w)} | ${pct(simT / w)} | ${(((simT - realT) / w) * 100).toFixed(1)} |`);
}

const rms = Math.sqrt(gaps.reduce((t, g) => t + (g.sim - g.real) ** 2, 0) / Math.max(1, gaps.length));
gaps.sort((a, b) => Math.abs(b.sim - b.real) - Math.abs(a.sim - a.real));
const md = `# The bots against real results

Bots: the game's bot ${SEARCH ? 'with look-ahead' : 'without look-ahead (as the simulator plays)'}, ${GAMES} games over every deck pair (seed ${BASE}).
Real: ${meta.tournaments} Limitless tournaments with ${meta.minPlayers}+ players in the ${meta.days} days to ${meta.fetched.slice(0, 10)} (${meta.players} players).
Real players are not the bot: a matchup's real result also depends on the lists people brought, which differ from ours.

**Distance from real results** (matchups with 30+ real games): root mean square ${(rms * 100).toFixed(1)} points over ${gaps.length} matchups.

## Each deck against the other bot decks (weighted by real meta share)

| Deck | Limitless | Real overall | Real vs these decks | Bots vs these decks | Bots − real |
|---|---|---|---|---|---|
${field.join('\n')}

## Largest gaps

| Deck | vs | Real | Bots | Real games |
|---|---|---|---|---|
${gaps.slice(0, 12).map((g) => `| ${g.x} | ${g.y} | ${pct(g.real)} | ${pct(g.sim)} | ${g.n} |`).join('\n')}

## Every matchup

| Deck | vs | Real (games) | Bots (games) | Bots − real |
|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync('data/meta/compare.md', md);
console.log(md.split('## Every matchup')[0]);
