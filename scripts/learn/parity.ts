// Training/serving parity: play a few games with a network, write the decisions as a shard, and the
// TypeScript forward pass (on the same float16-rounded inputs) as JSON; ml/parity.py compares PyTorch.
//   npx tsx scripts/learn/parity.ts <model.json> <out dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadModel, run, type ModelJson } from '../../src/bots/learn/model';
import { makeNetBot, type Decision } from '../../src/bots/learn/netbot';
import { planFor } from '../../src/bots/plans';
import { actor, apply, createGame } from '../../src/engine/actions';
import { deckKeys } from '../../src/engine/db';
import { loadDeckFiles } from '../lib/decks';
import { roundHalf, ShardWriter } from './shard';

const [modelPath, out] = process.argv.slice(2);
const model = loadModel(JSON.parse(readFileSync(modelPath!, 'utf8')) as ModelJson);
const files = loadDeckFiles('src/content/decks');
mkdirSync(out!, { recursive: true });
const shard = new ShardWriter();
const expected: { value: number; logits: number[] }[] = [];
const round = (a: Float32Array) => a.map(roundHalf);
for (let g = 0; g < 4; g++) {
  const a = files[g % files.length]!;
  const b = files[(g + 3) % files.length]!;
  const record = (d: Decision) => {
    // Same inputs training sees: floats through float16, bags as whole counts.
    const enc = { ...d.enc, slots: round(d.enc.slots), glob: round(d.enc.glob), optX: round(d.enc.optX), bags: d.enc.bags.map((v) => Math.min(255, Math.round(v * 4)) / 4) };
    const o = run(model, enc);
    expected.push({ value: o.value, logits: Array.from(o.logits) });
    shard.add({ ...d, enc });
  };
  const bots = [0, 1].map((i) =>
    makeNetBot(model, { decks: [planFor(i ? b.slug : a.slug).name, planFor(i ? a.slug : b.slug).name], seed: g * 2 + i, temperature: 1, onDecision: record }),
  );
  let s = createGame({ seed: 4242 + g, decks: [{ name: 'a', cards: deckKeys(a.list.entries) }, { name: 'b', cards: deckKeys(b.list.entries) }], quiet: true });
  shard.beginGame(g);
  for (let n = 0; s.winner === null && n < 4000; n++) s = apply(s, bots[actor(s)]!.act(s), { trusted: true });
  shard.endGame(s.winner);
}
shard.write(`${out}/shard-0.bin`);
writeFileSync(`${out}/expected.json`, JSON.stringify(expected));
console.log(`${expected.length} decisions`);
