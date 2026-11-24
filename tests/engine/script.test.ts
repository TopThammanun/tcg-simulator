// A real game's deal (BOT-PRO.md): a transcribed game has no seed, so the state carries a DealScript, the deck order
// after every shuffle and every coin flip. A game being transcribed records them as the seeded RNG makes them; a saved
// one replays them under any seed. Cards the transcript never saw are stand-ins (not `known`): nameCard() turns one into
// the card seen, keeping everything already seen and the recorded orders consistent.
import { describe, expect, it } from 'vitest';
import { makeBot } from '../../src/bots/core';
import { DEFAULT_POLICY, planFor } from '../../src/bots/plans';
import { actor, apply, createGame } from '../../src/engine/actions';
import { isBasicPokemon } from '../../src/engine/db';
import { emptyScript, nameCard, redealUnknown, standInsOf, unknownCards } from '../../src/engine/script';
import { keyOf } from '../../src/engine/state';
import type { Action, DealScript, GameState, PlayerId } from '../../src/engine/types';
import { determinize, redeal } from '../../src/engine/view';
import { isFree, replay, type SavedGame } from '../../src/review/record';
import { deck } from './helpers';

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const DECKS = [deck('dragapult-ex'), deck('basic-box')] as const;

/** Rule-based bots play both sides from `s` until `stop` or the game ends; the states and actions. */
function playUntil(s: GameState, stop: (s: GameState, n: number) => boolean, seed = 5) {
  const bots = [makeBot(planFor('dragapult-ex'), { seed }), makeBot(planFor('basic-box'), { seed: seed + 1 })];
  const states = [s];
  const actions: Action[] = [];
  for (let n = 0; s.winner === null && n < 3000 && !stop(s, n); n++) {
    const a = bots[actor(s)]!.act(s);
    s = apply(s, a, { trusted: true });
    states.push(s);
    actions.push(a);
  }
  return { states, actions };
}

const recording = (seed: number, script: Partial<DealScript> = {}) =>
  createGame({ seed, decks: [DECKS[0], DECKS[1]], names: ['A', 'B'], script: { ...emptyScript(), ...script } });

/** The zones that show a game went the same way. */
const zones = (s: GameState) =>
  s.players.map((ps) => ({
    deck: ps.deck,
    hand: ps.hand,
    prizes: ps.prizes,
    discard: ps.discard,
    active: ps.active?.stack,
    bench: ps.bench.map((b) => b.stack),
    mulligans: ps.mulligans,
  }));

describe('DealScript: recording and replaying a real game', () => {
  it('records every shuffle and coin flip, and the same actions replay the same game under another seed', () => {
    const { states, actions } = playUntil(recording(11), (_s, n) => n >= 120);
    const last = states[states.length - 1]!;
    const sc = last.script!;
    expect(sc.orders[0].length).toBeGreaterThanOrEqual(1);
    expect(sc.orders[1].length).toBeGreaterThanOrEqual(1);
    expect(sc.coins.length).toBeGreaterThanOrEqual(1);
    expect(sc.orders[0][0]).toHaveLength(60);

    let s = createGame({ seed: 999, decks: [DECKS[0], DECKS[1]], names: ['A', 'B'], script: { ...sc, record: false } });
    expect(zones(s)).toEqual(zones(states[0]!));
    actions.forEach((a, i) => {
      s = apply(s, a, { trusted: true });
      expect(zones(s)).toEqual(zones(states[i + 1]!));
    });
    expect(s.script!.orders).toEqual(sc.orders);
    expect(s.script!.coins).toEqual(sc.coins);
  });

  it('a shuffle whose order lists other cards than the deck holds throws', () => {
    const { states } = playUntil(recording(12), (_s, n) => n >= 10);
    const sc = states[states.length - 1]!.script!;
    const bad = sc.orders[0][0]!.slice();
    bad[0] = bad[0]! + 60; // the other player's card
    const orders = [[bad, ...sc.orders[0].slice(1)], sc.orders[1]] as DealScript['orders'];
    // The decks are shuffled once the toss winner has chosen to go first or second.
    const start = createGame({ seed: 1, decks: [DECKS[0], DECKS[1]], script: { ...sc, orders, record: false } });
    expect(() => apply(start, { t: 'choose', picks: [0] })).toThrow(/shuffle 0 of player 0/);
  });

  it('coin flips come from the script in order, the rest from the seed', () => {
    // The first flip decides who chooses to go first: that player answers the pending choice.
    const heads = createGame({ seed: 3, decks: [DECKS[0], DECKS[1]], script: { ...emptyScript(), coins: [true], record: false } });
    expect(heads.pending!.request.player).toBe(0);
    const tails = createGame({ seed: 3, decks: [DECKS[0], DECKS[1]], script: { ...emptyScript(), coins: [false], record: false } });
    expect(tails.pending!.request.player).toBe(1);
    // Past the end, recording: the seed's flip is kept.
    const rec = createGame({ seed: 3, decks: [DECKS[0], DECKS[1]], script: { ...emptyScript(), coins: [] } });
    expect(rec.script!.coins).toHaveLength(1);
  });

  it('forces the mulligans a real game had, and the recorded orders replay them', () => {
    const goFirst = (x: GameState) => apply(x, { t: 'choose', picks: [0] });
    const s = goFirst(recording(21, { mulligans: [2, 1] }));
    expect(s.players[0].mulligans).toBe(2);
    expect(s.players[1].mulligans).toBe(1);
    expect(s.script!.orders[0]).toHaveLength(3);
    expect(s.script!.orders[1]).toHaveLength(2);
    const again = goFirst(createGame({ seed: 77, decks: [DECKS[0], DECKS[1]], script: { ...s.script!, record: false } }));
    expect(again.players[0].mulligans).toBe(2);
    expect(again.players[1].mulligans).toBe(1);
    expect(zones(again)).toEqual(zones(s));
  });
});

describe('nameCard: a stand-in becomes the card the transcript saw', () => {
  /** A free position of player 0 after setup, with a stand-in in their hand and a key with unseen copies in their deck. */
  function position() {
    const { states, actions } = playUntil(recording(31), (s) => s.turn >= 2 && isFree(s, 0));
    const s = states[states.length - 1]!;
    const me = s.players[0];
    const a = me.hand.find((c) => !s.script!.known.includes(c))!;
    const inDeck = me.deck.find((c) => !s.script!.known.includes(c) && keyOf(s, c) !== keyOf(s, a))!;
    return { s, actions, a, key: keyOf(s, inDeck) };
  }

  it('swaps the stand-in with an unseen copy of that card and marks it known', () => {
    const { s, a, key } = position();
    const i = s.players[0].hand.indexOf(a);
    const n = nameCard(s, a, key);
    const b = n.players[0].hand[i]!;
    expect(keyOf(n, b)).toBe(key);
    expect(n.script!.known).toContain(b);
    expect(n.script!.known).not.toContain(a);
    // The old stand-in went where the copy was; nothing else moved.
    expect(sorted([...n.players[0].hand, ...n.players[0].deck, ...n.players[0].prizes])).toEqual(sorted([...s.players[0].hand, ...s.players[0].deck, ...s.players[0].prizes]));
    expect(n.players[0].hand.length).toBe(s.players[0].hand.length);
    expect(n.players[1]).toEqual(s.players[1]);
    // The recorded orders were relabelled the same way.
    const before = s.script!.orders[0][0]!;
    const after = n.script!.orders[0][0]!;
    expect(after.indexOf(b)).toBe(before.indexOf(a));
    expect(after.indexOf(a)).toBe(before.indexOf(b));
  });

  it('the recorded game replays to the named position', () => {
    const { s, actions, a, key } = position();
    const n = nameCard(s, a, key);
    let r = createGame({ seed: 5, decks: [DECKS[0], DECKS[1]], names: ['A', 'B'], script: { ...n.script!, record: false } });
    for (const act of actions) r = apply(r, act, { trusted: true });
    expect(zones(r)).toEqual(zones(n));
  });

  it('naming a card as what it already is only marks it known; a card already seen cannot be renamed', () => {
    const { s, a } = position();
    const same = nameCard(s, a, keyOf(s, a));
    expect(same.players[0].hand).toEqual(s.players[0].hand);
    expect(same.script!.known).toContain(a);
    expect(() => nameCard(same, a, 'ultra-ball')).toThrow(/already/);
  });

  it('refuses a card with no unseen copy left in a hidden zone', () => {
    const { s, a } = position();
    const me = s.players[0];
    // Name every hidden copy of one card, then ask for one more.
    const key = keyOf(s, me.deck[0]!);
    let n = s;
    for (;;) {
      const hidden = [...n.players[0].deck, ...n.players[0].prizes, ...n.players[0].hand].filter((c) => keyOf(n, c) === key && !n.script!.known.includes(c));
      if (!hidden.length) break;
      n = nameCard(n, hidden[0]!, key);
    }
    const standIn = n.players[0].hand.find((c) => !n.script!.known.includes(c))!;
    expect(() => nameCard(n, standIn, key)).toThrow(/no unseen copy/);
  });

  it('a stand-in a forced choice put in play is named too, and the recorded game replays to it', () => {
    // A setup hand with one Basic: the engine puts it down without asking. The transcriber names it afterwards.
    const { states, actions } = playUntil(recording(45), (s) => s.turn >= 1 && isFree(s, s.first));
    const s = states[states.length - 1]!;
    const p = s.first;
    const activeCard = s.players[p].active!.stack[0]!;
    expect(s.script!.known).not.toContain(activeCard);
    const key = ['dreepy', 'budew', 'abra', 'dunsparce'].find((k) => k !== keyOf(s, activeCard) && s.players[p].deck.some((c) => keyOf(s, c) === k && !s.script!.known.includes(c)))!;
    const n = nameCard(s, activeCard, key);
    expect(keyOf(n, n.players[p].active!.stack[0]!)).toBe(key);
    expect(n.script!.known).toContain(n.players[p].active!.stack[0]!);
    expect(standInsOf(n, p).play).not.toContain(n.players[p].active!.stack[0]!);
    let r = createGame({ seed: 5, decks: [DECKS[0], DECKS[1]], names: ['A', 'B'], script: { ...n.script!, record: false } });
    for (const act of actions) r = apply(r, act, { trusted: true });
    expect(zones(r)).toEqual(zones(n));
  });

  it('keeps a forced mulligan hand without a Basic', () => {
    const s0 = recording(41, { mulligans: [1, 0] });
    const { states } = playUntil(s0, (s) => s.turn >= 2 && isFree(s, 0));
    const s = states[states.length - 1]!;
    const a = s.players[0].hand.find((c) => !s.script!.known.includes(c))!;
    const basic = s.players[0].deck.find((c) => isBasicPokemon(keyOf(s, c)) && !s.script!.known.includes(c))!;
    const n = nameCard(s, a, keyOf(s, basic));
    const top7 = n.script!.orders[0][0]!.slice(0, 7);
    expect(top7.some((c) => isBasicPokemon(keyOf(n, c)))).toBe(false);
  });
});

describe('unknown cards', () => {
  it('redealUnknown permutes only the cards never seen, within hidden zones, and drops the script', () => {
    const { states } = playUntil(recording(51), (s) => s.turn >= 3 && isFree(s, 0));
    let s = states[states.length - 1]!;
    // See a few cards so the known ones can be checked to stay.
    for (const c of s.players[0].hand.slice(0, 2)) s = nameCard(s, c, keyOf(s, c));
    const r = redealUnknown(s, 9);
    for (const p of [0, 1] as const) {
      const [a, b] = [s.players[p], r.players[p]];
      expect(b.deck.length).toBe(a.deck.length);
      expect(b.hand.length).toBe(a.hand.length);
      expect(b.prizes.length).toBe(a.prizes.length);
      expect(b.discard).toEqual(a.discard);
      expect(sorted([...b.deck, ...b.hand, ...b.prizes])).toEqual(sorted([...a.deck, ...a.hand, ...a.prizes]));
      for (const c of s.script!.known) {
        expect(a.hand.indexOf(c)).toBe(b.hand.indexOf(c));
        expect(a.deck.indexOf(c)).toBe(b.deck.indexOf(c));
      }
    }
    expect(unknownCards(s, 0).length).toBe(60 - s.script!.known.filter((c) => s.cards[c]!.owner === 0).length);
    expect(r.script).toBeUndefined();
    expect(r.players[0].deck).not.toEqual(s.players[0].deck);
  });

  it('determinize and redeal drop the script: a re-dealt future is not the transcript', () => {
    const { states } = playUntil(recording(61), (s) => s.turn >= 2 && isFree(s, 0));
    const s = states[states.length - 1]!;
    expect(determinize(s, 0, 1).script).toBeUndefined();
    expect(redeal(s, 0, 1).script).toBeUndefined();
  });
});

describe('a saved game with a script', () => {
  it('replays from the file as it was transcribed', () => {
    const { states, actions } = playUntil(recording(71), (_s, n) => n >= 80);
    const last = states[states.length - 1]!;
    const g: SavedGame = {
      savedAt: 0,
      seed: 71,
      opponent: 'basic-box',
      opponentName: 'B',
      mine: 'dragapult-ex',
      rules: { version: last.rules.version },
      policy: DEFAULT_POLICY,
      decks: [DECKS[0].cards, DECKS[1].cards],
      actions,
      winner: last.winner,
      reason: last.winReason,
      turns: last.turn,
      script: { ...last.script!, record: false },
      pro: { event: 'test', players: ['A', 'B'], source: 'other' },
    };
    const r = replay(g);
    expect(r).toHaveLength(states.length);
    r.forEach((x, i) => expect(zones(x)).toEqual(zones(states[i]!)));
    expect(r[0]!.names).toEqual(['A', 'B']);
  });
});

/** Whose turn it is to act, for readability in failures. */
export const whose = (s: GameState): PlayerId => actor(s);
