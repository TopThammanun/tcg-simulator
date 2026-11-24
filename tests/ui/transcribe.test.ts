// Transcribing a real game (BOT-PRO.md, ui/transcribe.ts): the engine plays as the transcriber clicks, stand-ins for
// the cards not seen become the cards seen as they are played or picked, coin flips are set to what really happened,
// and the saved game replays to the same positions.
import { describe, expect, it } from 'vitest';
import { makeBot } from '../../src/bots/core';
import { planFor } from '../../src/bots/plans';
import { actor } from '../../src/engine/actions';
import { keyOf } from '../../src/engine/state';
import type { GameState } from '../../src/engine/types';
import { readGamesFile } from '../../src/review/record';
import {
  act,
  commands,
  current,
  exportText,
  flipsOf,
  fromSaved,
  isKnown,
  name,
  nameUnseen,
  setFlip,
  standIns,
  startTranscript,
  undo,
  unseenKeys,
  unseenOptions,
  verify,
  type Transcript,
} from '../../src/ui/transcribe';
import { deck } from '../engine/helpers';

const DECKS = [deck('dragapult-ex'), deck('basic-box')] as const;
const start = (seed = 7, mulligans?: [number, number]) =>
  startTranscript({
    decks: [DECKS[0].cards, DECKS[1].cards],
    names: ['Hedrick', 'Cassiraga'],
    plans: ['dragapult-ex', 'basic-box'],
    pro: { event: 'Worlds 2026', round: 'Finals game 1', players: ['Hedrick', 'Cassiraga'], source: 'stream-en' },
    ...(mulligans ? { mulligans } : {}),
    seed,
  });

/** Rule-based bots stand in for the transcriber: every card they play gets named first, as a transcriber would. */
function botPlays(t: Transcript, steps: number): Transcript {
  const bots = [makeBot(planFor('dragapult-ex'), { seed: 1 }), makeBot(planFor('basic-box'), { seed: 2 })];
  for (let n = 0; n < steps && current(t).winner === null; n++) {
    const s = current(t);
    const a = bots[actor(s)]!.act(s);
    if ('card' in a && !isKnown(s, a.card)) t = name(t, a.card, keyOf(s, a.card)).t;
    else if (a.t === 'choose') {
      // Picks of unseen cards: the transcriber names each one as the pick it was.
      for (const v of a.picks) {
        const o = current(t).pending!.request.options.find((x) => x.value === v);
        if (o?.card !== undefined && !isKnown(current(t), o.card)) t = name(t, o.card, keyOf(current(t), o.card)).t;
      }
    }
    t = act(t, a);
  }
  return t;
}

describe('a transcript', () => {
  it('starts at the toss, with the mulligans the real game had', () => {
    const t = start(7, [1, 0]);
    const s = current(t);
    expect(s.pending?.request.purpose).toBe('first');
    const t2 = act(t, { t: 'choose', picks: [0] });
    expect(current(t2).players[0].mulligans).toBe(1);
    expect(current(t2).players[1].mulligans).toBe(0);
    // Every card dealt is a stand-in until the transcript sees it.
    expect(standIns(current(t2), 0)).toHaveLength(current(t2).players[0].hand.length);
    expect(unseenKeys(current(t2), 0).reduce((n, k) => n + k.left, 0)).toBe(60);
  });

  it('undo takes the last move back', () => {
    const t = act(start(), { t: 'choose', picks: [0] });
    expect(undo(t).states).toHaveLength(1);
    expect(undo(undo(t)).states).toHaveLength(1);
  });

  it('the setup Active is an unseen option named as the card the broadcast showed, then picked', () => {
    const t = act(start(), { t: 'choose', picks: [0] });
    const s = current(t);
    expect(s.pending?.request.purpose).toBe('setup-active');
    const unseen = unseenOptions(s);
    expect(unseen.length).toBeGreaterThan(0);
    // The player to act: whatever Basic the pro put down; here a card of theirs with unseen copies.
    const p = actor(s);
    const basic = unseenKeys(s, p).find((k) => ['dreepy', 'budew', 'duskull', 'dunsparce', 'lillies-clefairy-ex', 'teal-mask-ogerpon-ex', 'mega-kangaskhan-ex'].includes(k.key))!;
    const named = nameUnseen(t, basic.key, unseen);
    const s2 = current(named.t);
    expect(s2.pending?.request.purpose).toBe('setup-active');
    expect(keyOf(s2, named.card)).toBe(basic.key);
    expect(s2.pending!.request.options.some((o) => o.card === named.card)).toBe(true);
    expect(isKnown(s2, named.card)).toBe(true);
    const picked = act(named.t, { t: 'choose', picks: [named.card] });
    expect(current(picked).players[p].active?.stack).toEqual([named.card]);
  });

  it('commands list what the player to act can do with the cards seen; unseen cards wait to be named', () => {
    let t = botPlays(start(3), 40);
    while (current(t).pending || current(t).phase !== 'main') t = botPlays(t, 1);
    const s = current(t);
    const cs = commands(s);
    expect(cs.some((c) => c.action.t === 'end')).toBe(true);
    for (const c of cs) if ('card' in c.action) expect(isKnown(s, c.action.card)).toBe(true);
    // One entry per card name and target (two Dreepy on the Bench give two attach commands that read alike).
    const acts = cs.map((c) => JSON.stringify(c.action));
    expect(new Set(acts).size).toBe(acts.length);
    const keys = cs.filter((c) => 'card' in c.action).map((c) => `${keyOf(s, (c.action as { card: number }).card)}:${JSON.stringify(c.action)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a coin flip set to what really happened plays the transcript again from that action', () => {
    const t = start(5);
    const flips = flipsOf(t);
    expect(flips).toHaveLength(1);
    const winner = current(t).pending!.request.player;
    const flipped = setFlip(t, 0, !flips[0]!.heads);
    expect(flipsOf(flipped)[0]!.heads).toBe(!flips[0]!.heads);
    expect(current(flipped).pending!.request.player).toBe(winner === 0 ? 1 : 0);
    // Later moves are kept and replayed on the changed flip.
    const played = act(flipped, { t: 'choose', picks: [0] });
    expect(current(played).first).toBe(winner === 0 ? 1 : 0);
  });

  it('the saved game replays to the transcript, round-trips through the file, and goes on recording', () => {
    const t = botPlays(start(9), 150);
    expect(verify(t)).toEqual([]);
    const g = readGamesFile(exportText(t))[0]!;
    expect(g.script?.orders[0].length).toBeGreaterThanOrEqual(1);
    expect(g.pro?.event).toBe('Worlds 2026');
    const again = fromSaved(g);
    expect(again.states).toHaveLength(t.states.length);
    expect(current(again).script?.record).toBe(true);
    const more = botPlays(again, 20);
    expect(verify(more)).toEqual([]);
  });
});

/** For failures: the position in words. */
export const describe_ = (s: GameState) => `turn ${s.turn}, ${s.pending ? s.pending.request.purpose : 'free'}`;
