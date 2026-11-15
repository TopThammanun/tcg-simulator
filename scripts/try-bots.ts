// Quick look at bot-vs-bot games: npx tsx scripts/try-bots.ts [games] [deckA] [deckB]
import { makeBot } from '../src/bots/core';
import { planFor } from '../src/bots/plans';
import { deckKeys } from '../src/engine/db';
import { playGame } from '../src/sim/game';
import { loadDeckFiles } from './lib/decks';

const files = loadDeckFiles('src/content/decks');
const spec = (slug: string) => {
  const f = files.find((d) => d.slug === slug)!;
  return { name: slug, cards: deckKeys(f.list.entries) };
};
const n = Number(process.argv[2] ?? 20);
const a = process.argv[3] ?? 'player';
const opponents = process.argv[4] ? [process.argv[4]] : files.filter((f) => f.meta.side === 'bot').map((f) => f.slug);

for (const b of opponents) {
  let wins = 0;
  let turns = 0;
  let maxThink = 0;
  let maxTurnThink = 0;
  const reasons: Record<string, number> = {};
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const r = playGame({
      seed: 100 + i,
      decks: [spec(a), spec(b)],
      bots: [makeBot(planFor(a), { seed: i * 2 + 1 }), makeBot(planFor(b), { seed: i * 2 + 2 })],
      checkInvariants: true,
    });
    if (r.winner === 0) wins++;
    turns += r.turns;
    maxThink = Math.max(maxThink, r.maxThinkMs);
    maxTurnThink = Math.max(maxTurnThink, ...r.thinkMsByTurn);
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  console.log(
    `${a} vs ${b}: ${wins}/${n} wins, avg ${(turns / n).toFixed(1)} turns, ${((Date.now() - t0) / n).toFixed(0)} ms/game, ` +
      `max decision ${maxThink.toFixed(0)} ms, max turn ${maxTurnThink.toFixed(0)} ms`,
    reasons,
  );
}
