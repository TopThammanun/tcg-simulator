// Which sound each thing on the table makes (the sounds themselves need a browser).
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/engine/actions';
import type { GameState } from '../../src/engine/types';
import { animEvents } from '../../src/ui/anim/events';
import { KEY_VOICES, voiceFor } from '../../src/ui/sound';
import { chooseFirst, handCard, scenario } from '../engine/helpers';

const voices = (prev: GameState, next: GameState, a?: Parameters<typeof animEvents>[2]) =>
  animEvents(prev, next, a).map((e) => voiceFor(e)).filter(Boolean);

describe('sounds', () => {
  it('an attack that Knocks Out: the attack, the hit, the Knock Out', () => {
    const s = scenario({ p0: { active: { card: 'dragapult-ex', energy: ['psychic-energy'] } }, p1: { active: 'budew', bench: ['dreepy'] } });
    const a = { t: 'attack', name: 'Jet Headbutt' } as const;
    const n = chooseFirst(apply(s, a));
    const v = voices(s, n, a);
    expect(v).toContain('attack');
    expect(v).toContain('hit');
    expect(v).toContain('ko');
    expect(v.indexOf('attack')).toBeLessThan(v.indexOf('ko'));
  });

  it('playing a card from the hand, a new turn, the end of the game', () => {
    const s = scenario({ p0: { active: 'dreepy', hand: ['budew', 'fire-energy'] }, p1: { active: 'abra' } });
    const bench = { t: 'bench', card: handCard(s, 0, 'budew') } as const;
    expect(voices(s, apply(s, bench), bench)).toEqual(['play']);
    const end = { t: 'end' } as const;
    expect(voices(s, apply(s, end), end)).toContain('turn');
    expect(voiceFor({ t: 'over', winner: 0, reason: '', phase: 'end' })).toBe('win');
    expect(voiceFor({ t: 'over', winner: 1, reason: '', phase: 'end' })).toBe('lose');
  });

  it('with animations off only the sounds that matter play', () => {
    expect([...KEY_VOICES].sort()).toEqual(['attack', 'coin', 'ko', 'lose', 'turn', 'win']);
  });
});
