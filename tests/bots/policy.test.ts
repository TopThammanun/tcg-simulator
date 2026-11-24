// The policy/value network's input (encode.ts), forward pass (model.ts) and the bot that plays from it.
import { describe, expect, it } from 'vitest';
import { choosePicks } from '../../src/bots/choose';
import { suggestNet } from '../../src/bots/coach';
import { makeBot } from '../../src/bots/core';
import { createBot } from '../../src/bots/index';
import { BAGS, GLOB_F, OPT_F, SLOTS, SLOT_F, VOCAB, encode } from '../../src/bots/learn/encode';
import { randomModel, run } from '../../src/bots/learn/model';
import { actionKey, makeNetBot, recordBot, sureTarget, type Decision, type SearchingBot } from '../../src/bots/learn/netbot';
import { runStep, sureLine } from '../../src/bots/finisher';
import { makeSearchNetBot, morePrizes } from '../../src/bots/learn/search';
import { planFor } from '../../src/bots/plans';
import type { Bot } from '../../src/bots/types';
import { actor, apply, createGame, legalActions } from '../../src/engine/actions';
import { hpLeft } from '../../src/engine/rules';
import { revealedHand, topKey } from '../../src/engine/state';
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
    for (const seed of [41, 42, 43]) {
      const s = midGame(seed);
      const me = s.current;
      const them = me === 0 ? 1 : 0;
      const shuffled = structuredClone(s) as GameState;
      // Swap the cards I can't know about: between their hand (not the cards I saw go there), deck and Prizes, and
      // between my deck and Prizes (unless I have looked through my deck since they were set).
      const t = shuffled.players[them];
      const seen = revealedHand(t);
      const hidden = t.hand.filter((c) => !seen.includes(c));
      const pool = [...hidden, ...t.deck, ...t.prizes].reverse();
      t.hand = [...seen, ...pool.splice(0, hidden.length)];
      t.deck = pool.splice(0, t.deck.length);
      t.prizes = pool;
      const m = shuffled.players[me];
      if (!m.prizesKnown) {
        const mine = [...m.deck, ...m.prizes].reverse();
        m.deck = mine.splice(0, m.deck.length);
        m.prizes = mine;
      }
      expect(encode(shuffled, { decks: DECKS })).toEqual(encode(s, { decks: DECKS }));
    }
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

/** 20 Nov 2026, a game against a person: a sure win the bot missed (it attacked with Rapid-Fire Combo and needed two heads). */
const cruelArrowWin = () =>
  scenario({
    p0: {
      active: { card: 'mega-kangaskhan-ex', energy: ['fighting-energy', 'psychic-energy', 'psychic-energy', 'grass-energy'] },
      bench: ['fezandipiti-ex', { card: 'mega-kangaskhan-ex', energy: ['grass-energy', 'psychic-energy', 'grass-energy'] }],
      hand: ['energy-switch', 'energy-switch', 'energy-switch', 'lightning-energy'],
      prizes: 2,
    },
    p1: { active: 'mega-kangaskhan-ex', bench: [{ card: 'latias-ex', damage: 200 }] },
  });

describe('what the bot checks before it plays', () => {
  it("finds a sure win the attack planner's patterns miss: retreat to Fezandipiti ex, power it up, Cruel Arrow the Benched Latias ex", () => {
    const s = cruelArrowWin();
    const plan = planFor('basic-box');
    const line = sureLine(s, 0, plan, 3);
    expect(line.wins).toBe(true);
    let st = s;
    for (const step of line.steps) st = runStep(st, step, plan);
    expect(st.winner).toBe(0);
  });

  it('training rows carry the first move of a line proved to win this turn (sureTarget), and −1 without one', () => {
    const s = cruelArrowWin();
    const plan = planFor('basic-box');
    const rows: Decision[] = [];
    makeNetBot(randomModel(1), { decks: [plan.name, plan.name], seed: 1, onDecision: (d) => rows.push(d), sure: plan }).act(s);
    const target = rows[0]!.sure!;
    expect(target).toBeGreaterThanOrEqual(0);
    const ref = rows[0]!.enc.refs[target]!;
    expect(ref.t === 'action' && actionKey(s, ref.action)).toBe(actionKey(s, sureLine(s, 0, plan, 3).steps[0]!.action));
    // Four Prizes to go and nothing worth four on their side: no win is looked for.
    const b = board();
    expect(sureTarget(b, 0, planFor('player'), encode(b, { decks: DECKS }))).toBe(-1);
  });

  it('with no deals (samples 0) plays the network’s move without a search, but still a sure win', () => {
    const m = randomModel(3);
    const plan = planFor('basic-box');
    const s = cruelArrowWin();
    const bot = makeSearchNetBot(m, { decks: [plan.name, plan.name], seed: 1, plan, samples: 0 });
    expect(actionKey(s, bot.act(s))).toBe(actionKey(s, sureLine(s, 0, plan, 3).steps[0]!.action));
    // No sure win here: the move of the network alone.
    const b = board();
    const quick = makeSearchNetBot(m, { decks: DECKS, seed: 1, plan: planFor('player'), samples: 0 });
    expect(actionKey(b, quick.act(b))).toBe(actionKey(b, makeNetBot(m, { decks: DECKS, seed: 1, temperature: 0 }).act(b)));
    expect(quick.lastSearched).toBe(false);
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

  it('spreads them for the most Prizes, not the biggest Knock Out first (three 1-Prize Pokémon over one ex)', () => {
    let s = scenario({
      p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] } },
      p1: {
        active: 'fezandipiti-ex',
        bench: [{ card: 'fezandipiti-ex', damage: 150 }, { card: 'dreepy', damage: 50 }, { card: 'dreepy', damage: 50 }, { card: 'dreepy', damage: 50 }],
      },
    });
    s = apply(s, { t: 'attack', name: 'Phantom Dive' });
    // The benched ex needs all 6 counters for 2 Prizes; each Dreepy needs 2: 3 Prizes.
    const after = apply(s, { t: 'choose', picks: choosePicks(s, s.pending!.request, planFor('dragapult-ex')) });
    expect(6 - after.players[0].prizes.length).toBe(3);
  });

  it("puts the counters left where the next Phantom Dive Knocks Out, not on an ex it can't reach (2026 Worlds final)", () => {
    let s = scenario({
      p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] } },
      p1: { active: 'fezandipiti-ex', bench: [{ card: 'fezandipiti-ex', damage: 200 }, 'fezandipiti-ex', { card: 'kadabra', under: ['abra'] }] },
    });
    s = apply(s, { t: 'attack', name: 'Phantom Dive' });
    const plan = planFor('dragapult-ex');
    const after = apply(s, { t: 'choose', picks: choosePicks(s, s.pending!.request, plan) });
    expect(6 - after.players[0].prizes.length).toBe(2);
    const bench = after.players[1].bench;
    expect(bench.find((sl) => topKey(after, sl) === 'fezandipiti-ex')!.damage).toBe(0);
    expect(hpLeft(after, bench.find((sl) => topKey(after, sl) === 'kadabra')!)).toBeLessThanOrEqual(60);
    // The game's bot: a spread with the same Prizes now but nothing set up gives way to this one.
    const [hurt, full] = s.players[1].bench;
    const lazy = { t: 'choose' as const, picks: [hurt!.uid, ...Array(5).fill(full!.uid)] };
    expect(morePrizes(s, lazy, plan)).not.toBe(lazy);
  });
});

describe("the game's bot (createBot)", () => {
  it('plays an expert whose file says so without look-ahead (meta.search, BOT-NEXT.md N5), the others with it', () => {
    const b = board();
    const plain = randomModel(3);
    plain.meta.search = { samples: 0 };
    const quick = createBot(planFor('player'), 1, planFor('dragapult-ex'), { model: plain }) as SearchingBot;
    quick.act(b);
    expect(quick.lastSearched).toBe(false);
    const searching = createBot(planFor('player'), 1, planFor('dragapult-ex'), { model: randomModel(3) }) as SearchingBot;
    searching.act(b);
    expect(searching.lastSearched).toBe(true);
  });
});
