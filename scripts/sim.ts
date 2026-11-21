// Run many games without a browser (PLAN.md: scripts/sim.ts, worker_threads).
//   npm run sim -- --games 1000                 matchup table: your list vs each bot deck
//   npm run sim -- --games 1000 --exp all       the 5 experiments (paired seeds)
//   npm run sim -- --games 1000 --check         also check invariants after every action (Phase 3–4 gate)
//   --opp dragapult-ex,basic-box  --seed 1  --threads 8
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { deckKeys } from '../src/engine/db';
import { DEFAULT_POLICY } from '../src/bots/plans';
import { EXPERIMENTS, type PlayerConfig } from '../src/sim/experiments';
import { runBatch, seedsFor, type BatchJob } from '../src/sim/runner';
import { metaWeighted, pairedDiff, summarize, toCsv, type GameRecord, type Matchup } from '../src/sim/stats';
import { loadDeckFiles } from './lib/decks';
import { expertModel } from './lib/experts';
import { runTsWorker } from './lib/workers';

if (!isMainThread) {
  const job = workerData as BatchJob;
  try {
    parentPort!.postMessage({ ok: true, games: runBatch(job, undefined, expertModel) });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: String((e as Error).stack ?? e) });
  }
} else {
  await main();
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const games = Number(arg('games') ?? 200);
  const baseSeed = Number(arg('seed') ?? 1);
  const threads = Number(arg('threads') ?? cpus().length);
  const check = process.argv.includes('--check');
  const files = loadDeckFiles('src/content/decks');
  const player = files.find((f) => f.meta.side === 'player')!;
  const playerCards = deckKeys(player.list.entries);
  const wanted = arg('opp')?.split(',');
  // The 6 bot decks of the matchup table (Festival Lead plays its Seaking list unless asked otherwise).
  const opps = files
    .filter((f) => f.meta.side === 'bot')
    .filter((f) => (wanted ? wanted.includes(f.slug) : f.slug !== 'festival-lead-dipplin'))
    .map((f) => ({ slug: f.slug, name: f.meta.name, share: f.meta.metaShare ?? 0, cards: deckKeys(f.list.entries) }));
  const share = (slug: string) => opps.find((o) => o.slug === slug)?.share ?? 0;

  const configs: { title: string; configs: PlayerConfig[] }[] = [];
  const exp = arg('exp');
  if (exp) {
    for (const e of EXPERIMENTS.filter((x) => exp === 'all' || x.id === exp)) configs.push({ title: e.title, configs: [e.a, e.b] });
  } else {
    configs.push({ title: 'list ของคุณ (นโยบายค่าเริ่มต้น)', configs: [{ label: 'list เดิม', policy: DEFAULT_POLICY }] });
  }

  const started = Date.now();
  let total = 0;
  const csv: string[] = [];
  mkdirSync('sim-results', { recursive: true });

  for (const group of configs) {
    console.log(`\n## ${group.title}`);
    const results: { config: PlayerConfig; rows: Matchup[]; records: GameRecord[] }[] = [];
    for (const config of group.configs) {
      const rows: Matchup[] = [];
      const records: GameRecord[] = [];
      for (const opp of opps) {
        const seeds = seedsFor(baseSeed + opp.slug.length * 100003, games);
        const chunk = Math.ceil(seeds.length / threads);
        const jobs: BatchJob[] = [];
        for (let i = 0; i < seeds.length; i += chunk) {
          jobs.push({ config, playerCards, opp: { slug: opp.slug, cards: opp.cards }, seeds: seeds.slice(i, i + chunk), checkInvariants: check });
        }
        const parts = await Promise.all(
          jobs.map((j) => runTsWorker<{ ok: boolean; games?: GameRecord[]; error?: string }>(import.meta.url, j)),
        );
        const failed = parts.find((p) => !p.ok);
        if (failed) {
          console.error(failed.error);
          process.exitCode = 1;
          return;
        }
        const recs = parts.flatMap((p) => p.games!);
        total += recs.length;
        records.push(...recs);
        rows.push(summarize(opp.slug, recs));
      }
      results.push({ config, rows, records });
      const w = metaWeighted(rows, share);
      console.log(`\n${config.label}: win rate คาดหวังใน meta ${(w.winRate * 100).toFixed(1)}% (95% CI ${(w.ci[0] * 100).toFixed(1)}–${(w.ci[1] * 100).toFixed(1)})`);
      console.log('  deck'.padEnd(30) + 'win%'.padStart(7) + '   95% CI'.padEnd(16) + 'turns'.padStart(7) + '  max ms');
      for (const r of rows) {
        console.log(
          `  ${r.opp.padEnd(28)}${(r.winRate * 100).toFixed(1).padStart(6)}%   ${(r.ci[0] * 100).toFixed(1)}–${(r.ci[1] * 100).toFixed(1)}`.padEnd(54) +
            `${r.avgTurns.toFixed(1).padStart(6)}  ${r.maxThinkMs.toFixed(0)}`,
        );
      }
      csv.push(toCsv(rows, config.label));
    }
    if (results.length === 2) {
      const d = pairedDiff(results[0]!.records, results[1]!.records, share);
      const sig = d.ci[0] > 0 || d.ci[1] < 0 ? 'ต่างกันจริง' : 'ยังแยกไม่ออกจากความบังเอิญ';
      console.log(
        `\nต่าง (${results[1]!.config.label} − ${results[0]!.config.label}): ${(d.diff * 100).toFixed(1)} จุดเปอร์เซ็นต์ ` +
          `(95% CI ${(d.ci[0] * 100).toFixed(1)} ถึง ${(d.ci[1] * 100).toFixed(1)}, seed ชุดเดียวกัน) → ${sig}`,
      );
    }
  }
  const secs = (Date.now() - started) / 1000;
  const file = `sim-results/sim-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  writeFileSync(file, csv.join('\n'));
  console.log(`\n${total} games in ${secs.toFixed(1)}s (${threads} threads)${check ? ', invariants checked after every action' : ''} -> ${file}`);
}
