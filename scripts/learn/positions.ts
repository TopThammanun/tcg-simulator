// Positions to start training games from (BOT-NEXT.md N2): bot games of one deck against every deck, keeping
// the turns where a predicate holds, written as a games file (the review page's format) whose games name their
// own `starts` and the seat the learning network takes (`seatA`). ppo.py --starts <file> then begins a share of
// its games there, so the network meets those positions far more often than random play would bring it to them.
//   npx tsx scripts/learn/positions.ts --deck slowking --games 400 --out .cache/learn/slowking-ready.json [--weights <file or expert set>]
// Predicates: slowking-ready = the Slowking side's turn begins with Slowking Active and a way to set the top card
// (Academy at Night in play or in hand, or Ciphermaniac's Codebreaking in hand).
import { readFileSync, writeFileSync } from 'node:fs';
import { createBot, MODEL } from '../../src/bots';
import { loadModel, type Model, type ModelJson } from '../../src/bots/learn/model';
import { planFor } from '../../src/bots/plans';
import { actor, apply, createGame } from '../../src/engine/actions';
import { deckKeys } from '../../src/engine/db';
import { keyOf, RULES_VERSION, topKey } from '../../src/engine/state';
import type { Action, GameState, PlayerId } from '../../src/engine/types';
import type { SavedGame } from '../../src/review/record';
import { DEFAULT_POLICY } from '../../src/bots/plans';
import { loadDeckFiles } from '../lib/decks';
import { expertModel, expertWeights } from '../lib/experts';
import type { StartGame } from './gen';

const PREDICATES: Record<string, (s: GameState, me: PlayerId) => boolean> = {
  'slowking-ready': (s, me) => {
    const ps = s.players[me];
    if (!ps.active || topKey(s, ps.active) !== 'slowking') return false;
    const inHand = (k: string) => ps.hand.some((c) => keyOf(s, c) === k);
    const academy = s.stadium !== null && keyOf(s, s.stadium.card) === 'academy-at-night';
    return academy || inHand('academy-at-night') || inHand('ciphermaniacs-codebreaking');
  },
};

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const deck = arg('deck') ?? 'slowking';
const per = Number(arg('games') ?? 400);
const out = arg('out') ?? `.cache/learn/${deck}-positions.json`;
const test = PREDICATES[arg('predicate') ?? 'slowking-ready']!;
const files = loadDeckFiles('src/content/decks');
const cards = (slug: string) => deckKeys(files.find((f) => f.slug === slug)!.list.entries);
const weights = arg('weights');
const models = new Map<string, Model>();
const modelFor = (slug: string): Model | null => {
  if (!weights) return expertModel(slug) ?? MODEL;
  const w = expertWeights(weights, slug);
  if (!models.has(w)) models.set(w, loadModel(JSON.parse(readFileSync(w, 'utf8')) as ModelJson));
  return models.get(w)!;
};

const games: StartGame[] = [];
let found = 0;
for (let g = 0; g < per; g++) {
  // The deck is always seat 0 ("you" in the file), its opponent cycles through every deck.
  const other = files[g % files.length]!.slug;
  const seed = 6_000_000 + g;
  const bots = [deck, other].map((d, i) => createBot(planFor(d), seed * 2 + i, planFor([deck, other][1 - i]!), { fast: true, model: modelFor(d) }));
  let s = createGame({ seed, decks: [{ name: 'คุณ', cards: cards(deck) }, { name: 'บอท', cards: cards(other) }], names: ['คุณ', 'บอท'], quiet: true });
  const actions: Action[] = [];
  const starts: number[] = [];
  let turn = -1;
  for (let n = 0; s.winner === null && n < 4000; n++) {
    // The first free position of the deck's turn (states[actions.length] is this one).
    if (!s.pending && s.phase === 'main' && s.turn !== turn) {
      turn = s.turn;
      if (s.current === 0 && s.turn >= 2 && test(s, 0)) starts.push(actions.length);
    }
    const a = bots[actor(s)]!.act(s);
    actions.push(a);
    s = apply(s, a, { trusted: true });
  }
  if (!starts.length) continue;
  found += starts.length;
  const saved: SavedGame = {
    savedAt: 0,
    seed,
    opponent: other,
    opponentName: other,
    mine: deck,
    mineName: deck,
    rules: { version: RULES_VERSION },
    policy: DEFAULT_POLICY,
    decks: [cards(deck), cards(other)],
    actions,
    winner: s.winner,
    reason: s.winReason,
    turns: s.turn,
  };
  games.push({ ...saved, starts, seatA: 0 });
}
writeFileSync(out, JSON.stringify({ format: 'tcg-sim-games', version: 1, games }));
console.log(`${games.length} of ${per} games had ${found} positions (${deck}, ${arg('predicate') ?? 'slowking-ready'}) -> ${out}`);
