// A float16 weights file (ml/half.py) against the float32 one it came from: the share of decisions where the two
// pick the same option, over games the float32 network plays against itself on every deck pair.
//   npx tsx scripts/learn/half-check.ts <f32.json> <f16.json> [games per deck pair]
import { readFileSync } from 'node:fs';
import { loadModel, run, type ModelJson } from '../../src/bots/learn/model';
import { makeNetBot } from '../../src/bots/learn/netbot';
import { planFor } from '../../src/bots/plans';
import { deckKeys } from '../../src/engine/db';
import { playGame } from '../../src/sim/game';
import { loadDeckFiles } from '../lib/decks';

const [f32Path, f16Path, perPair = '2'] = process.argv.slice(2);
if (!f32Path || !f16Path) throw new Error('usage: half-check.ts <f32.json> <f16.json> [games per deck pair]');
const full = loadModel(JSON.parse(readFileSync(f32Path, 'utf8')) as ModelJson);
const half = loadModel(JSON.parse(readFileSync(f16Path, 'utf8')) as ModelJson);
const files = loadDeckFiles('src/content/decks');
const best = (xs: Float32Array) => xs.reduce((b, x, i) => (x > xs[b]! ? i : b), 0);

let decisions = 0;
let same = 0;
let worstValue = 0;
let seed = 1;
for (const a of files) {
  for (const b of files) {
    for (let g = 0; g < Number(perPair); g++, seed++) {
      const bots = [a, b].map((d, i) =>
        makeNetBot(full, {
          decks: [planFor(d.slug).name, planFor([b, a][i]!.slug).name],
          onDecision: (dec) => {
            const h = run(half, dec.enc);
            decisions++;
            if (best(h.logits) === dec.chosen) same++;
            worstValue = Math.max(worstValue, Math.abs(h.value - dec.value));
          },
        }),
      );
      const spec = (d: typeof a) => ({ name: d.slug, cards: deckKeys(d.list.entries) });
      playGame({ seed, decks: [spec(a), spec(b)], bots: [bots[0]!, bots[1]!] });
    }
  }
}
console.log(JSON.stringify({ decisions, same: same / decisions, worstValueDiff: worstValue }));
