// Replay a bot game to a point and show what the attack planner sees.
// npx tsx scripts/debug-finish.ts <deckA> <deckB> <seed> <turn>
import { makeBot } from '../src/bots/core';
import { planFinish } from '../src/bots/finisher';
import { planFor } from '../src/bots/plans';
import { actor, apply, createGame, legalActions } from '../src/engine/actions';
import { deckKeys } from '../src/engine/db';
import { energyOf } from '../src/engine/rules';
import { keyOf, slotsOf, topDef } from '../src/engine/state';
import { loadDeckFiles } from './lib/decks';

const files = loadDeckFiles('src/content/decks');
const spec = (slug: string) => ({ name: slug, cards: deckKeys(files.find((d) => d.slug === slug)!.list.entries) });
const [a, b, seed, turn] = process.argv.slice(2);
const plans = [planFor(a!), planFor(b!)];
const bots = [makeBot(plans[0]!, { seed: 1 }), makeBot(plans[1]!, { seed: 2 })];
let s = createGame({ seed: Number(seed), decks: [spec(a!), spec(b!)] });
let lastEnd = s;
while (s.winner === null && s.turn <= Number(turn)) {
  const act = bots[actor(s)]!.act(s);
  if (!s.pending && s.turn === Number(turn) && act.t === 'end') {
    lastEnd = s;
    break;
  }
  s = apply(s, act);
}
s = lastEnd;
const me = s.current;
for (const p of [0, 1] as const) {
  console.log(`p${p}:`, slotsOf(s.players[p]).map((sl) => `${topDef(s, sl).name}[${energyOf(s, sl).join(',')}] dmg${sl.damage}`).join(' | '));
}
console.log('hand:', s.players[me].hand.map((c) => keyOf(s, c)).join(', '));
console.log('legal:', legalActions(s).map((x) => JSON.stringify(x)).join('\n  '));
const fin = planFinish(s, me, plans[me]!, 7);
console.log('finish:', JSON.stringify(fin, null, 1));
