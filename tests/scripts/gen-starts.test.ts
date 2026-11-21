// gen.ts `starts`: self-play from positions of saved games (games people played against the bot).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchesFor, playMatch, startPositions } from '../../scripts/learn/gen';
import { makeBot } from '../../src/bots/core';
import { DEFAULT_POLICY, planFor } from '../../src/bots/plans';
import { DEFAULT_RULES } from '../../src/engine/state';
import { gamesFile, replay, type SavedGame } from '../../src/review/record';
import { playGame } from '../../src/sim/game';
import { deck } from '../engine/helpers';

function savedGame(): SavedGame {
  const r = playGame({
    seed: 21,
    decks: [deck('player'), deck('dragapult-ex')],
    bots: [makeBot(planFor('player'), { seed: 1 }), makeBot(planFor('dragapult-ex'), { seed: 2 })],
    record: true,
  });
  return {
    savedAt: 1,
    seed: 21,
    opponent: 'dragapult-ex',
    opponentName: 'Dragapult ex',
    rules: { ...DEFAULT_RULES },
    policy: DEFAULT_POLICY,
    decks: [deck('player').cards, deck('dragapult-ex').cards],
    actions: r.history!,
    winner: r.winner,
    reason: r.reason,
    turns: r.turns,
  };
}

describe('gen.ts starts', () => {
  const g = savedGame();
  const path = join(mkdtempSync(join(tmpdir(), 'starts-')), 'games.json');
  writeFileSync(path, JSON.stringify(gamesFile([g])));
  const starts = { path, share: 1 };

  it('finds the first free position of each turn from turn 2 on', () => {
    const { at } = startPositions({ starts });
    const states = replay(g);
    expect(at[0]!.length).toBeGreaterThan(3);
    for (const i of at[0]!) expect(states[i]!.turn).toBeGreaterThanOrEqual(2);
    expect(new Set(at[0]!.map((i) => states[i]!.turn)).size).toBe(at[0]!.length);
  });

  it('starts every game from a saved position with that game\'s decks, and plays it to the end', () => {
    const matches = matchesFor({ games: 6, base: 100, pairs: [{ a: 'A', b: 'B', share: 1 }], starts });
    expect(matches.length).toBe(6);
    for (const m of matches) {
      expect(m.start).toBeDefined();
      expect(m.decks).toEqual(['player', 'dragapult-ex']);
    }
    const r = playMatch(matches[0]!, { A: { kind: 'normal' }, B: { kind: 'normal' } }, null, 0, [g]);
    expect(r.winner).not.toBeNull();
  });
});
