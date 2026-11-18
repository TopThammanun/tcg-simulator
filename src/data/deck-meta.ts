import { z } from 'astro/zod';

// Frontmatter of src/content/decks/*.md — shared by the content collection and build scripts.
export const deckMetaSchema = z
  .object({
    name: z.string(),
    side: z.enum(['player', 'bot']),
    rank: z.number().int().positive().optional(),
    metaShare: z.number().positive().optional(),
    archetypeUrl: z.url().optional(),
    /** The archetype's id on play.limitlesstcg.com (data/meta/limitless.json): real results to compare with. */
    limitless: z.string().optional(),
    listUrl: z.url().optional(),
    listSource: z.string(),
    optional: z.boolean().default(false),
    variant: z.string().optional(),
  })
  .refine((d) => d.side === 'player' || (d.rank !== undefined && d.metaShare !== undefined), {
    message: 'bot decks need rank and metaShare',
  });

export type DeckMeta = z.infer<typeof deckMetaSchema>;
