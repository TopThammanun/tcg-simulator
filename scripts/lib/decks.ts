import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { deckMetaSchema, type DeckMeta } from '../../src/data/deck-meta';
import { parseDecklist, type ParsedDecklist } from '../../src/data/decklist';

export interface DeckFile {
  slug: string;
  meta: DeckMeta;
  list: ParsedDecklist;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

// Node-side reader for the same files the Astro content collection loads.
export function loadDeckFiles(dir: string): DeckFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const slug = basename(f, '.md');
      const m = readFileSync(join(dir, f), 'utf8').match(FRONTMATTER_RE);
      if (!m) throw new Error(`${f}: missing frontmatter`);
      try {
        return { slug, meta: deckMetaSchema.parse(parseYaml(m[1]!)), list: parseDecklist(m[2]!) };
      } catch (e) {
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    });
}
