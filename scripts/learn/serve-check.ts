// Parity of the inference server (ml/serve.py) with the TypeScript forward pass (model.ts), on the decisions of a
// few network games. The server sees the rows as the shards store them (float16, Pokémon counts in quarters), so
// it is compared with model.ts on those same rounded inputs; the gap to the unrounded inputs is printed too.
//   ml/.venv/Scripts/python ml/serve_check.py <weights.json> [games]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encode, type Encoded } from '../../src/bots/learn/encode';
import { loadModel, run, type ModelJson } from '../../src/bots/learn/model';
import { planFor } from '../../src/bots/plans';
import { makeNetBot } from '../../src/bots/learn/netbot';
import { actor, apply, createGame } from '../../src/engine/actions';
import { deckKeys } from '../../src/engine/db';
import { loadDeckFiles } from '../lib/decks';
import { serverClient, type Ask } from './batched';
import { roundHalf } from './shard';

const [port, weights, gamesArg] = process.argv.slice(2);
const path = resolve(weights!);
const model = loadModel(JSON.parse(readFileSync(path, 'utf8')) as ModelJson);
const files = loadDeckFiles('src/content/decks');
const client = serverClient(Number(port));

const rounded = (e: Encoded): Encoded => ({
  ...e,
  slots: e.slots.map(roundHalf),
  glob: e.glob.map(roundHalf),
  optX: e.optX.map(roundHalf),
  bags: e.bags.map((b) => Math.min(255, Math.round(b * 4)) / 4),
});

let rows = 0;
let same = 0;
let d16 = 0;
let d32 = 0;
let dv = 0;
for (let g = 0; g < Number(gamesArg ?? 4); g++) {
  const a = files[g % files.length]!;
  const b = files[(g * 3 + 1) % files.length]!;
  const asks: Ask[] = [];
  const decks = [planFor(a.slug).name, planFor(b.slug).name] as const;
  const bots = [
    makeNetBot(model, { decks, seed: 1, onDecision: (d) => asks.push({ enc: d.enc, model: path }) }),
    makeNetBot(model, { decks: [decks[1], decks[0]], seed: 2, onDecision: (d) => asks.push({ enc: d.enc, model: path }) }),
  ];
  let s = createGame({ seed: 500 + g, decks: [{ name: 'a', cards: deckKeys(a.list.entries) }, { name: 'b', cards: deckKeys(b.list.entries) }], quiet: true });
  for (let n = 0; s.winner === null && n < 4000; n++) s = apply(s, bots[actor(s)]!.act(s), { trusted: true });
  const answers = await client.infer(asks);
  asks.forEach((ask, i) => {
    const srv = answers[i]!;
    const full = run(model, ask.enc);
    const half = run(model, rounded(ask.enc));
    let best = 0;
    for (let k = 0; k < srv.logits.length; k++) {
      d16 = Math.max(d16, Math.abs(srv.logits[k]! - half.logits[k]!));
      d32 = Math.max(d32, Math.abs(srv.logits[k]! - full.logits[k]!));
      if (srv.logits[k]! > srv.logits[best]!) best = k;
    }
    let bestTs = 0;
    for (let k = 1; k < full.logits.length; k++) if (full.logits[k]! > full.logits[bestTs]!) bestTs = k;
    same += best === bestTs ? 1 : 0;
    dv = Math.max(dv, Math.abs(srv.value - half.value));
    rows++;
  });
}
client.close();
console.log(JSON.stringify({ rows, logitGapRounded: d16, logitGapUnrounded: d32, valueGapRounded: dv, sameBest: same / rows }));
