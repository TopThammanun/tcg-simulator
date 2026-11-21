// The decks' experts on the web (BOT-NEXT.md N1): one network per bot deck, trained from the bundled one to play
// that deck only. Each file is its own chunk (float16, tensor.ts), so a game downloads the bot's deck's expert
// and nothing else; a deck without one, or a download that fails, plays from the bundled network.
// Node scripts read the same folder with scripts/lib/experts.ts (Vite's glob import is not there).
import { loadModel, type Model, type ModelJson } from './learn/model';

const EXPERTS = import.meta.glob<ModelJson>('./learn/experts/*.json', { import: 'default' });

/** The expert for a deck slug, or null (none, or it failed to load). */
export async function expertFor(slug: string): Promise<Model | null> {
  const load = EXPERTS[`./learn/experts/${slug}.json`];
  if (!load) return null;
  try {
    return loadModel(await load());
  } catch {
    return null;
  }
}
