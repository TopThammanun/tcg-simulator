import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Cached JSON/HEAD fetching for build scripts. Responses are kept in .cache/http so re-runs
// don't hit the APIs again (pass refresh to re-download). pokemontcg.io answers ~1 in 5
// requests with a 502, so failures are retried with backoff.

interface CacheEntry {
  url: string;
  status: number;
  body?: unknown;
}

export interface Http {
  getJson<T>(url: string, init?: { headers?: Record<string, string> }): Promise<T | undefined>;
  exists(url: string): Promise<boolean>;
}

export function createHttp(opts: { cacheDir: string; refresh?: boolean; concurrency?: number }): Http {
  mkdirSync(opts.cacheDir, { recursive: true });
  const limits = new Map<string, Limiter>();
  const limiterFor = (url: string) => {
    const host = new URL(url).host;
    if (!limits.has(host)) limits.set(host, limiter(opts.concurrency ?? 4));
    return limits.get(host)!;
  };

  async function cached(kind: 'json' | 'head', url: string, load: () => Promise<CacheEntry>) {
    const file = join(opts.cacheDir, `${kind}-${createHash('sha1').update(url).digest('hex')}.json`);
    if (!opts.refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as CacheEntry;
    const entry = await limiterFor(url)(() => withRetry(url, load));
    writeFileSync(file, JSON.stringify(entry));
    return entry;
  }

  return {
    async getJson<T>(url: string, init?: { headers?: Record<string, string> }) {
      const entry = await cached('json', url, async () => {
        const res = await fetch(url, { headers: init?.headers, signal: AbortSignal.timeout(60_000) });
        if (res.status === 404) return { url, status: 404 };
        const text = await res.text();
        if (!res.ok) throw new RetryableError(`HTTP ${res.status}: ${text.slice(0, 80)}`);
        try {
          return { url, status: res.status, body: JSON.parse(text) };
        } catch {
          throw new RetryableError(`not JSON: ${text.slice(0, 80)}`);
        }
      });
      return entry.status === 404 ? undefined : (entry.body as T);
    },

    async exists(url: string) {
      const entry = await cached('head', url, async () => {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
        if (res.status >= 500 || res.status === 429) throw new RetryableError(`HTTP ${res.status}`);
        return { url, status: res.status };
      });
      return entry.status >= 200 && entry.status < 300;
    },
  };
}

class RetryableError extends Error {}

async function withRetry<T>(url: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retryable = e instanceof RetryableError || (e as Error).name === 'TimeoutError' || e instanceof TypeError;
      if (!retryable || i >= attempts) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

function limiter(max: number): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];
  return async (fn) => {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
