// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],
  // Workers as ES modules (they are created with { type: 'module' }), so the bot's worker can load one deck's
  // expert as its own chunk (src/bots/experts.ts): IIFE workers can't be split.
  vite: { worker: { format: 'es' } },
});
