// Read every stream of data/pro/vods.json (BOT-PRO.md P4): each video downloaded, sampled by scripts/pro/stream.ts,
// deleted, then turned into games and turns by scripts/pro/trace.ts. Resumable: a video whose samples are complete
// (its .done marker) is skipped. Several videos at once with --workers.
//   npx tsx scripts/pro/streams.ts [--workers 2] [--every 4] [--only id,id]
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : d;
};
const WORKERS = Number(opt('workers', '2'));
const EVERY = opt('every', '4');
const ONLY = args.includes('--only') ? new Set(opt('only', '').split(',')) : null;

const videos = (JSON.parse(readFileSync('data/pro/vods.json', 'utf8')) as { videos: { id: string; title: string; hours: number }[] }).videos.filter(
  (v) => (!ONLY || ONLY.has(v.id)) && !existsSync(`.cache/pro/streams/${v.id}.done`),
);
console.log(`${videos.length} videos to read, ${videos.reduce((a, v) => a + v.hours, 0).toFixed(0)} hours`);

const run = (cmd: string[], log: string) =>
  new Promise<number>((ok) => {
    const p = spawn('npx', ['tsx', ...cmd], { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const out: string[] = [];
    p.stdout.on('data', (d) => out.push(String(d)));
    p.stderr.on('data', (d) => out.push(String(d)));
    p.on('close', (code) => {
      writeFileSync(log, out.join(''));
      ok(code ?? 1);
    });
  });

let next = 0;
async function worker() {
  for (;;) {
    const v = videos[next++];
    if (!v) return;
    const t0 = Date.now();
    console.log(`start ${v.id} (${v.hours} h) ${v.title}`);
    // Finals and top-cut videos every 3 seconds, the long Day streams every EVERY.
    const every = v.hours < 2 ? '3' : EVERY;
    const code = await run(['scripts/pro/stream.ts', '--video', v.id, '--every', every], `.cache/pro/streams/${v.id}.log`);
    if (code !== 0) {
      console.log(`failed ${v.id} (see .cache/pro/streams/${v.id}.log)`);
      continue;
    }
    await run(['scripts/pro/trace.ts', v.id], `.cache/pro/streams/${v.id}.trace.log`);
    writeFileSync(`.cache/pro/streams/${v.id}.done`, new Date().toISOString());
    console.log(`done ${v.id} in ${Math.round((Date.now() - t0) / 60000)} min`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log('all done');
