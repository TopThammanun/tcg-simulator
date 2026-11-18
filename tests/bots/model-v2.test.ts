import { describe, expect, it } from 'vitest';
import { CARD_F, cardFeatures, featureTable } from '../../src/bots/learn/card-features';
import { CARD_KEYS, encode, VOCAB } from '../../src/bots/learn/encode';
import { GLOB_KEEP, loadModel, run, v2Shapes, type ModelJson } from '../../src/bots/learn/model';
import { makeNetBot } from '../../src/bots/learn/netbot';
import { CARDS } from '../../src/engine/db';
import { actor, apply, createGame } from '../../src/engine/actions';
import { deck } from '../engine/helpers';

const DIMS = { E: 8, SH: 12, BAGD: 4, H: 16, OH: 8 };

/** A version-2 file with random weights, trained with `cards` (keys of id.emb rows 2+). */
function randomV2(cards: string[], seed = 3): ModelJson {
  let a = seed;
  const r = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296) * 2 - 1;
  const tensors: ModelJson['tensors'] = {};
  for (const [name, shape] of Object.entries(v2Shapes(DIMS, cards.length))) {
    const n = shape.reduce((x, y) => x * y, 1);
    const f = Float32Array.from({ length: n }, () => r() * 0.3);
    tensors[name] = { shape, data: Buffer.from(f.buffer).toString('base64') };
  }
  return { version: 2, cards, dims: { ...DIMS, SLOT_F: 44, GLOB_F: 83, OPT_F: 30, CARD_F }, tensors };
}

describe('card features', () => {
  it('every card has the same number of features, and the text flags read the card', () => {
    for (const k of CARD_KEYS) expect(cardFeatures(CARDS[k]!)).toHaveLength(CARD_F);
    const flags = (k: string) => cardFeatures(CARDS[k]!).slice(-30);
    // Boss's Orders brings up a Benched Pokémon (gust); Ultra Ball searches for a Pokémon.
    expect(flags('bosss-orders').some((x) => x === 1)).toBe(true);
    expect(featureTable(CARD_KEYS)).toHaveLength((CARD_KEYS.length + 1) * CARD_F);
  });
});

describe('version 2 network', () => {
  it('loads, plays a game, and leaves the deck-name globals out', () => {
    const m = loadModel(randomV2([...CARD_KEYS]));
    expect(m.glob).toEqual(GLOB_KEEP);
    expect(m.t.emb).toHaveLength(VOCAB * DIMS.E);
    const bots = [0, 1].map((i) => makeNetBot(m, { decks: ['player', 'Dragapult ex'], seed: i, temperature: 1 }));
    let s = createGame({ seed: 9, decks: [deck('player'), deck('dragapult-ex')], quiet: true });
    for (let n = 0; s.winner === null && n < 3000; n++) s = apply(s, bots[actor(s)]!.act(s), { trusted: true });
    expect(s.winner).not.toBeNull();
  });

  it('a card it was not trained with gets the "unknown" vector plus its own features; the rest keep theirs', () => {
    const all = [...CARD_KEYS];
    const without = all.filter((k) => k !== 'slowking');
    const full = randomV2(all);
    const partial = { ...full, cards: without };
    // Same weights, one card fewer known: id rows must line up with the shorter list.
    const rows = full.tensors['id.emb']!;
    const f = new Float32Array(Buffer.from(rows.data, 'base64').buffer.slice(0));
    const keep = [0, 1, ...without.map((k) => all.indexOf(k) + 2)];
    const g = new Float32Array(keep.length * DIMS.E);
    keep.forEach((r, i) => g.set(f.subarray(r * DIMS.E, r * DIMS.E + DIMS.E), i * DIMS.E));
    partial.tensors = { ...full.tensors, 'id.emb': { shape: [keep.length, DIMS.E], data: Buffer.from(g.buffer).toString('base64') } };
    const a = loadModel(full).t.emb!;
    const b = loadModel(partial).t.emb!;
    const row = (t: Float32Array, k: string) => Array.from(t.subarray((all.indexOf(k) + 1) * DIMS.E, (all.indexOf(k) + 2) * DIMS.E));
    expect(row(b, 'kyurem')).toEqual(row(a, 'kyurem'));
    expect(row(b, 'slowking')).not.toEqual(row(a, 'slowking'));
    // Two unknown cards still differ from each other, through their features.
    const unknownBoth = { ...partial, cards: without.filter((k) => k !== 'slowpoke'), tensors: { ...partial.tensors } };
    const keep2 = [0, 1, ...unknownBoth.cards.map((k) => all.indexOf(k) + 2)];
    const g2 = new Float32Array(keep2.length * DIMS.E);
    keep2.forEach((r, i) => g2.set(f.subarray(r * DIMS.E, r * DIMS.E + DIMS.E), i * DIMS.E));
    unknownBoth.tensors['id.emb'] = { shape: [keep2.length, DIMS.E], data: Buffer.from(g2.buffer).toString('base64') };
    const c = loadModel(unknownBoth).t.emb!;
    expect(row(c, 'slowking')).not.toEqual(row(c, 'slowpoke'));
    const s = createGame({ seed: 1, decks: [deck('slowking'), deck('player')], quiet: true });
    const out = run(loadModel(partial), encode(s, { decks: ['Slowking Seek Inspiration', 'player'] }));
    expect(Number.isFinite(out.value)).toBe(true);
  });
});
