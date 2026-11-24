// Cards of the major finals to transcribe (BOT-PRO.md P0, data/card-pool.txt): the Dusknoir line, Dedenne, Patrat,
// the Blaziken line, Chi-Yu, Dusk Ball, Prime Catcher, Gwynn, Strange Timepiece, Jamming Tower, Ignition Energy and
// Neo Upper Energy.
import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../../src/engine/actions';
import { canPay, canRetreat, energyOf, maxHp, retreatCost, usableAttacks } from '../../src/engine/rules';
import { keyOf } from '../../src/engine/state';
import type { Action, GameState } from '../../src/engine/types';
import { active, bench, choose, handCard, scenario } from './helpers';

const ability = (s: GameState, name: string): Action => {
  const a = legalActions(s).find((x) => x.t === 'ability' && x.name === name);
  if (!a) throw new Error(`${name} can't be used`);
  return a;
};
const canUse = (s: GameState, name: string) => legalActions(s).some((x) => x.t === 'ability' && x.name === name);
const play = (s: GameState, key: string) => apply(s, { t: 'trainer', card: handCard(s, 0, key) });
const keys = (s: GameState, ids: readonly number[]) => ids.map((c) => keyOf(s, c));

describe('Cursed Blast (Dusclops, Dusknoir)', () => {
  it("Dusknoir puts 13 damage counters on any of the opponent's Pokémon and is Knocked Out: the opponent takes its Prize", () => {
    let s = scenario({
      p0: { active: 'abra', bench: [{ card: 'dusknoir', under: ['duskull', 'dusclops'] }] },
      p1: { active: 'mega-kangaskhan-ex', bench: ['dreepy'] },
    });
    s = apply(s, ability(s, 'Cursed Blast'));
    s = choose(s, active(s, 1).uid);
    expect(active(s, 1).damage).toBe(130);
    expect(s.players[0].bench).toHaveLength(0);
    expect(s.players[1].prizes).toHaveLength(5);
  });

  it('the target is Knocked Out too, and each side takes its Prizes', () => {
    let s = scenario({
      p0: { active: 'abra', bench: [{ card: 'dusknoir', under: ['duskull', 'dusclops'] }] },
      p1: { active: 'mega-kangaskhan-ex', bench: ['dreepy'] },
    });
    s = apply(s, ability(s, 'Cursed Blast'));
    s = choose(s, bench(s, 1, 0).uid);
    expect(s.players[1].bench).toHaveLength(0); // Dreepy (70 HP) Knocked Out
    expect(s.players[0].prizes).toHaveLength(5); // took Dreepy's
    expect(s.players[1].prizes).toHaveLength(5); // took Dusknoir's
    expect(s.players[0].discard.some((c) => keyOf(s, c) === 'dusknoir')).toBe(true);
  });

  it('Dusclops puts 5', () => {
    let s = scenario({ p0: { active: 'abra', bench: [{ card: 'dusclops', under: ['duskull'] }] }, p1: { active: 'mega-kangaskhan-ex' } });
    s = apply(s, ability(s, 'Cursed Blast'));
    expect(active(s, 1).damage).toBe(50);
    expect(s.players[0].bench).toHaveLength(0);
  });

  it("Psyduck's Damp (either side) switches it off", () => {
    const mine = scenario({ p0: { active: 'abra', bench: [{ card: 'dusknoir', under: ['duskull', 'dusclops'] }, 'psyduck'] }, p1: { active: 'dreepy' } });
    const theirs = scenario({ p0: { active: 'abra', bench: [{ card: 'dusknoir', under: ['duskull', 'dusclops'] }] }, p1: { active: 'dreepy', bench: ['psyduck'] } });
    expect(canUse(mine, 'Cursed Blast')).toBe(false);
    expect(canUse(theirs, 'Cursed Blast')).toBe(false);
  });

  it('Battle Cage keeps the counters off Benched Pokémon: only the Active can be picked', () => {
    let s = scenario({
      p0: { active: 'abra', bench: [{ card: 'dusknoir', under: ['duskull', 'dusclops'] }] },
      p1: { active: 'mega-kangaskhan-ex', bench: ['dreepy'] },
      stadium: { card: 'battle-cage', owner: 1 },
    });
    s = apply(s, ability(s, 'Cursed Blast'));
    expect(s.pending).toBeNull();
    expect(active(s, 1).damage).toBe(130);
  });
});

describe('Watchful Eye (Patrat)', () => {
  it('stops Adrena-Brain on both sides', () => {
    const munkidori = { card: 'munkidori', energy: ['darkness-energy'], damage: 40 };
    expect(canUse(scenario({ p0: { active: munkidori }, p1: { active: 'mega-kangaskhan-ex' } }), 'Adrena-Brain')).toBe(true);
    expect(canUse(scenario({ p0: { active: munkidori }, p1: { active: 'mega-kangaskhan-ex', bench: ['patrat'] } }), 'Adrena-Brain')).toBe(false);
    expect(canUse(scenario({ p0: { active: munkidori, bench: ['patrat'] }, p1: { active: 'mega-kangaskhan-ex' } }), 'Adrena-Brain')).toBe(false);
  });
});

describe('Jamming Tower', () => {
  it("switches off every Pokémon Tool: Hero's Cape's HP, Air Balloon's retreat", () => {
    const board = (stadium: boolean) =>
      scenario({
        p0: { active: { card: 'dreepy', tool: 'air-balloon' }, bench: [{ card: 'mega-kangaskhan-ex', tool: 'heros-cape' }] },
        p1: { active: 'abra' },
        ...(stadium ? { stadium: { card: 'jamming-tower', owner: 1 } } : {}),
      });
    expect(maxHp(board(false), bench(board(false), 0, 0))).toBe(maxHp(board(true), bench(board(true), 0, 0)) + 100);
    expect(retreatCost(board(false), 0, active(board(false), 0))).toBe(0);
    expect(retreatCost(board(true), 0, active(board(true), 0))).toBe(1);
  });
});

describe('Ignition Energy, Neo Upper Energy', () => {
  it('Ignition Energy provides {C}{C}{C} on an Evolution Pokémon, {C} on a Basic', () => {
    const s = scenario({
      p0: { active: { card: 'talonflame-ex', under: ['abra', 'kadabra'], energy: ['ignition-energy'] }, bench: [{ card: 'dreepy', energy: ['ignition-energy'] }] },
      p1: { active: 'abra' },
    });
    expect(energyOf(s, active(s, 0))).toEqual(['Colorless', 'Colorless', 'Colorless']);
    expect(energyOf(s, bench(s, 0, 0))).toEqual(['Colorless']);
    expect(usableAttacks(s, 0).map((x) => x.attack.name)).toContain('Talon Hunt');
  });

  it('is discarded at the end of its owner\'s turn', () => {
    let s = scenario({ p0: { active: { card: 'dreepy', energy: ['ignition-energy', 'psychic-energy'] } }, p1: { active: 'abra' } });
    s = apply(s, { t: 'end' });
    expect(keys(s, active(s, 0).energy)).toEqual(['psychic-energy']);
    expect(s.players[0].discard.some((c) => keyOf(s, c) === 'ignition-energy')).toBe(true);
  });

  it('one Ignition Energy pays a retreat cost of 3 on an Evolution Pokémon', () => {
    let s = scenario({ p0: { active: { card: 'dusknoir', under: ['duskull', 'dusclops'], energy: ['ignition-energy'] }, bench: ['abra'] }, p1: { active: 'abra' } });
    expect(canRetreat(s, 0)).toBe(true);
    s = apply(s, { t: 'retreat', to: bench(s, 0, 0).uid });
    expect(keyOf(s, active(s, 0).stack[0]!)).toBe('abra');
    expect(s.players[0].discard.some((c) => keyOf(s, c) === 'ignition-energy')).toBe(true);
  });

  it('Neo Upper Energy provides two Energy of every type on a Stage 2, {C} otherwise', () => {
    const s = scenario({
      p0: { active: { card: 'dusknoir', under: ['duskull', 'dusclops'], energy: ['neo-upper-energy', 'darkness-energy'] }, bench: [{ card: 'dusclops', under: ['duskull'], energy: ['neo-upper-energy'] }] },
      p1: { active: 'abra' },
    });
    expect(energyOf(s, active(s, 0))).toEqual(['Any', 'Any', 'Darkness']);
    expect(usableAttacks(s, 0).map((x) => x.attack.name)).toContain('Shadow Bind'); // {P}{P}{C}
    expect(energyOf(s, bench(s, 0, 0))).toEqual(['Colorless']);
    expect(canPay(['Any', 'Any'], ['Psychic', 'Psychic', 'Colorless'])).toBe(false);
  });
});

describe('Trainers of the finals', () => {
  it('Dusk Ball takes a Pokémon from the bottom 7 cards only, then shuffles', () => {
    const deck = ['dreepy', ...Array(10).fill('psychic-energy'), 'abra', ...Array(6).fill('psychic-energy')];
    let s = scenario({ p0: { active: 'abra', hand: ['dusk-ball'], deck }, p1: { active: 'abra' } });
    s = play(s, 'dusk-ball');
    expect(s.pending!.request.options.map((o) => o.label)).toEqual(['Abra']);
    expect(s.pending!.request.view).toHaveLength(7);
    s = choose(s, s.pending!.request.options[0]!.value);
    expect(keys(s, s.players[0].hand)).toEqual(['abra']);
    expect(s.players[0].deck).toHaveLength(17);
  });

  it('Prime Catcher switches in their Benched Pokémon, then yours', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['prime-catcher'], bench: ['dreepy'] }, p1: { active: 'abra', bench: ['mega-kangaskhan-ex'] } });
    s = play(s, 'prime-catcher');
    expect(keyOf(s, active(s, 1).stack[0]!)).toBe('mega-kangaskhan-ex');
    expect(keyOf(s, active(s, 0).stack[0]!)).toBe('dreepy');
  });

  it('Gwynn discards up to 2 Pokémon without a Rule Box and draws 3 for each', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['gwynn', 'dreepy', 'abra', 'mega-kangaskhan-ex'] }, p1: { active: 'abra' } });
    s = play(s, 'gwynn');
    expect(s.pending!.request.options.map((o) => o.label).sort()).toEqual(['Abra', 'Dreepy']);
    s = choose(s, ...s.pending!.request.options.map((o) => o.value));
    expect(s.players[0].hand).toHaveLength(1 + 6);
  });

  it('Strange Timepiece devolves an evolved {P} Pokémon, the cards to the hand; too much damage Knocks it Out', () => {
    let s = scenario({ p0: { active: 'dreepy', bench: [{ card: 'alakazam', under: ['abra', 'kadabra'], damage: 60 }], hand: ['strange-timepiece'] }, p1: { active: 'abra' } });
    s = play(s, 'strange-timepiece');
    s = choose(s, s.pending!.request.options[0]!.value); // 1 card
    expect(keyOf(s, bench(s, 0, 0).stack.at(-1)!)).toBe('kadabra');
    expect(keys(s, s.players[0].hand)).toEqual(['alakazam']);
    expect(bench(s, 0, 0).evolvedTurn).toBe(s.turn);
    // Both Evolution cards: Abra (50 HP) with 60 damage is Knocked Out.
    let t = scenario({ p0: { active: 'dreepy', bench: [{ card: 'alakazam', under: ['abra', 'kadabra'], damage: 60 }], hand: ['strange-timepiece'] }, p1: { active: 'abra' } });
    t = play(t, 'strange-timepiece');
    t = choose(t, t.pending!.request.options[1]!.value); // 2 cards
    expect(t.players[0].bench).toHaveLength(0);
    expect(t.players[1].prizes).toHaveLength(5);
  });
});

describe('attacks', () => {
  const attack = (s: GameState, name: string) => apply(s, { t: 'attack', name });

  it('Electromagnetic Sonar puts a Trainer from the discard pile into the hand', () => {
    let s = scenario({ p0: { active: { card: 'dedenne', energy: ['psychic-energy'] }, discard: ['ultra-ball', 'dreepy'] }, p1: { active: 'abra' } });
    s = attack(s, 'Electromagnetic Sonar');
    expect(keys(s, s.players[0].hand)).toContain('ultra-ball');
  });

  it('Come and Get You puts up to 3 Duskull from the discard pile onto the Bench', () => {
    let s = scenario({ p0: { active: { card: 'duskull', energy: ['psychic-energy'] }, discard: ['duskull', 'duskull', 'dreepy'] }, p1: { active: 'abra' } });
    s = attack(s, 'Come and Get You');
    s = choose(s, ...s.pending!.request.options.map((o) => o.value));
    expect(s.players[0].bench.map((b) => keyOf(s, b.stack[0]!))).toEqual(['duskull', 'duskull']);
  });

  it('Shadow Bind: the Defending Pokémon can\'t retreat during their next turn', () => {
    let s = scenario({
      p0: { active: { card: 'dusknoir', under: ['duskull', 'dusclops'], energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] } },
      p1: { active: { card: 'mega-kangaskhan-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy', 'psychic-energy'] }, bench: ['abra'] },
    });
    s = attack(s, 'Shadow Bind');
    expect(active(s, 1).damage).toBe(150);
    expect(canRetreat(s, 1)).toBe(false);
  });

  it('Ground Melter does 60 more with a Stadium in play, then discards it', () => {
    let s = scenario({ p0: { active: { card: 'chi-yu', energy: ['fire-energy', 'psychic-energy'] } }, p1: { active: 'mega-kangaskhan-ex' }, stadium: { card: 'battle-cage', owner: 1 } });
    s = attack(s, 'Ground Melter');
    expect(active(s, 1).damage).toBe(120);
    expect(s.stadium).toBeNull();
  });

  it('Seething Spirit attaches a Basic Energy from the discard pile', () => {
    let s = scenario({ p0: { active: { card: 'blaziken-ex', under: ['torchic', 'combusken'] }, discard: ['fire-energy'] }, p1: { active: 'abra' } });
    s = apply(s, ability(s, 'Seething Spirit'));
    expect(keys(s, active(s, 0).energy)).toEqual(['fire-energy']);
  });

  it('Smolder-sault: 200, and Blaziken ex can\'t attack during the next turn', () => {
    let s = scenario({ p0: { active: { card: 'blaziken-ex', under: ['torchic', 'combusken'], energy: ['fire-energy', 'fire-energy'] } }, p1: { active: 'mega-kangaskhan-ex' } });
    s = attack(s, 'Smolder-sault');
    expect(active(s, 1).damage).toBe(200);
    expect(active(s, 0).marks.some((m) => m.kind === 'cant-attack')).toBe(true);
  });
});
