// Behaviour of individual cards (PLAN.md: ทุกการ์ดมี unit test). Trickier rules first.
import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../../src/engine/actions';
import { maxHp, retreatCost, usableAttacks } from '../../src/engine/rules';
import { keyOf } from '../../src/engine/state';
import type { GameState } from '../../src/engine/types';
import { active, bench, choose, handCard, optionFor, scenario } from './helpers';

const play = (s: GameState, key: string) => apply(s, { t: 'trainer', card: handCard(s, s.current, key) });
const benchFromHand = (s: GameState, key: string) => apply(s, { t: 'bench', card: handCard(s, s.current, key) });
const attack = (s: GameState, name: string) => apply(s, { t: 'attack', name });
const keys = (s: GameState, ids: number[]) => ids.map((c) => keyOf(s, c));
const abilityActions = (s: GameState) => legalActions(s).filter((a) => a.t === 'ability');

describe('Items', () => {
  it('Ultra Ball discards 2 other cards and puts a Pokémon into the hand', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['ultra-ball', 'judge', 'cyrano'], deck: ['dreepy', 'psychic-energy'] }, p1: { active: 'abra' } });
    s = play(s, 'ultra-ball');
    expect(s.players[0].hand).toEqual([]); // discard: both others (exactly 2), forced
    expect(keys(s, s.players[0].discard).sort()).toEqual(['cyrano', 'judge', 'ultra-ball']);
    s = choose(s, optionFor(s, 'Dreepy'));
    expect(keys(s, s.players[0].hand)).toEqual(['dreepy']);
  });

  it("Buddy-Buddy Poffin benches Basics with 70 HP or less, and Meowth ex's Ability does not trigger", () => {
    let s = scenario({ p0: { active: 'abra', hand: ['buddy-buddy-poffin'], deck: ['dreepy', 'dreepy', 'meowth-ex', 'mega-kangaskhan-ex'] }, p1: { active: 'abra' } });
    s = play(s, 'buddy-buddy-poffin');
    const opts = s.pending!.request.options.map((o) => o.label);
    expect(opts).not.toContain('Meowth ex'); // 170 HP
    expect(opts).not.toContain('Mega Kangaskhan ex');
    s = choose(s, ...s.pending!.request.options.map((o) => o.value));
    expect(s.players[0].bench).toHaveLength(2);
    expect(s.pending).toBeNull();
  });

  it('Rare Candy evolves Abra straight to Alakazam and offers Psychic Draw (3 cards)', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['rare-candy', 'alakazam'] }, p1: { active: 'abra' } });
    s = play(s, 'rare-candy');
    expect(s.pending?.request.purpose).toBe('yesno');
    s = choose(s, 1);
    expect(keys(s, active(s, 0).stack)).toEqual(['abra', 'alakazam']);
    expect(s.players[0].hand).toHaveLength(3);
  });

  it('Rare Candy is not playable on a Basic put into play this turn or in the first turns', () => {
    const early = scenario({ p0: { active: 'abra', hand: ['rare-candy', 'alakazam'] }, p1: { active: 'abra' }, turn: 2 });
    expect(legalActions(early).some((a) => a.t === 'trainer')).toBe(false);
  });

  it('Energy Switch moves a Basic Energy between your Pokémon', () => {
    let s = scenario({ p0: { active: 'abra', bench: [{ card: 'slowpoke', energy: ['psychic-energy'] }], hand: ['energy-switch'] }, p1: { active: 'abra' } });
    s = play(s, 'energy-switch'); // only one source, one energy, one destination: no questions
    expect(active(s, 0).energy).toHaveLength(1);
    expect(bench(s, 0, 0).energy).toHaveLength(0);
  });

  it('Tool Scrapper discards up to 2 Tools in play', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['tool-scrapper'] }, p1: { active: { card: 'mega-kangaskhan-ex', tool: 'heros-cape' } } });
    s = play(s, 'tool-scrapper');
    s = choose(s, active(s, 1).uid);
    expect(active(s, 1).tool).toBeNull();
    expect(keys(s, s.players[1].discard)).toContain('heros-cape');
  });

  it('Special Red Card needs the opponent at 3 or fewer Prizes; their hand goes under the deck and they draw 3', () => {
    const notYet = scenario({ p0: { active: 'abra', hand: ['special-red-card'] }, p1: { active: 'abra', prizes: 4 } });
    expect(legalActions(notYet).some((a) => a.t === 'trainer')).toBe(false);
    let s = scenario({ p0: { active: 'abra', hand: ['special-red-card'] }, p1: { active: 'abra', prizes: 3, hand: ['judge', 'judge', 'judge', 'judge', 'judge', 'judge'] } });
    s = play(s, 'special-red-card');
    expect(s.players[1].hand).toHaveLength(3);
    expect(keys(s, s.players[1].deck.slice(-6))).toEqual(Array(6).fill('judge'));
  });

  it('Unfair Stamp needs a Knock Out last turn: you draw 5, they draw 2', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['unfair-stamp'] }, p1: { active: 'abra', hand: ['judge', 'judge', 'judge'] } });
    expect(legalActions(s).some((a) => a.t === 'trainer')).toBe(false);
    s = { ...s, players: [{ ...s.players[0], koLastTurn: true }, s.players[1]] };
    s = play(s, 'unfair-stamp');
    expect([s.players[0].hand.length, s.players[1].hand.length]).toEqual([5, 2]);
  });
});

describe('Supporters', () => {
  it("Lillie's Determination draws 8 with 6 Prizes left, 6 otherwise", () => {
    const s6 = play(scenario({ p0: { active: 'abra', hand: ['lillies-determination', 'judge'] }, p1: { active: 'abra' } }), 'lillies-determination');
    expect(s6.players[0].hand).toHaveLength(8);
    const s5 = play(scenario({ p0: { active: 'abra', hand: ['lillies-determination'], prizes: 5 }, p1: { active: 'abra' } }), 'lillies-determination');
    expect(s5.players[0].hand).toHaveLength(6);
  });

  it('Judge: each player shuffles their hand in and draws 4', () => {
    const s = play(scenario({ p0: { active: 'abra', hand: ['judge'] }, p1: { active: 'abra', hand: Array(8).fill('judge') } }), 'judge');
    expect([s.players[0].hand.length, s.players[1].hand.length]).toEqual([4, 4]);
  });

  it('Crispin: one Basic Energy to the hand, a different type attached', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['crispin'], deck: ['grass-energy', 'fire-energy', 'grass-energy'] }, p1: { active: 'abra' } });
    s = play(s, 'crispin');
    s = choose(s, ...s.pending!.request.options.map((o) => o.value)); // Grass + Fire
    s = choose(s, optionFor(s, 'Grass Energy')); // Grass to hand, Fire attached (one Pokémon: no question)
    expect(keys(s, s.players[0].hand)).toEqual(['grass-energy']);
    expect(keys(s, active(s, 0).energy)).toEqual(['fire-energy']);
  });

  it('Cyrano searches up to 3 Pokémon ex', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['cyrano'], deck: ['latias-ex', 'meowth-ex', 'abra', 'raging-bolt-ex'] }, p1: { active: 'abra' } });
    s = play(s, 'cyrano');
    expect(s.pending!.request.options.map((o) => o.label).sort()).toEqual(['Latias ex', 'Meowth ex', 'Raging Bolt ex']);
  });

  it("Kieran (+30) and Black Belt's Training (+40) add damage against an Active Pokémon ex", () => {
    const base = { card: 'abra', energy: ['psychic-energy'] };
    // No Benched Pokémon, so Kieran's only option (+30) is taken without asking.
    const k = play(scenario({ p0: { active: base, hand: ['kieran'] }, p1: { active: 'mega-kangaskhan-ex' } }), 'kieran');
    expect(active(attack(k, 'Teleportation Attack'), 1).damage).toBe(40);
    const b = attack(play(scenario({ p0: { active: base, hand: ['black-belts-training'] }, p1: { active: 'mega-kangaskhan-ex' } }), 'black-belts-training'), 'Teleportation Attack');
    expect(active(b, 1).damage).toBe(50);
  });
});

describe('Abilities', () => {
  it('Meowth ex from hand: Last-Ditch Catch searches a Supporter, once per turn across Meowth ex', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['meowth-ex', 'meowth-ex'], deck: ['judge', 'cyrano'] }, p1: { active: 'abra' } });
    s = choose(benchFromHand(s, 'meowth-ex'), 1);
    s = choose(s, optionFor(s, 'Judge'));
    expect(keys(s, s.players[0].hand)).toContain('judge');
    s = benchFromHand(s, 'meowth-ex');
    expect(s.pending).toBeNull(); // the second Meowth ex is not offered the Ability
  });

  it('Run Errand works only in the Active Spot and once per turn across Kangaskhan', () => {
    const s = scenario({ p0: { active: 'mega-kangaskhan-ex', bench: ['mega-kangaskhan-ex'] }, p1: { active: 'abra' } });
    expect(abilityActions(s)).toEqual([{ t: 'ability', slot: active(s, 0).uid, name: 'Run Errand' }]);
    const after = apply(s, abilityActions(s)[0]!);
    expect(after.players[0].hand).toHaveLength(2);
    expect(abilityActions(after)).toEqual([]);
  });

  it("Team Rocket's Watchtower switches off {C} Pokémon's Abilities", () => {
    const s = scenario({ p0: { active: 'mega-kangaskhan-ex' }, p1: { active: 'abra' }, stadium: { card: 'team-rockets-watchtower', owner: 1 } });
    expect(abilityActions(s)).toEqual([]);
  });

  it("Flutter Mane in the Active Spot switches off the opponent's Active Pokémon's Abilities", () => {
    const s = scenario({ p0: { active: 'mega-kangaskhan-ex' }, p1: { active: 'flutter-mane' } });
    expect(abilityActions(s)).toEqual([]);
  });

  it('Teal Dance attaches a Grass Energy from hand and draws a card', () => {
    let s = scenario({ p0: { active: 'teal-mask-ogerpon-ex', hand: ['grass-energy'] }, p1: { active: 'abra' } });
    s = apply(s, abilityActions(s)[0]!);
    expect(active(s, 0).energy).toHaveLength(1);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].energyAttached).toBe(false); // not the turn's attachment
  });

  it('Rapid Vernier switches Iron Leaves ex in and moves Energy to it', () => {
    let s = scenario({ p0: { active: { card: 'abra', energy: ['grass-energy', 'grass-energy'] }, hand: ['iron-leaves-ex'] }, p1: { active: 'abra' } });
    s = choose(benchFromHand(s, 'iron-leaves-ex'), 1);
    s = choose(s, ...s.pending!.request.options.map((o) => o.value));
    expect(keyOf(s, active(s, 0).stack[0]!)).toBe('iron-leaves-ex');
    expect(active(s, 0).energy).toHaveLength(2);
  });

  it('Snow Sink discards the Stadium in play', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['chien-pao'] }, p1: { active: 'abra' }, stadium: { card: 'festival-grounds', owner: 1 } });
    s = choose(benchFromHand(s, 'chien-pao'), 1);
    expect(s.stadium).toBeNull();
  });

  it('Subjugating Chains switches in a Benched {D} Pokémon and Poisons it; Poison does 10 between turns', () => {
    let s = scenario({ p0: { active: 'pecharunt-ex', bench: ['ns-zorua'] }, p1: { active: 'abra' } });
    s = apply(s, abilityActions(s)[0]!);
    expect(keyOf(s, active(s, 0).stack[0]!)).toBe('ns-zorua');
    expect(active(s, 0).conditions).toEqual(['poisoned']);
    s = apply(s, { t: 'end' });
    expect(active(s, 0).damage).toBe(10);
  });

  it('Adrena-Brain moves up to 3 damage counters to an opposing Pokémon', () => {
    let s = scenario({ p0: { active: { card: 'munkidori', energy: ['darkness-energy'], damage: 40 } }, p1: { active: 'mega-kangaskhan-ex' } });
    s = apply(s, abilityActions(s)[0]!);
    s = choose(s, 2); // 3 counters
    expect([active(s, 0).damage, active(s, 1).damage]).toEqual([10, 30]);
  });

  it('Memory Helix: Mew ex uses a Benched Pokémon\'s attack with its own Energy', () => {
    const s = scenario({ p0: { active: { card: 'mew-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] }, bench: ['latias-ex'] }, p1: { active: 'mega-kangaskhan-ex' } });
    const helix = usableAttacks(s, 0).find((x) => x.from !== undefined);
    expect(helix?.attack.name).toBe('Eon Blade');
    const after = apply(s, { t: 'attack', name: 'Eon Blade', from: bench(s, 0, 0).uid });
    expect(active(after, 1).damage).toBe(200);
  });
});

describe('passive Abilities', () => {
  it("Lillie's Clefairy ex makes the opponent's Dragon Pokémon weak to Psychic", () => {
    const s = attack(
      scenario({ p0: { active: { card: 'latias-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] }, bench: ['lillies-clefairy-ex'] }, p1: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'] }, bench: ['dreepy'] } }),
      'Eon Blade',
    );
    expect(s.players[0].prizes).toHaveLength(4); // 400 >= 320
  });

  it('Cobalt Command: Future Pokémon do 20 more to the Active (not Iron Crown ex itself)', () => {
    const s = attack(
      scenario({ p0: { active: { card: 'iron-leaves-ex', energy: ['grass-energy', 'grass-energy', 'grass-energy'] }, bench: ['iron-crown-ex'] }, p1: { active: { card: 'mega-kangaskhan-ex', tool: 'heros-cape' } } }),
      'Prism Edge',
    );
    expect(active(s, 1).damage).toBe(200);
  });

  it('Seasoned Skill: Blood Moon costs {C} less per Prize the opponent has taken', () => {
    const s = scenario({ p0: { active: { card: 'bloodmoon-ursaluna-ex', energy: ['grass-energy', 'grass-energy'] } }, p1: { active: 'abra', prizes: 3 } });
    expect(usableAttacks(s, 0).map((x) => x.attack.name)).toContain('Blood Moon');
  });

  it('Skyliner: Basic Pokémon have no Retreat Cost; Air Balloon takes 2 off', () => {
    const s = scenario({ p0: { active: 'mega-kangaskhan-ex', bench: ['latias-ex', { card: 'drakloak', under: ['dreepy'], tool: 'air-balloon' }] }, p1: { active: 'abra' } });
    expect(retreatCost(s, 0, active(s, 0))).toBe(0);
    expect(retreatCost(s, 0, bench(s, 0, 1))).toBe(0);
  });
});

describe('Tools and Special Energy', () => {
  it("Hero's Cape +100 HP, Growing Grass Energy +20 HP on {G}, Gravity Mountain -30 on Stage 2", () => {
    const s = scenario({
      p0: { active: { card: 'mega-kangaskhan-ex', tool: 'heros-cape' }, bench: [{ card: 'teal-mask-ogerpon-ex', energy: ['growing-grass-energy'] }, { card: 'dragapult-ex', under: ['dreepy', 'drakloak'] }] },
      p1: { active: 'abra' },
      stadium: { card: 'gravity-mountain', owner: 1 },
    });
    expect([maxHp(s, active(s, 0)), maxHp(s, bench(s, 0, 0)), maxHp(s, bench(s, 0, 1))]).toEqual([400, 230, 290]);
  });

  it("Lillie's Pearl: a Knocked Out Lillie's Pokémon gives up 1 fewer Prize", () => {
    const s = attack(
      scenario({ p0: { active: { card: 'latias-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] } }, p1: { active: { card: 'lillies-clefairy-ex', tool: 'lillies-pearl', damage: 100 }, bench: ['abra'] } }),
      'Eon Blade',
    );
    expect(s.players[0].prizes).toHaveLength(5);
  });

  it('Lucky Helmet draws 2 when the Active is damaged; Handheld Fan moves Energy to the attacker\'s Bench', () => {
    const atk = { card: 'latias-ex', energy: ['psychic-energy', 'psychic-energy', 'fire-energy'] };
    const helmet = attack(scenario({ p0: { active: atk }, p1: { active: { card: 'mega-kangaskhan-ex', tool: 'lucky-helmet' } } }), 'Eon Blade');
    expect(helmet.players[1].hand).toHaveLength(3); // 2 from Helmet + the turn's draw
    let fan = attack(scenario({ p0: { active: atk, bench: ['abra'] }, p1: { active: { card: 'mega-kangaskhan-ex', tool: 'handheld-fan' } } }), 'Eon Blade');
    fan = choose(fan, fan.pending!.request.options[0]!.value);
    expect(active(fan, 0).energy).toHaveLength(2);
    expect(bench(fan, 0, 0).energy).toHaveLength(1);
  });

  it('Binding Mochi: a Poisoned attacker does 40 more', () => {
    let s = scenario({ p0: { active: { card: 'abra', energy: ['psychic-energy'], tool: 'binding-mochi' } }, p1: { active: 'mega-kangaskhan-ex' } });
    s = { ...s, players: [{ ...s.players[0], active: { ...active(s, 0), conditions: ['poisoned'] } }, s.players[1]] };
    expect(active(attack(s, 'Teleportation Attack'), 1).damage).toBe(50);
  });

  it('Telepathic Psychic Energy on a {P} Pokémon benches up to 2 Basic {P} Pokémon; Enriching Energy draws 4', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['telepathic-psychic-energy'], deck: ['abra', 'latias-ex', 'meowth-ex'] }, p1: { active: 'abra' } });
    s = apply(s, { t: 'energy', card: handCard(s, 0, 'telepathic-psychic-energy'), target: active(s, 0).uid });
    s = choose(s, ...s.pending!.request.options.map((o) => o.value));
    expect(s.players[0].bench).toHaveLength(2);
    let e = scenario({ p0: { active: 'abra', hand: ['enriching-energy'] }, p1: { active: 'abra' } });
    e = apply(e, { t: 'energy', card: handCard(e, 0, 'enriching-energy'), target: active(e, 0).uid });
    expect(e.players[0].hand).toHaveLength(4);
  });

  it('Mist Energy blocks effects of attacks (Confusion, damage counters) but not damage', () => {
    const s = attack(
      scenario({ p0: { active: { card: 'munkidori', energy: ['psychic-energy', 'psychic-energy'] } }, p1: { active: { card: 'mega-kangaskhan-ex', energy: ['mist-energy'] } } }),
      'Mind Bend',
    );
    expect(active(s, 1).damage).toBe(60);
    expect(active(s, 1).conditions).toEqual([]);
  });

  it('Boomerang Energy comes back after an attack discards it (Slowking copying Trifrost)', () => {
    // Kyurem's own Trifrost needs {M}, which no deck has; Slowking copies it from the top of the deck.
    const s = attack(
      scenario({ p0: { active: { card: 'slowking', under: ['slowpoke'], energy: ['psychic-energy', 'boomerang-energy'] }, deck: ['kyurem', 'psychic-energy'] }, p1: { active: 'mega-kangaskhan-ex' } }),
      'Seek Inspiration',
    );
    expect(keys(s, active(s, 0).energy)).toEqual(['boomerang-energy']);
    expect(active(s, 1).damage).toBe(110);
  });
});

describe('Stadiums', () => {
  it('Festival Grounds: Pokémon with Energy attached cannot be affected by Special Conditions', () => {
    const s = attack(
      scenario({ p0: { active: { card: 'munkidori', energy: ['psychic-energy', 'psychic-energy'] } }, p1: { active: { card: 'mega-kangaskhan-ex', energy: ['psychic-energy'] } }, stadium: { card: 'festival-grounds', owner: 1 } }),
      'Mind Bend',
    );
    expect(active(s, 1).conditions).toEqual([]);
  });

  it('Risky Ruins puts 2 damage counters on a non-{D} Basic benched during your turn', () => {
    const s = benchFromHand(scenario({ p0: { active: 'abra', hand: ['dreepy', 'ns-zorua'] }, p1: { active: 'abra' }, stadium: { card: 'risky-ruins', owner: 1 } }), 'dreepy');
    expect(bench(s, 0, 0).damage).toBe(20);
    const dark = benchFromHand(s, 'ns-zorua');
    expect(bench(dark, 0, 1).damage).toBe(0);
  });

  it('Nighttime Mine: Tera Pokémon attacks cost {C} more', () => {
    const s = scenario({ p0: { active: { card: 'teal-mask-ogerpon-ex', energy: ['grass-energy', 'grass-energy', 'grass-energy'] } }, p1: { active: 'abra' }, stadium: { card: 'nighttime-mine', owner: 1 } });
    expect(usableAttacks(s, 0)).toEqual([]);
  });

  it("N's Castle: N's Pokémon have no Retreat Cost", () => {
    const s = scenario({ p0: { active: 'ns-zekrom', bench: ['abra'] }, p1: { active: 'abra' }, stadium: { card: 'ns-castle', owner: 0 } });
    expect(retreatCost(s, 0, active(s, 0))).toBe(0);
  });

  it('Battle Cage stops damage counters on the Bench from attacks', () => {
    let s = scenario({ p0: { active: { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] } }, p1: { active: 'mega-kangaskhan-ex', bench: ['abra', 'dreepy'] }, stadium: { card: 'battle-cage', owner: 1 } });
    s = attack(s, 'Phantom Dive');
    s = choose(s, ...Array(6).fill(bench(s, 1, 0).uid));
    expect(bench(s, 1, 0).damage).toBe(0);
  });

  it('Academy at Night puts a card from the hand on top of the deck, once per turn', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['kyurem', 'judge'] }, p1: { active: 'abra' }, stadium: { card: 'academy-at-night', owner: 0 } });
    s = apply(s, { t: 'stadium' });
    s = choose(s, handCard(s, 0, 'kyurem'));
    expect(keyOf(s, s.players[0].deck[0]!)).toBe('kyurem');
    expect(legalActions(s).some((a) => a.t === 'stadium')).toBe(false);
  });
});

describe('attack effects', () => {
  it('Seek Inspiration copies the attack of a non-Rule-Box Pokémon discarded from the top of the deck', () => {
    // Kyurem has one attack and there are exactly 3 targets, so nothing needs asking.
    const s = attack(
      scenario({ p0: { active: { card: 'slowking', under: ['slowpoke'], energy: ['psychic-energy', 'psychic-energy'] }, deck: ['kyurem', 'psychic-energy'] }, p1: { active: 'mega-kangaskhan-ex', bench: ['latias-ex', 'meowth-ex'] } }),
      'Seek Inspiration',
    );
    expect([active(s, 1).damage, bench(s, 1, 0).damage, bench(s, 1, 1).damage]).toEqual([110, 110, 110]);
    expect(active(s, 0).energy).toHaveLength(0); // Trifrost discards the user's Energy
  });

  it('Seek Inspiration does nothing when the top card has a Rule Box', () => {
    const s = attack(
      scenario({ p0: { active: { card: 'slowking', under: ['slowpoke'], energy: ['psychic-energy', 'psychic-energy'] }, deck: ['latias-ex'] }, p1: { active: 'mega-kangaskhan-ex' } }),
      'Seek Inspiration',
    );
    expect(active(s, 1).damage).toBe(0);
  });

  it('Twin Shotels ignores Weakness and Tera, and Rabsca depends on the ruling switch', () => {
    const crown = { card: 'iron-crown-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] };
    const make = (pierce: boolean) => {
      const s = scenario({ p0: { active: crown }, p1: { active: 'latias-ex', bench: ['teal-mask-ogerpon-ex', { card: 'rabsca', under: ['rellor'] }] } });
      return { ...s, rules: { twinShotelsPiercesBenchShields: pierce } };
    };
    const off = choose(attack(make(false), 'Twin Shotels'), active(make(false), 1).uid, bench(make(false), 1, 0).uid);
    expect(active(off, 1).damage).toBe(50); // Latias ex is weak to Darkness, not Psychic; no Weakness anyway
    expect(bench(off, 1, 0).damage).toBe(0); // Rabsca shields the Bench by default
    const on = choose(attack(make(true), 'Twin Shotels'), active(make(true), 1).uid, bench(make(true), 1, 0).uid);
    expect(bench(on, 1, 0).damage).toBe(50); // pierces Rabsca and Tera
  });

  it("Dig: on heads, prevent damage and effects done to it during the opponent's next turn", () => {
    let s = scenario({ p0: { active: { card: 'dunsparce-tef-128', energy: ['psychic-energy', 'psychic-energy'] } }, p1: { active: { card: 'latias-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] } } });
    for (let coin = 0; coin < 50; coin++) {
      const t = attack({ ...s, rng: { ...s.rng, coin } }, 'Dig');
      if (active(t, 0).marks.some((m) => m.kind === 'protected')) {
        s = t;
        break;
      }
    }
    const hit = attack(s, 'Eon Blade');
    expect(active(hit, 0).damage).toBe(0);
  });

  it("Itchy Pollen stops Items next turn; Clutch stops retreating; Eon Blade can't attack next turn", () => {
    const pollen = attack(scenario({ p0: { active: 'budew' }, p1: { active: 'abra', hand: ['ultra-ball', 'judge', 'judge'] } }), 'Itchy Pollen');
    expect(legalActions(pollen).some((a) => a.t === 'trainer' && keyOf(pollen, a.card) === 'ultra-ball')).toBe(false);
    const clutch = attack(scenario({ p0: { active: { card: 'yveltal', energy: ['darkness-energy'] } }, p1: { active: { card: 'abra', energy: ['psychic-energy'] }, bench: ['abra'] } }), 'Clutch');
    expect(legalActions(clutch).some((a) => a.t === 'retreat')).toBe(false);
    let eon = attack(scenario({ p0: { active: { card: 'latias-ex', energy: ['psychic-energy', 'psychic-energy', 'psychic-energy'] } }, p1: { active: 'mega-kangaskhan-ex' } }), 'Eon Blade');
    eon = apply(eon, { t: 'end' });
    expect(legalActions(eon).some((a) => a.t === 'attack')).toBe(false);
  });

  it('Psychic (Rabsca) does 30 more per Energy on the opposing Active', () => {
    const s = attack(scenario({ p0: { active: { card: 'rabsca', under: ['rellor'], energy: ['grass-energy'] } }, p1: { active: { card: 'mega-kangaskhan-ex', energy: ['psychic-energy', 'psychic-energy'] } } }), 'Psychic');
    expect(active(s, 1).damage).toBe(70);
  });
});
