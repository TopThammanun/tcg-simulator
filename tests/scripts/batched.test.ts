// batched.ts (BOT-LEAP.md, L1): games whose network decisions are answered in batches play exactly like the
// one-at-a-time games of gen.ts when the answers are the same (here: model.ts in the test, not the GPU server).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { playBatched, type Infer } from '../../scripts/learn/batched';
import { gameDeps, matchesFor, playMatch, type PlayerSpec } from '../../scripts/learn/gen';
import { ShardWriter } from '../../scripts/learn/shard';
import { MODEL } from '../../src/bots';
import { run } from '../../src/bots/learn/model';

const weights = fileURLToPath(new URL('../../src/bots/learn/weights.json', import.meta.url));
const local: Infer = async (asks) => asks.map((a) => run(MODEL!, a.enc));
const matches = (players: string[], games: number) =>
  matchesFor({ games, base: 4242, pairs: [{ a: players[0]!, b: players[1]!, share: 1 }] });

describe.skipIf(!MODEL)('batched games', () => {
  for (const temperature of [0, 1]) {
    it(`play move for move like gen.ts's games (temperature ${temperature}), several at once`, async () => {
      const players: Record<string, PlayerSpec> = {
        A: { kind: 'net', weights, temperature, record: true },
        B: { kind: 'normal' },
      };
      const ms = matches(['A', 'B'], 4);
      const one = new ShardWriter();
      const want = ms.map((m) => {
        const w = new ShardWriter();
        const r = playMatch(m, players, w, m.id);
        playMatch(m, players, one, m.id);
        return { id: m.id, winner: r.winner, rows: w.toBuffer() };
      });
      // Several games in flight: each finished game's rows are written in one piece, so compare game by game.
      for (const m of ms) {
        const w = new ShardWriter();
        const [got] = await playBatched([m], gameDeps(players), local, w, { concurrent: 1 });
        const exp = want.find((x) => x.id === m.id)!;
        expect(got!.winner).toBe(exp.winner);
        expect(w.toBuffer().equals(exp.rows)).toBe(true);
      }
      const all = new ShardWriter();
      const got = await playBatched(ms, gameDeps(players), local, all, { concurrent: 4, lanes: 2 });
      expect(got.map((r) => [r.m.id, r.winner]).sort()).toEqual(want.map((x) => [x.id, x.winner]).sort());
      expect(all.rows).toBe(one.rows);
    }, 120_000);
  }

  it('the batched look-ahead (deep.ts) plays move for move like search.ts with the same answers and no deadline', async () => {
    const players: Record<string, PlayerSpec> = {
      A: { kind: 'search', weights, width: 3, samples: 2 },
      B: { kind: 'normal' },
    };
    const deep: Record<string, PlayerSpec> = { A: { kind: 'deep', weights, width: 3, samples: 2 }, B: { kind: 'normal' } };
    const ms = matches(['A', 'B'], 2);
    const want = ms.map((m) => playMatch(m, players, null, m.id).winner);
    const got = await playBatched(ms, gameDeps(deep), local, null, { concurrent: 2 });
    expect(got.sort((x, y) => x.m.id - y.m.id).map((r) => r.winner)).toEqual(want);
  }, 300_000);

  it('resigns a side whose value stays below the line, and plays on to check in the games kept going', async () => {
    const players: Record<string, PlayerSpec> = { A: { kind: 'net', weights }, B: { kind: 'net', weights } };
    // Every network decision says "lost": both sides would resign on their second turn.
    const hopeless: Infer = async (asks) => asks.map((a) => ({ value: 0, logits: run(MODEL!, a.enc).logits }));
    const ms = matches(['A', 'B'], 2);
    const quit = await playBatched(ms, gameDeps(players), hopeless, null, { concurrent: 2, resign: { below: 0.05, turns: 2, keepPlaying: 0 } });
    for (const r of quit) {
      expect(r.resigned).toBeDefined();
      expect(r.winner).toBe(1 - r.resigned!);
    }
    const kept = await playBatched(ms, gameDeps(players), hopeless, null, { concurrent: 2, resign: { below: 0.05, turns: 2, keepPlaying: 1 } });
    for (const r of kept) {
      expect(r.resigned).toBeUndefined();
      expect(r.wouldResign).toBeDefined();
      expect(r.winner).not.toBeNull();
    }
  }, 120_000);
});
