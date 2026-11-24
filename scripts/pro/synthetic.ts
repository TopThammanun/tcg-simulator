// Stand-in "pro" games for trying the P1 ruler before real transcripts exist (BOT-PRO.md): the rule-based hard bot
// plays both sides of a transcribed game, naming each card only as it is played or picked, the way a transcriber of a
// broadcast that never shows the hands would; the rest stay unseen. The ruler's agreement of the hard bot with these
// games should be high (not 100%: the unseen cards are dealt again), the network's lower.
//   npx tsx scripts/pro/synthetic.ts [--games 6] [--out .cache/pro/synthetic.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeHardBot } from '../../src/bots/hard';
import { planFor } from '../../src/bots/plans';
import { actor } from '../../src/engine/actions';
import { keyOf } from '../../src/engine/state';
import { gamesFile } from '../../src/review/record';
import { act, current, isKnown, name, startTranscript, toSaved, verify, type Transcript } from '../../src/ui/transcribe';
import { loadDeckFiles } from '../lib/decks';
import { deckKeys } from '../../src/engine/db';

const opt = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const GAMES = Number(opt('games', '6'));
const OUT = opt('out', '.cache/pro/synthetic.json');

const decks = loadDeckFiles('src/content/decks').filter((d) => d.meta.side === 'bot');
const games = [];
for (let n = 0; n < GAMES; n++) {
  const a = decks[n % decks.length]!;
  const b = decks[(n * 3 + 1) % decks.length]!;
  let t: Transcript = startTranscript({
    decks: [deckKeys(a.list.entries), deckKeys(b.list.entries)],
    names: [`Hard ${a.slug}`, `Hard ${b.slug}`],
    plans: [a.slug, b.slug],
    pro: { event: 'synthetic', round: `game ${n + 1}`, players: [`Hard ${a.slug}`, `Hard ${b.slug}`], source: 'other' },
    seed: 100 + n,
  });
  const bots = [makeHardBot(planFor(a.slug), planFor(b.slug), { seed: n }), makeHardBot(planFor(b.slug), planFor(a.slug), { seed: n + 1 })];
  for (let steps = 0; steps < 1500 && current(t).winner === null; steps++) {
    const s = current(t);
    const move = bots[actor(s)]!.act(s);
    if ('card' in move && !isKnown(s, move.card)) t = name(t, move.card, keyOf(s, move.card)).t;
    else if (move.t === 'choose') {
      for (const v of move.picks) {
        const o = current(t).pending!.request.options.find((x) => x.value === v);
        if (o?.card !== undefined && !isKnown(current(t), o.card)) t = name(t, o.card, keyOf(current(t), o.card)).t;
      }
    }
    t = act(t, move);
  }
  const problems = verify(t);
  if (problems.length) throw new Error(`game ${n + 1}: ${problems.join('; ')}`);
  const g = toSaved(t);
  games.push(g);
  console.log(`game ${n + 1}: ${a.slug} vs ${b.slug}, ${g.turns} turns, ${g.actions.length} moves, ${g.script!.known.length} cards seen, ${g.reason}`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(gamesFile(games)));
console.log(`written ${OUT}`);
