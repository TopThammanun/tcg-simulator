// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  // The site's address (SITE_URL=https://… npm run build): canonical, hreflang, sitemap, Open Graph and JSON-LD
  // addresses are absolute once it is set, as search engines and shared links want them; without it they are paths.
  site: process.env.SITE_URL || undefined,
  integrations: [svelte()],
  // Workers as ES modules (they are created with { type: 'module' }), so the bot's worker can load one deck's
  // expert as its own chunk (src/bots/experts.ts): IIFE workers can't be split.
  vite: { worker: { format: 'es' } },
});
