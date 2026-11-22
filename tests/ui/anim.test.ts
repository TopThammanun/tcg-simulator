// What the play screen animates after each action: the event list read from the state before and after.
import { describe, expect, it } from 'vitest';
import { apply, createGame } from '../../src/engine/actions';
import type { GameState } from '../../src/engine/types';
import { animEvents, type AnimEvent } from '../../src/ui/anim/events';
import { active, bench, chooseFirst, deck, handCard, scenario } from '../engine/helpers';

const of = <T extends AnimEvent['t']>(evs: AnimEvent[], t: T) => evs.filter((e): e is Extract<AnimEvent, { t: T }> => e.t === t);

const board = () =>
  scenario({
    p0: {
      active: { card: 'mega-kangaskhan-ex', energy: ['fire-energy', 'psychic-energy', 'fighting-energy'] },
      bench: ['lillies-clefairy-ex'],
      hand: ['grass-energy', 'meowth-ex', 'judge', 'heros-cape'],
    },
    p1: { active: 'dreepy', bench: ['budew'], hand: ['bosss-orders', 'crispin'] },
  });

describe('cards moving between zones', () => {
  it('a Basic played to the Bench flies from your hand to its new spot', () => {
    const s = board();
    const card = handCard(s, 0, 'meowth-ex');
    const n = apply(s, { t: 'bench', card });
    const [m] = of(animEvents(s, n, { t: 'bench', card }), 'move');
    expect(m).toMatchObject({
      card,
      key: 'meowth-ex',
      from: { zone: 'hand', player: 0 },
      to: { zone: 'pokemon', player: 0, uid: bench(n, 0, 1).uid },
      faceUp: [true, true],
      phase: 'play',
    });
  });

  it('Energy and a Tool go onto the Pokémon they are attached to', () => {
    const s = board();
    const e = handCard(s, 0, 'grass-energy');
    const t = handCard(s, 0, 'heros-cape');
    const uid = bench(s, 0, 0).uid;
    const n1 = apply(s, { t: 'energy', card: e, target: uid });
    expect(of(animEvents(s, n1, { t: 'energy', card: e, target: uid }), 'move')[0]).toMatchObject({
      to: { zone: 'energy', player: 0, uid },
      phase: 'play',
    });
    const n2 = apply(n1, { t: 'tool', card: t, target: uid });
    expect(of(animEvents(n1, n2, { t: 'tool', card: t, target: uid }), 'move')[0]).toMatchObject({
      to: { zone: 'tool', player: 0, uid },
    });
  });

  it('a Supporter stops in the middle of the table before going to the discard pile', () => {
    const s = board();
    const card = handCard(s, 0, 'judge');
    const n = chooseFirst(apply(s, { t: 'trainer', card }));
    const evs = animEvents(s, n, { t: 'trainer', card });
    const played = of(evs, 'move').find((m) => m.card === card)!;
    expect(played).toMatchObject({ stage: true, to: { zone: 'discard', player: 0 }, phase: 'play' });
    // Judge: both hands go back, both decks shuffle, both draw 4.
    expect(of(evs, 'shuffle').map((e) => e.player).sort()).toEqual([0, 1]);
    const draws = of(evs, 'move').filter((m) => m.from.zone === 'deck' && m.to.zone === 'hand');
    expect(draws).toHaveLength(8);
    expect(evs.indexOf(played)).toBeLessThan(evs.indexOf(draws[0]!));
  });

  it('a hand shuffled into the deck goes in whole, even the cards drawn straight back', () => {
    // An empty deck: Judge puts the other 3 cards in and draws them all again, so before and after they are in the hand.
    const s = scenario({ p0: { active: 'dreepy', hand: ['grass-energy', 'meowth-ex', 'judge', 'heros-cape'], deck: [] }, p1: { active: 'dreepy' } });
    const card = handCard(s, 0, 'judge');
    const n = chooseFirst(apply(s, { t: 'trainer', card }));
    const others = s.players[0].hand.filter((c) => c !== card);
    expect(n.players[0].hand.slice().sort()).toEqual(others.slice().sort());
    const moves = of(animEvents(s, n, { t: 'trainer', card }), 'move');
    for (const c of others) {
      expect(moves.some((m) => m.card === c && m.from.zone === 'hand' && m.to.zone === 'deck')).toBe(true);
      expect(moves.some((m) => m.card === c && m.from.zone === 'deck' && m.to.zone === 'hand')).toBe(true);
    }
  });

  it("never names a card you can't see", () => {
    const s = board();
    const card = handCard(s, 0, 'judge');
    const evs = animEvents(s, chooseFirst(apply(s, { t: 'trainer', card })), { t: 'trainer', card });
    const botDraws = of(evs, 'move').filter((m) => m.to.zone === 'hand' && m.to.player === 1);
    expect(botDraws.length).toBe(4);
    for (const m of botDraws) expect(m).toMatchObject({ key: null, faceUp: [false, false] });
    const myDraws = of(evs, 'move').filter((m) => m.to.zone === 'hand' && m.to.player === 0);
    for (const m of myDraws) expect(m.faceUp).toEqual([false, true]);
  });
});

describe('attacks', () => {
  it('names the attack, the attacker and its type, then the damage', () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', energy: ['fire-energy', 'psychic-energy', 'fighting-energy'] } },
      p1: { active: 'mega-kangaskhan-ex', bench: ['budew'] },
    });
    const a = { t: 'attack', name: 'Rapid-Fire Combo' } as const;
    const n = chooseFirst(apply(s, a));
    const evs = animEvents(s, n, a);
    const [atk] = of(evs, 'attack');
    expect(atk).toMatchObject({ player: 0, uid: active(s, 0).uid, name: 'Rapid-Fire Combo', type: 'Colorless', phase: 'act' });
    const [hit] = of(evs, 'damage');
    expect(hit).toMatchObject({ player: 1, uid: active(s, 1).uid, phase: 'hit' });
    expect(hit!.amount).toBe(n.players[1].active!.damage);
    // Declared, then the coins (flip until tails), then the hit.
    const coins = of(evs, 'coin');
    expect(coins.length).toBeGreaterThan(0);
    expect(coins[coins.length - 1]!.heads).toBe(false);
    expect(evs.indexOf(atk!)).toBeLessThan(evs.indexOf(coins[0]!));
    expect(evs.indexOf(coins[coins.length - 1]!)).toBeLessThan(evs.indexOf(hit!));
  });

  it('a Knock Out sends the Pokémon to the discard pile and the Prize cards to the hand', () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', energy: ['fire-energy', 'psychic-energy', 'fighting-energy'] } },
      p1: { active: { card: 'dreepy', energy: ['fire-energy'] }, bench: ['budew'] },
    });
    const a = { t: 'attack', name: 'Rapid-Fire Combo' } as const;
    const n = chooseFirst(apply(s, a));
    const evs = animEvents(s, n, a);
    const dreepy = active(s, 1);
    expect(of(evs, 'ko')).toEqual([expect.objectContaining({ player: 1, uid: dreepy.uid, key: 'dreepy', phase: 'ko' })]);
    const gone = of(evs, 'move').filter((m) => m.to.zone === 'discard' && m.to.player === 1);
    expect(gone.map((m) => m.from.zone).sort()).toEqual(['energy', 'pokemon']);
    for (const m of gone) expect(m.phase).toBe('ko');
    const prize = of(evs, 'move').filter((m) => m.from.zone === 'prizes');
    expect(prize).toHaveLength(1);
    expect(prize[0]).toMatchObject({ to: { zone: 'hand', player: 0 }, faceUp: [false, true], phase: 'move' });
  });

  it('a Pokémon discarded from the Bench is not Knocked Out: no hit, no KO, it just goes to the discard pile', () => {
    // Area Zero Underdepths replaced: the bot's Bench of 6 goes down to 5, and nobody takes a Prize.
    const s = scenario({
      p0: { active: 'dreepy', hand: ['risky-ruins'] },
      p1: { active: 'teal-mask-ogerpon-ex', bench: ['budew', 'dreepy', 'latias-ex', 'budew', 'dreepy', 'budew'] },
      stadium: { card: 'area-zero-underdepths', owner: 1 },
    });
    const card = handCard(s, 0, 'risky-ruins');
    const n = chooseFirst(apply(s, { t: 'trainer', card }));
    expect(n.players[1].bench).toHaveLength(5);
    expect(n.players[0].prizes).toHaveLength(s.players[0].prizes.length);
    const evs = animEvents(s, n, { t: 'trainer', card });
    expect(of(evs, 'ko')).toEqual([]);
    expect(of(evs, 'damage')).toEqual([]);
    const gone = of(evs, 'move').filter((m) => m.from.zone === 'pokemon' && m.to.zone === 'discard');
    expect(gone).toHaveLength(1);
    expect(gone[0]!.phase).toBe('move');
  });
});

describe('turns, coins and the end of the game', () => {
  it('ending the turn shows the next turn, then its draw', () => {
    const s = board();
    const n = apply(s, { t: 'end' });
    const evs = animEvents(s, n, { t: 'end' });
    const [turn] = of(evs, 'turn');
    expect(turn).toMatchObject({ turn: s.turn + 1, player: 1, phase: 'turn' });
    const draw = of(evs, 'move').find((m) => m.to.zone === 'hand' && m.to.player === 1)!;
    expect(draw.phase).toBe('turn');
    expect(evs.indexOf(turn!)).toBeLessThan(evs.indexOf(draw));
  });

  it('reads coin flips from the log', () => {
    const s = board();
    const log = (text: string) => ({ turn: 5, player: null, text, step: 1 });
    const n: GameState = { ...s, log: [log('โยนเหรียญ: หัว'), log('คุณ จั่ว 1 ใบ'), log('โยนเหรียญ: ก้อย')] };
    expect(of(animEvents(s, n), 'coin').map((c) => c.heads)).toEqual([true, false]);
  });

  it('flags the winner', () => {
    const s = board();
    const n: GameState = { ...s, winner: 0, winReason: 'เก็บ Prize ครบ', phase: 'over' };
    expect(of(animEvents(s, n), 'over')).toEqual([expect.objectContaining({ winner: 0, reason: 'เก็บ Prize ครบ', phase: 'end' })]);
  });

  it("keeps the bot's setup Pokémon face down until both sides are ready, then reveals them", () => {
    const g0 = createGame({ seed: 5, decks: [deck('player'), deck('basic-box')], quiet: false });
    let s = g0;
    const seen: AnimEvent[] = [];
    // Answer every setup choice with the first options; both players are answered here.
    while (s.phase === 'setup') {
      const r = s.pending!.request;
      const n = apply(s, { t: 'choose', picks: r.options.slice(0, Math.max(r.min, 1)).map((o) => o.value) });
      seen.push(...animEvents(s, n, { t: 'choose', picks: [] }));
      s = n;
    }
    const botPlaced = of(seen, 'move').filter((m) => m.to.zone === 'pokemon' && m.to.player === 1);
    expect(botPlaced.length).toBeGreaterThan(0);
    for (const m of botPlaced) expect(m).toMatchObject({ key: null, faceUp: [false, false] });
    expect(of(seen, 'reveal')).toHaveLength(1);
    const dealt = of(seen, 'move').filter((m) => m.from.zone === 'deck' && m.to.zone === 'prizes');
    expect(dealt).toHaveLength(12);
  });
});
