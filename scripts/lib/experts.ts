// The decks' experts for Node scripts (src/bots/experts.ts is the web's): src/bots/learn/experts/<slug>.json, read
// once. Pass expertModel's result to createBot's `model`, so scripts measure the bot the play screen plays.
// An expert set in general is a folder of <deck slug>.json files with default.json for the other decks (gen.ts).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, type Model, type ModelJson } from '../../src/bots/learn/model';

export const BOT_WEIGHTS = fileURLToPath(new URL('../../src/bots/learn/weights.json', import.meta.url));
export const BOT_EXPERTS = fileURLToPath(new URL('../../src/bots/learn/experts', import.meta.url));

const resolved = new Map<string, string>();
/**
 * The weights file a deck plays from: `path` itself when it is a file; in an expert set, its <slug>.json, else
 * default.json, else `fallback`; `fallback` too when `path` does not exist.
 */
export function expertWeights(path: string, slug: string, fallback?: string): string {
  const key = `${path}|${slug}`;
  let w = resolved.get(key);
  if (w === undefined) {
    if (existsSync(path) && statSync(path).isDirectory()) {
      const own = join(path, `${slug}.json`);
      const other = join(path, 'default.json');
      w = existsSync(own) ? own : existsSync(other) ? other : fallback;
      if (!w) throw new Error(`expert set ${path} has neither ${slug}.json nor default.json`);
    } else w = !existsSync(path) && fallback ? fallback : path;
    w = resolve(w);
    resolved.set(key, w);
  }
  return w;
}

const cache = new Map<string, Model | null>();

/** The game's expert for a deck slug, or null (the bundled network plays that deck). */
export function expertModel(slug: string): Model | null {
  if (!cache.has(slug)) {
    const path = join(BOT_EXPERTS, `${slug}.json`);
    cache.set(slug, existsSync(path) ? loadModel(JSON.parse(readFileSync(path, 'utf8')) as ModelJson) : null);
  }
  return cache.get(slug)!;
}
