// The broadcast reader (BOT-PRO.md P4: every streamed game of the major events, not only the finals transcribed by
// hand). Play Pokémon's English broadcasts draw both boards on an overlay: each side's Active and Benched Pokémon
// with their HP, the Prize cards left, the Stadium, and the side whose turn it is lit. This samples a downloaded
// video every few seconds in Chromium (a local HTTP server feeds it, so the canvas can read pixels), measures the
// overlay's pixels (turn glow, HP-bar fill, Prize icons), crops the panels three times larger for Windows' OCR
// (scripts/pro/ocr.ps1) and writes what it read, one JSON line per sample.
//   npx tsx scripts/pro/stream.ts --video <youtube id> [--every 3] [--from 0] [--to <s>] [--keep]
// Downloads the video (720p, video only) with yt-dlp into .cache/pro/video first, and deletes it afterwards unless
// --keep. Writes .cache/pro/streams/<id>.samples.jsonl; scripts/pro/trace.ts turns the samples into games and turns.
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name: string, d?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : d;
};
const VIDEO = opt('video');
if (!VIDEO) throw new Error('usage: stream.ts --video <youtube id> [--every 3] [--from s] [--to s] [--keep]');
const EVERY = Number(opt('every', '3'));
const FROM = Number(opt('from', '0'));
const TO = opt('to') ? Number(opt('to')) : Infinity;
const KEEP = args.includes('--keep');
const S = 3;
const DIR = '.cache/pro/video';
const OUT = `.cache/pro/streams/${VIDEO}.samples.jsonl`;
const CROPS = `.cache/pro/streams/crops-${VIDEO}`;

// ---------- the video ----------

function download(): string {
  mkdirSync(DIR, { recursive: true });
  const have = () => readdirSync(DIR).find((f) => f.startsWith(`${VIDEO}.`) && !f.endsWith('.part'));
  if (!have()) {
    const r = spawnSync(
      'ml/.venv/Scripts/python',
      ['-m', 'yt_dlp', '-q', '--no-progress', '--js-runtimes', 'node', '-f', 'bv*[height<=720][vcodec^=av01]/bv*[height<=720]', '-o', `${DIR}/%(id)s.%(ext)s`, `https://www.youtube.com/watch?v=${VIDEO}`],
      { stdio: 'inherit' },
    );
    if (r.status !== 0 || !have()) throw new Error(`yt-dlp failed for ${VIDEO}`);
  }
  return join(DIR, have()!);
}

/** Serves the one video file with Range support, so the page and the video share an origin (an untainted canvas). */
function serve(file: string): Promise<{ url: string; close: () => void }> {
  const size = statSync(file).size;
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><video id="v" src="/v" muted preload="auto"></video><canvas id="c" width="1280" height="720"></canvas><canvas id="o"></canvas>');
      return;
    }
    const m = (req.headers.range ?? '').match(/bytes=(\d*)-(\d*)/);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : size - 1;
    res.writeHead(m ? 206 : 200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(m ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) });
    createReadStream(file, { start, end }).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, close: () => server.close() })));
}

// ---------- OCR ----------

export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One PowerShell process running Windows' OCR; read(paths) resolves with each image's lines. */
function ocrWorker() {
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/pro/ocr.ps1'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting: ((l: OcrLine[]) => void)[] = [];
  createInterface({ input: ps.stdout }).on('line', (line) => {
    const j = JSON.parse(line) as { lines: OcrLine[] | OcrLine | null };
    waiting.shift()?.(j.lines === null ? [] : Array.isArray(j.lines) ? j.lines : [j.lines]);
  });
  return {
    read: (paths: string[]) =>
      Promise.all(
        paths.map(
          (p) =>
            new Promise<OcrLine[]>((ok) => {
              waiting.push(ok);
              ps.stdin.write(`${p}\n`);
            }),
        ),
      ),
    close: () => ps.stdin.end(),
  };
}

// ---------- the overlay (720p coordinates) ----------

/** The left panel starts at x 0, the right one 1000 px further. */
const PANEL_X = [0, 1000] as const;
/** Bench rows: 5 rows 69 px apart from y 352; the HP bar of a row 54 px below its top. */
const ROW = (k: number) => 352 + 69 * k;

export interface Pixels {
  /** Mean brightness of the inner edge each panel lights while it is that side's turn. */
  glow: [number, number];
  /** Brightness of the six Prize icons of each side, top to bottom. */
  prizes: [number[], number[]];
  /** Share of the HP bar filled: the Active, then the 5 bench rows (0 where the row is empty). */
  bars: [number[], number[]];
  /** Mean colour of the bottom bar, to tell whether the overlay is on screen. */
  frame: [number, number, number];
}

export interface Sample {
  t: number;
  overlay: boolean;
  pixels: Pixels;
  /** OCR lines by crop (left, right, top, lhp, rhp), in 720p coordinates. */
  ocr: Record<string, OcrLine[]>;
}

async function main() {
  const file = download();
  const { url, close } = await serve(file);
  mkdirSync(CROPS, { recursive: true });
  mkdirSync('.cache/pro/streams', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // tsx (esbuild) names the functions sent to the page through a helper the page doesn't have.
  await page.addInitScript({ content: 'window.__name = (f) => f;' });
  await page.goto(url);
  await page.waitForFunction(() => (document.getElementById('v') as HTMLVideoElement).readyState >= 1, null, { timeout: 60000 });
  const duration = await page.evaluate(() => (document.getElementById('v') as HTMLVideoElement).duration);
  const ocr = ocrWorker();
  const lines: string[] = [];
  const end = Math.min(TO, duration - 1);
  const t0 = Date.now();
  for (let t = FROM; t <= end; t += EVERY) {
    const sample = await page.evaluate(
      async ({ t, S, PANEL_X, rows }) => {
        const v = document.getElementById('v') as HTMLVideoElement;
        await new Promise<void>((ok) => {
          v.onseeked = () => ok();
          v.currentTime = t;
        });
        const c = document.getElementById('c') as HTMLCanvasElement;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(v, 0, 0, 1280, 720);
        const px = (x: number, y: number, w: number, h: number) => {
          const d = g.getImageData(x, y, w, h).data;
          let r = 0;
          let gg = 0;
          let b = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i]!;
            gg += d[i + 1]!;
            b += d[i + 2]!;
          }
          const n = d.length / 4;
          return [r / n, gg / n, b / n] as [number, number, number];
        };
        const bright = (x: number, y: number, w: number, h: number) => {
          const [r, gg, b] = px(x, y, w, h);
          return (r + gg + b) / 3;
        };
        /** Share of an HP bar's columns that are coloured (filled) rather than the dark empty track. */
        const fill = (x: number, y: number, w: number) => {
          const d = g.getImageData(x, y, w, 1).data;
          let filled = 0;
          for (let i = 0; i < w; i++) {
            const r = d[i * 4]!;
            const gg = d[i * 4 + 1]!;
            const b = d[i * 4 + 2]!;
            if (Math.max(r, gg, b) - Math.min(r, gg, b) > 60 && Math.max(r, gg, b) > 110) filled++;
          }
          return filled / w;
        };
        const pixels = {
          glow: [bright(267, 120, 8, 460), bright(1005, 120, 8, 460)],
          prizes: [0, 1].map((s) => Array.from({ length: 6 }, (_, i) => bright(s === 0 ? 279 : 991, 6 + 18 * i, 9, 9))),
          bars: PANEL_X.map((x0) => [fill(x0 + 10, 266, 180), ...rows.map((y: number) => fill(x0 + 105, y + 54, 110))]),
          frame: px(0, 700, 1280, 20),
        };
        // Crops for OCR, S times larger: each panel as it is, and its HP column with only near-white pixels kept.
        const o = document.getElementById('o') as HTMLCanvasElement;
        const og = o.getContext('2d')!;
        const crop = (x: number, y: number, w: number, h: number, filter: string) => {
          o.width = w * S;
          o.height = h * S;
          og.filter = filter;
          og.imageSmoothingQuality = 'high';
          og.drawImage(c, x, y, w, h, 0, 0, w * S, h * S);
          return o.toDataURL('image/png');
        };
        const crops = {
          left: crop(0, 0, 280, 720, 'none'),
          right: crop(1000, 0, 280, 720, 'none'),
          top: crop(280, 0, 720, 40, 'none'),
          // White text on coloured bars (HP, and the 2027 overlay's name bars) reads better alone, black on white.
          lhp: crop(0, 50, 280, 650, 'grayscale(1) brightness(0.6) contrast(25) invert(1)'),
          rhp: crop(1000, 50, 280, 650, 'grayscale(1) brightness(0.6) contrast(25) invert(1)'),
        };
        return { pixels, crops };
      },
      { t, S, PANEL_X, rows: [0, 1, 2, 3, 4].map(ROW) },
    );
    const p = sample.pixels as Pixels;
    // No overlay (the desk, a break, a replay): the bottom bar is not its dark blue.
    const [r, gg, b] = p.frame;
    const overlay = b > 60 && b > r + 15 && b > gg;
    let ocrd: Record<string, OcrLine[]> = {};
    if (overlay) {
      const names = Object.keys(sample.crops) as (keyof typeof sample.crops)[];
      // A new file each time: the OCR process may still hold the last one open.
      const paths = names.map((n) => resolve(CROPS, `${n}-${t}.png`));
      names.forEach((n, i) => writeFileSync(paths[i]!, Buffer.from(sample.crops[n].split(',')[1]!, 'base64')));
      const read = await ocr.read(paths);
      for (const f of paths) rmSync(f, { force: true, maxRetries: 3 });
      const shift: Record<string, [number, number]> = { left: [0, 0], right: [1000, 0], top: [280, 0], lhp: [0, 50], rhp: [1000, 50] };
      ocrd = Object.fromEntries(
        names.map((n, i) => {
          const [dx, dy] = shift[n]!;
          // Back to 720p coordinates.
          return [n, read[i]!.map((l) => ({ text: l.text, x: Math.round(l.x / S) + dx, y: Math.round(l.y / S) + dy, w: Math.round(l.w / S), h: Math.round(l.h / S) }))];
        }),
      );
    }
    const out: Sample = { t, overlay, pixels: p, ocr: ocrd };
    lines.push(JSON.stringify(out));
    if (lines.length % 50 === 0) {
      writeFileSync(OUT, `${lines.join('\n')}\n`);
      console.log(`${VIDEO} ${Math.round(t)}/${Math.round(end)} s, ${((Date.now() - t0) / lines.length / 1000).toFixed(2)} s per sample`);
    }
  }
  writeFileSync(OUT, `${lines.join('\n')}\n`);
  ocr.close();
  await browser.close();
  close();
  rmSync(CROPS, { recursive: true, force: true });
  if (!KEEP) rmSync(file);
  console.log(`written ${OUT}: ${lines.length} samples in ${Math.round((Date.now() - t0) / 1000)} s`);
}

await main();
