import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { deckMetaSchema } from './data/deck-meta';

// Decklists in Limitless export format; the body is parsed with src/data/decklist.ts.
const decks = defineCollection({
  loader: glob({ base: './src/content/decks', pattern: '*.md' }),
  schema: deckMetaSchema,
});

export const collections = { decks };
