// Why a hand card can't be played (the card detail on the play screen says it).
import { describe, expect, it } from 'vitest';
import { apply, createGame, legalActions, TRAINER_NEEDS, whyNotPlayable } from '../../src/engine/actions';
import { TRAINERS } from '../../src/engine/effects/trainers';
import type { GameState } from '../../src/engine/types';
import { handActions } from '../../src/ui/play';
import { deck, DECK_SLUGS, handCard, scenario } from '../engine/helpers';

describe('why a hand card cannot be played', () => {
  it('names the rule that stops it', () => {
    const s = scenario({
      p0: { active: 'dreepy', bench: ['budew', 'budew', 'budew', 'budew', 'budew'], hand: ['meowth-ex', 'judge', 'bosss-orders', 'bosss-orders'] },
      p1: { active: 'abra' },
    });
    expect(whyNotPlayable(s, handCard(s, 0, 'meowth-ex'))).toMatch(/Bench เต็ม/);
    expect(whyNotPlayable(s, handCard(s, 0, 'bosss-orders'))).toMatch(/ไม่มี Pokémon บน Bench/);
    expect(whyNotPlayable(s, handCard(s, 0, 'judge'))).toBeNull();
    const played = { ...s, players: [{ ...s.players[0], supporterPlayed: true }, s.players[1]] as GameState['players'] };
    expect(whyNotPlayable(played, handCard(played, 0, 'judge'))).toMatch(/เล่น Supporter ไปแล้ว/);

    const t = scenario({ p0: { active: 'dreepy', hand: ['fire-energy', 'fire-energy', 'judge', 'judge', 'dragapult-ex'] }, p1: { active: 'abra' }, turn: 1 });
    expect(whyNotPlayable(t, handCard(t, 0, 'judge'))).toMatch(/เทิร์นแรก/);
    expect(whyNotPlayable(t, handCard(t, 0, 'dragapult-ex'))).toMatch(/วิวัฒนาการไม่ได้/);
    const e = apply(t, { t: 'energy', card: handCard(t, 0, 'fire-energy'), target: t.players[0].active!.uid });
    expect(whyNotPlayable(e, handCard(e, 0, 'fire-energy'))).toMatch(/ติดพลังงาน.*ไปแล้ว/);
  });

  it('an evolution says what it needs on the table', () => {
    const s = scenario({ p0: { active: 'abra', hand: ['dragapult-ex', 'drakloak'] }, p1: { active: 'abra' } });
    expect(whyNotPlayable(s, handCard(s, 0, 'drakloak'))).toBe('ต้องมี Dreepy ในสนามก่อน');
    const t = scenario({ p0: { active: 'abra', bench: [{ card: 'dreepy' }], hand: ['drakloak'] }, p1: { active: 'abra' } });
    t.players[0].bench[0]!.enteredTurn = t.turn;
    expect(whyNotPlayable(t, handCard(t, 0, 'drakloak'))).toMatch(/เพิ่งลงสนาม/);
  });

  it('every Trainer with a condition has its own line', () => {
    const missing = Object.entries(TRAINERS)
      .filter(([, impl]) => impl.canPlay)
      .map(([k]) => k)
      .filter((k) => !TRAINER_NEEDS[k]);
    expect(missing).toEqual([]);
  });

  it('gives a reason exactly when the card is not playable (random games, every deck)', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    let checked = 0;
    for (const [i, a] of DECK_SLUGS.entries()) {
      const b = DECK_SLUGS[(i + 3) % DECK_SLUGS.length]!;
      let s: GameState = createGame({ seed: 50 + i, decks: [deck(a), deck(b)], quiet: true });
      for (let n = 0; n < 400 && s.winner === null; n++) {
        if (s.pending) {
          const r = s.pending.request;
          s = apply(s, { t: 'choose', picks: r.options.slice(0, Math.max(r.min, Math.min(1, r.max))).map((o) => o.value) });
          continue;
        }
        const playable = handActions(s);
        for (const c of s.players[s.current].hand) {
          const why = whyNotPlayable(s, c);
          expect(why === null, `${s.cards[c]!.key}: ${why}`).toBe(playable.has(c));
          checked++;
        }
        const legal = legalActions(s);
        s = apply(s, legal[Math.floor(rand() * legal.length)]!);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 60_000);
});
