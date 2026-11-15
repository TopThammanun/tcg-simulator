// Print one bot-vs-bot game log: npx tsx scripts/show-game.ts <deckA> <deckB> [seed] [fromTurn] [toTurn]
import { makeBot } from '../src/bots/core';
import { planFor } from '../src/bots/plans';
import { deckKeys } from '../src/engine/db';
import { playGame } from '../src/sim/game';
import { loadDeckFiles } from './lib/decks';

const files = loadDeckFiles('src/content/decks');
const spec = (slug: string) => ({ name: slug, cards: deckKeys(files.find((d) => d.slug === slug)!.list.entries) });
const [a = 'player', b = 'festival-lead-seaking', seed = '1', from = '0', to = '99'] = process.argv.slice(2);
const r = playGame({
  seed: Number(seed),
  decks: [spec(a), spec(b)],
  bots: [makeBot(planFor(a), { seed: 1 }), makeBot(planFor(b), { seed: 2 })],
  record: true,
});
for (const e of r.final.log) if (e.turn >= Number(from) && e.turn <= Number(to)) console.log(`${String(e.turn).padStart(2)} ${e.text}`);
console.log('winner', r.winner, r.reason, 'turns', r.turns);
