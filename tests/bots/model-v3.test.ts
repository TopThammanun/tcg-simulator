// Network version 3 in TypeScript (model3.ts): a random network in the file layout ml/net3.py writes runs on real
// positions. Its agreement with PyTorch is checked by scripts/learn/parity.ts + ml/parity.py on trained networks.
import { describe, expect, it } from 'vitest';
import { CARD_F } from '../../src/bots/learn/card-features';
import { BAGS, CARD_KEYS, encode, OPT_F, SLOT_F } from '../../src/bots/learn/encode';
import { GLOB_KEEP, loadModel, run, type ModelJson } from '../../src/bots/learn/model';
import { planFor } from '../../src/bots/plans';
import { makeBot } from '../../src/bots/core';
import { actor, apply, createGame, legalActions } from '../../src/engine/actions';
import { playGame } from '../../src/sim/game';
import type { GameState } from '../../src/engine/types';
import { deck } from '../engine/helpers';

const dims = { E: 8, D: 16, L: 2, HEADS: 4, FF: 24, C: 64 };

function randomV3(seed = 3): ModelJson {
  let a = seed;
  const r = () => {
    a = (a * 1103515245 + 12345) >>> 0;
    return (a / 2 ** 32) * 2 - 1;
  };
  const { E, D, L, FF } = dims;
  const shapes: Record<string, number[]> = {
    'id_emb.weight': [CARD_KEYS.length + 2, E],
    'feat.weight': [E, CARD_F],
    'feat.bias': [E],
    kind: [4, D],
    'norm.weight': [D],
    'norm.bias': [D],
    'q.weight': [D, D],
    'k.weight': [D, D],
    'k.bias': [D],
    'score.weight': [1, D],
    'score.bias': [1],
  };
  const mlp = (name: string, nin: number, hidden: number, nout: number) =>
    Object.assign(shapes, { [`${name}.a.weight`]: [hidden, nin], [`${name}.a.bias`]: [hidden], [`${name}.b.weight`]: [nout, hidden], [`${name}.b.bias`]: [nout] });
  mlp('glob_in', GLOB_KEEP.length + E, D, D);
  mlp('slot_in', 2 * E + SLOT_F, D, D);
  mlp('card_in', E + BAGS, D, D);
  mlp('opt_in', E + OPT_F + D, D, D);
  mlp('value', 2 * D, 2 * D, 1);
  for (let l = 0; l < L; l++) {
    Object.assign(shapes, {
      [`blocks.${l}.ln1.weight`]: [D],
      [`blocks.${l}.ln1.bias`]: [D],
      [`blocks.${l}.qkv.weight`]: [3 * D, D],
      [`blocks.${l}.qkv.bias`]: [3 * D],
      [`blocks.${l}.out.weight`]: [D, D],
      [`blocks.${l}.out.bias`]: [D],
      [`blocks.${l}.ln2.weight`]: [D],
      [`blocks.${l}.ln2.bias`]: [D],
      [`blocks.${l}.ff1.weight`]: [FF, D],
      [`blocks.${l}.ff1.bias`]: [FF],
      [`blocks.${l}.ff2.weight`]: [D, FF],
      [`blocks.${l}.ff2.bias`]: [D],
    });
  }
  const tensors: ModelJson['tensors'] = {};
  for (const [name, shape] of Object.entries(shapes)) {
    const n = shape.reduce((x, y) => x * y, 1);
    const f = Float32Array.from({ length: n }, () => (name.includes('ln') || name.startsWith('norm') ? (name.endsWith('weight') ? 1 : 0) : r() * 0.3));
    tensors[name] = { shape, data: Buffer.from(f.buffer).toString('base64') };
  }
  return {
    version: 3,
    cards: [...CARD_KEYS],
    dims: { ...dims, SLOT_F, GLOB_F: 83, OPT_F, CARD_F } as unknown as ModelJson['dims'],
    tensors,
  };
}

describe('network version 3 (model3.ts)', () => {
  const model = loadModel(randomV3());
  // Positions from a game of the rule-based bots, decisions with more than one option.
  const g = playGame({ seed: 9, decks: [deck('dragapult-ex'), deck('basic-box')], bots: [makeBot(planFor('dragapult-ex'), { seed: 1 }), makeBot(planFor('basic-box'), { seed: 2 })], record: true });
  let s = createGame({ seed: 9, decks: [deck('dragapult-ex'), deck('basic-box')], quiet: true });
  const positions: GameState[] = [];
  for (const a of g.history!) {
    if (!s.pending && legalActions(s).length > 1) positions.push(s);
    s = apply(s, a, { trusted: true });
  }

  it('gives a chance to win and a logit per option on real positions', () => {
    expect(positions.length).toBeGreaterThan(10);
    for (const p of positions.slice(0, 30)) {
      const me = actor(p);
      const enc = encode(p, { decks: me === 0 ? ['Dragapult ex', 'basic-box'] : ['basic-box', 'Dragapult ex'] });
      const o = run(model, enc);
      expect(o.value).toBeGreaterThan(0);
      expect(o.value).toBeLessThan(1);
      expect(o.logits).toHaveLength(enc.optCard.length);
      for (const l of o.logits) expect(Number.isFinite(l)).toBe(true);
    }
  });

  it('gives the same value when asked for the value only (options still take part)', () => {
    for (const p of positions.slice(0, 10)) {
      const enc = encode(p, { decks: ['Dragapult ex', 'basic-box'] });
      expect(run(model, enc, false).value).toBeCloseTo(run(model, enc).value, 10);
    }
  });
});
