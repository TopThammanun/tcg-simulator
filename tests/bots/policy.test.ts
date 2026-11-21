// The policy/value network's input (encode.ts), forward pass (model.ts) and the bot that plays from it.
import { describe, expect, it } from 'vitest';
import { suggestNet } from '../../src/bots/coach';
import { makeBot } from '../../src/bots/core';
import { BAGS, GLOB_F, OPT_F, SLOTS, SLOT_F, VOCAB, encode } from '../../src/bots/learn/encode';
import { randomModel, run } from '../../src/bots/learn/model';
import { makeNetBot, recordBot, type Decision } from '../../src/bots/learn/netbot';
import { runStep, sureLine } from '../../src/bots/finisher';
import { makeSearchNetBot } from '../../src/bots/learn/search';
import { planFor } from '../../src/bots/plans';
import type { Bot } from '../../src/bots/types';
import { actor, apply, createGame, legalActions } from '../../src/engine/actions';
import type { GameState } from '../../src/engine/types';
import { playGame } from '../../src/sim/game';
import { deck, DECK_SLUGS, scenario } from '../engine/helpers';

const DECKS = ['player', 'Dragapult ex'] as const;

const board = () =>
  scenario({
    p0: {
      active: { card: 'mega-kangaskhan-ex', energy: ['fire-energy', 'psychic-energy', 'fighting-energy'] },
      bench: ['latias-ex'],
      hand: ['bosss-orders', 'ultra-ball', 'fire-energy'],
      deck: ['psychic-energy', 'paldean-tauros', 'judge'],
      prizes: 4,
    },
    p1: { active: { card: 'dreepy', damage: 30 }, bench: ['budew', 'dreepy'], hand: ['rare-candy', 'night-stretcher'], deck: ['dragapult-ex', 'drakloak'], prizes: 6 },
  });

/** A mid-game position from a real game (normal bots), on the given player's turn. */
function midGame(seed: number): GameState {
  const bots = [makeBot(planFor('player'), { seed: 1 }), makeBot(planFor('dragapult-ex'), { seed: 2 })];
  let s = createGame({ seed, decks: [deck('player'), deck('dragapult-ex')], quiet: true });
  for (let n = 0; n < 400 && s.winner === null; n++) {
    if (!s.pending && s.phase === 'main' && s.turn >= 6) return s;
    s = apply(s, bots[actor(s)]!.act(s), { trusted: true });
  }
  throw new Error('game ended early');
}

describe('encode', () => {
  it('has fixed sizes and one row per legal action', () => {
    const s = board();
    const e = encode(s, { decks: DECKS });
    expect(e.slots).toHaveLength(SLOTS * SLOT_F);
    expect(e.slotCards).toHaveLength(SLOTS * 2);
    expect(e.bags).toHaveLength(BAGS * VOCAB);
    expect(e.glob).toHaveLength(GLOB_F);
    expect(e.refs).toHaveLength(legalActions(s).length);
    expect(e.optX).toHaveLength(e.refs.length * OPT_F);
    for (const v of [...e.slots, ...e.glob, ...e.optX]) expect(Number.isFinite(v)).toBe(true);
  });

  it('sees Kangaskhan, its Energy and the damaged Dreepy in the right tokens', () => {
    const e = encode(board(), { decks: DECKS });
    // Token 0 = my Active, 9 = their Active; [present, active, mine, hp, damage, …]
    expect(e.slots[0]).toBe(1);
    expect(e.slots[2]).toBe(1);
    expect(e.slots[9 * SLOT_F + 2]).toBe(0);
    expect(e.slots[9 * SLOT_F + 4]).toBeCloseTo(30 / 300);
    expect(e.slotCards[0]).toBeGreaterThan(0);
    // Token 2 (second Bench slot) is empty on my side.
    expect(e.slots[2 * SLOT_F]).toBe(0);
  });

  it('does not depend on where the hidden cards are', () => {
    const s = midGame(41);
    const me = s.current;
    const them = me === 0 ? 1 : 0;
    const shuffled = structuredClone(s) as GameState;
    // Swap cards between their hand, deck and Prizes, and between my deck and Prizes.
    const t = shuffled.players[them];
    const pool = [...t.hand, ...t.deck, ...t.prizes].reverse();
    t.hand = pool.splice(0, t.hand.length);
    t.deck = pool.splice(0, t.deck.length);
    t.prizes = pool;
    const m = shuffled.players[me];
    const mine = [...m.deck, ...m.prizes].reverse();
    m.deck = mine.splice(0, m.deck.length);
    m.prizes = mine;
    expect(encode(shuffled, { decks: DECKS })).toEqual(encode(s, { decks: DECKS }));
  });

  it('offers the picks of a pending choice and a stop once enough are picked', () => {
    let s = board();
    const ball = s.players[0].hand.find((c) => s.cards[c]!.key === 'ultra-ball')!;
    s = apply(s, { t: 'trainer', card: ball });
    expect(s.pending).not.toBeNull();
    const e = encode(s, { decks: DECKS });
    const req = s.pending!.request;
    const picks = e.refs.filter((r) => r.t === 'pick');
    expect(picks.length).toBeGreaterThan(0);
    expect(e.refs.some((r) => r.t === 'stop')).toBe(req.min === 0);
  });
});

describe('the network bot', () => {
  it('gives a value between 0 and 1 and one logit per option', () => {
    const m = randomModel(2);
    const e = encode(board(), { decks: DECKS });
    const out = run(m, e);
    expect(out.value).toBeGreaterThan(0);
    expect(out.value).toBeLessThan(1);
    expect(out.logits).toHaveLength(e.refs.length);
  });

  it('plays legal games to the end with every deck', () => {
    const m = randomModel(5);
    for (const [i, slug] of DECK_SLUGS.entries()) {
      const other = DECK_SLUGS[(i + 3) % DECK_SLUGS.length]!;
      const bots: [Bot, Bot] = [
        makeNetBot(m, { decks: [planFor(slug).name, planFor(other).name], seed: i, temperature: 1 }),
        makeNetBot(m, { decks: [planFor(other).name, planFor(slug).name], seed: i + 50, temperature: 0 }),
      ];
      const r = playGame({ seed: 300 + i, decks: [deck(slug), deck(other)], bots });
      expect(r.winner).not.toBeNull();
    }
  }, 120_000);

  it('plays legal games with look-ahead too', () => {
    const m = randomModel(7);
    const bots: [Bot, Bot] = [
      makeSearchNetBot(m, { decks: DECKS, seed: 1, width: 3, samples: 2, confident: 0.6 }),
      makeNetBot(m, { decks: ['Dragapult ex', 'player'], seed: 2 }),
    ];
    const r = playGame({ seed: 77, decks: [deck('player'), deck('dragapult-ex')], bots });
    expect(r.winner).not.toBeNull();
  }, 120_000);

  it('records another bot’s decisions as the options that bot took', () => {
    const rows: Decision[] = [];
    const plan = planFor('player');
    const bots: [Bot, Bot] = [
      recordBot(makeBot(plan, { seed: 1 }), DECKS, (d) => rows.push(d)),
      makeBot(planFor('dragapult-ex'), { seed: 2 }),
    ];
    playGame({ seed: 9, decks: [deck('player'), deck('dragapult-ex')], bots });
    expect(rows.length).toBeGreaterThan(20);
    for (const d of rows) {
      expect(d.chosen).toBeGreaterThanOrEqual(0);
      expect(d.chosen).toBeLessThan(d.enc.refs.length);
      expect(d.player).toBe(0);
    }
  }, 60_000);
});

describe('the hint button with a network', () => {
  it('gives the three options the policy likes best, best first, each a legal action', () => {
    const s = board();
    const tips = suggestNet(s, 0, randomModel(4), DECKS, planFor('player'));
    expect(tips).toHaveLength(3);
    expect(tips[0]!.score).toBeGreaterThanOrEqual(tips[1]!.score);
    expect(tips[1]!.score).toBeGreaterThanOrEqual(tips[2]!.score);
    const legal = legalActions(s).map((a) => JSON.stringify(a));
    for (const t of tips) {
      expect(legal).toContain(JSON.stringify(t.action));
      expect(t.title.length).toBeGreaterThan(0);
    }
  });
});

describe('what the bot checks before it plays', () => {
  it("finds a sure win the attack planner's patterns miss: retreat to Fezandipiti ex, power it up, Cruel Arrow the Benched Latias ex", () => {
    // 20 Nov 2026, a game against a person: the bot attacked with Rapid-Fire Combo instead and needed two heads.
    const s = scenario({
      p0: {
        active: { card: 'mega-kangaskhan-ex', energy: ['fighting-energy', 'psychic-energy', 'psychic-energy', 'grass-energy'] },
        bench: ['fezandipiti-ex', { card: 'mega-kangaskhan-ex', energy: ['grass-energy', 'psychic-energy', 'grass-energy'] }],
        hand: ['energy-switch', 'energy-switch', 'energy-switch', 'lightning-energy'],
        prizes: 2,
      },
      p1: { active: 'mega-kangaskhan-ex', bench: [{ card: 'latias-ex', damage: 200 }] },
    });
    const plan = planFor('basic-box');
    const line = sureLine(s, 0, plan, 3);
    expect(line.wins).toBe(true);
    let st = s;
    for (const step of line.steps) st = runStep(st, step, plan);
    expect(st.winner).toBe(0);
  });

  it('spreads Phantom Dive counters for every Knock Out they can make, whatever the network would pick', () => {
    let s = scenario({
      p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] } },
      p1: { active: 'fezandipiti-ex', bench: [{ card: 'budew', damage: 20 }, { card: 'drakloak', under: ['dreepy'], damage: 60 }, { card: 'dreepy', damage: 20 }] },
    });
    s = apply(s, { t: 'attack', name: 'Phantom Dive' });
    expect(s.pending?.request.purpose).toBe('counters');
    for (const seed of [1, 2, 3]) {
      const bot = makeSearchNetBot(randomModel(seed), { decks: ['Dragapult ex', 'player'], seed, plan: planFor('dragapult-ex') });
      // Budew needs 1 counter and Drakloak 3: 2 Prizes, with 2 counters to spare.
      expect(6 - apply(s, bot.act(s)).players[0].prizes.length).toBe(2);
    }
  });
});
