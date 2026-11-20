// Scenario tests from PLAN.md ("Scenario test ชุดแรก") plus per-deck mechanics.
import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../../src/engine/actions';
import { determinize, viewFor } from '../../src/engine/view';
import { active, bench, choose, handCard, optionFor, scenario } from './helpers';

const attack = (s: ReturnType<typeof scenario>, name: string) => apply(s, { t: 'attack', name });

describe('Festival Lead damage', () => {
  it('Seaking + Brave Bangle does 180 to an ex in one turn (90 twice)', () => {
    let s = scenario({
      p0: { active: { card: 'seaking', under: ['goldeen'], energy: ['fire-energy'], tool: 'brave-bangle' } },
      p1: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
      stadium: { card: 'festival-grounds', owner: 0 },
    });
    s = attack(s, 'Rapid Draw');
    expect(active(s, 1).damage).toBe(90);
    s = choose(s, optionFor(s, 'Rapid Draw'));
    expect(active(s, 1).damage).toBe(180);
  });

  it('adds Gladion for 340 (170 twice), which Kangaskhan + Hero\'s Cape (400) survives', () => {
    let s = scenario({
      p0: {
        active: { card: 'seaking', under: ['goldeen'], energy: ['fire-energy'], tool: 'brave-bangle' },
        hand: ['gladions-final-battle'],
      },
      p1: { active: { card: 'mega-kangaskhan-ex', tool: 'heros-cape' }, bench: ['meowth-ex'] },
      stadium: { card: 'festival-grounds', owner: 0 },
    });
    s = apply(s, { t: 'trainer', card: handCard(s, 0, 'gladions-final-battle') });
    s = attack(s, 'Rapid Draw');
    s = choose(s, optionFor(s, 'Rapid Draw'));
    expect(active(s, 1).damage).toBe(340);
    expect(s.players[1].active).not.toBeNull();
    expect(s.players[0].prizes).toHaveLength(6);
  });

  it('Dipplin with 5 Benched Pokémon + Bangle does 260 to an ex (130 twice)', () => {
    let s = scenario({
      p0: {
        active: { card: 'dipplin', under: ['applin-twm-17'], energy: ['grass-energy'], tool: 'brave-bangle' },
        bench: ['goldeen', 'goldeen', 'rellor', 'shaymin', 'grookey-twm-14'],
      },
      p1: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
      stadium: { card: 'festival-grounds', owner: 0 },
    });
    s = attack(s, 'Do the Wave');
    s = choose(s, optionFor(s, 'Do the Wave'));
    expect(active(s, 1).damage).toBe(260);
  });

  it('after a first-attack KO the opponent picks a new Active and the second attack hits it', () => {
    let s = scenario({
      p0: { active: { card: 'seaking', under: ['goldeen'], energy: ['fire-energy'] } },
      p1: { active: 'abra', bench: ['kadabra', 'dreepy'] },
      stadium: { card: 'festival-grounds', owner: 0 },
    });
    s = attack(s, 'Rapid Draw');
    expect(s.pending?.request.player).toBe(1);
    expect(s.pending?.request.purpose).toBe('promote');
    s = choose(s, optionFor(s, 'Dreepy'));
    expect(s.players[0].prizes).toHaveLength(5);
    s = choose(s, optionFor(s, 'Rapid Draw'));
    expect(active(s, 1).damage).toBe(60);
    expect(s.current).toBe(1);
  });

  it('attacks only once without Festival Grounds', () => {
    let s = scenario({
      p0: { active: { card: 'seaking', under: ['goldeen'], energy: ['fire-energy'] } },
      p1: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
    });
    s = attack(s, 'Rapid Draw');
    expect(s.pending).toBeNull();
    expect(active(s, 1).damage).toBe(60);
    expect(s.current).toBe(1);
  });

  it('Thwackey can search when the Active has Festival Lead, even without Festival Grounds', () => {
    const s = scenario({
      p0: { active: { card: 'seaking', under: ['goldeen'] }, bench: [{ card: 'thwackey', under: ['grookey-twm-14'] }] },
      p1: { active: 'mega-kangaskhan-ex' },
    });
    const uses = legalActions(s).filter((a) => a.t === 'ability');
    expect(uses).toEqual([{ t: 'ability', slot: bench(s, 0, 0).uid, name: 'Boom Boom Groove' }]);
  });

  it('Thwackey cannot search when the Active lacks Festival Lead', () => {
    const s = scenario({
      p0: { active: 'shaymin', bench: [{ card: 'thwackey', under: ['grookey-twm-14'] }] },
      p1: { active: 'mega-kangaskhan-ex' },
    });
    expect(legalActions(s).filter((a) => a.t === 'ability')).toEqual([]);
  });
});

describe("Gladion's Final Battle", () => {
  it('can only be played as the last card in hand', () => {
    const two = scenario({ p0: { active: 'seaking', hand: ['gladions-final-battle', 'ultra-ball'] }, p1: { active: 'abra' } });
    expect(legalActions(two).some((a) => a.t === 'trainer' && two.cards[a.card]!.key === 'gladions-final-battle')).toBe(false);
    const one = scenario({ p0: { active: 'seaking', hand: ['gladions-final-battle'] }, p1: { active: 'abra' } });
    expect(legalActions(one).some((a) => a.t === 'trainer')).toBe(true);
  });

  it("can't be played in the same turn as Boss's Orders", () => {
    let s = scenario({
      p0: { active: 'seaking', hand: ['bosss-orders', 'gladions-final-battle'] },
      p1: { active: 'abra', bench: ['dreepy'] },
    });
    s = apply(s, { t: 'trainer', card: handCard(s, 0, 'bosss-orders') });
    expect(s.players[0].hand).toHaveLength(1);
    expect(legalActions(s).some((a) => a.t === 'trainer')).toBe(false);
  });
});

describe('Paldean Tauros', () => {
  const tauros = { card: 'paldean-tauros', energy: ['fire-energy', 'fire-energy', 'fire-energy'] };
  it('does 180 to a Stage 1', () => {
    const s = attack(scenario({ p0: { active: tauros }, p1: { active: { card: 'ns-zoroark-ex', under: ['ns-zorua'] } } }), 'Spirited Tackle');
    expect(active(s, 1).damage).toBe(180);
  });
  it('does 90 to a Basic', () => {
    const s = attack(scenario({ p0: { active: tauros }, p1: { active: 'meowth-ex' } }), 'Spirited Tackle');
    expect(active(s, 1).damage).toBe(90);
  });
});

describe('Area Zero Underdepths', () => {
  it('leaving play makes a player with more than 5 Benched Pokémon discard down to 5, their choice', () => {
    let s = scenario({
      p0: {
        active: 'teal-mask-ogerpon-ex',
        bench: ['meowth-ex', 'meowth-ex', 'chien-pao', 'latias-ex', 'fezandipiti-ex', 'iron-leaves-ex', 'paldean-tauros'],
      },
      p1: { active: 'goldeen', hand: ['festival-grounds'] },
      stadium: { card: 'area-zero-underdepths', owner: 0 },
      current: 1,
    });
    s = apply(s, { t: 'trainer', card: handCard(s, 1, 'festival-grounds') });
    expect(s.pending?.request).toMatchObject({ player: 0, purpose: 'bench-trim', min: 2, max: 2 });
    s = choose(s, optionFor(s, 'Chien-Pao'), optionFor(s, 'Paldean Tauros'));
    expect(s.players[0].bench.map((b) => s.cards[b.stack[0]!]!.key)).not.toContain('chien-pao');
    expect(s.players[0].bench).toHaveLength(5);
  });

  it('lets a player with a Tera Pokémon in play bench up to 8', () => {
    const s = scenario({
      p0: { active: 'teal-mask-ogerpon-ex', bench: ['meowth-ex', 'meowth-ex', 'chien-pao', 'latias-ex', 'fezandipiti-ex'], hand: ['paldean-tauros'] },
      p1: { active: 'goldeen' },
      stadium: { card: 'area-zero-underdepths', owner: 0 },
    });
    expect(legalActions(s).some((a) => a.t === 'bench')).toBe(true);
  });
});

describe('Bench protection', () => {
  const pumpReady = { card: 'wellspring-mask-ogerpon-ex', energy: ['water-energy', 'grass-energy', 'grass-energy'] };

  it('Rabsca stops Wellspring Mask Ogerpon ex from damaging the Bench', () => {
    let s = scenario({
      p0: { active: pumpReady },
      p1: { active: 'goldeen', bench: [{ card: 'rabsca', under: ['rellor'] }, 'meowth-ex'] },
    });
    s = attack(s, 'Torrential Pump');
    s = choose(s, 1); // yes: shuffle 3 Energy in (all 3 are taken without asking)
    s = choose(s, optionFor(s, 'Meowth ex'));
    expect(bench(s, 1, 1).damage).toBe(0);
  });

  it("Shaymin protects Benched Pokémon without a Rule Box from Fezandipiti, but not Meowth ex", () => {
    const fez = { card: 'fezandipiti-ex', energy: ['grass-energy', 'grass-energy', 'grass-energy'] };
    const base = scenario({ p0: { active: fez }, p1: { active: 'goldeen', bench: ['shaymin', 'goldeen', 'meowth-ex'] } });
    let s = choose(attack(base, 'Cruel Arrow'), bench(base, 1, 1).uid);
    expect(bench(s, 1, 1).damage).toBe(0);
    s = choose(attack(base, 'Cruel Arrow'), bench(base, 1, 2).uid);
    expect(bench(s, 1, 2).damage).toBe(100);
  });

  it('Tera Pokémon take no attack damage on the Bench', () => {
    const fez = { card: 'fezandipiti-ex', energy: ['grass-energy', 'grass-energy', 'grass-energy'] };
    const base = scenario({ p0: { active: fez }, p1: { active: 'goldeen', bench: ['teal-mask-ogerpon-ex'] } });
    const s = choose(attack(base, 'Cruel Arrow'), bench(base, 1, 0).uid);
    expect(bench(s, 1, 0).damage).toBe(0);
  });
});

describe('meta deck mechanics', () => {
  const dragapult = { card: 'dragapult-ex', under: ['dreepy', 'drakloak'], energy: ['fire-energy', 'psychic-energy'] };

  it('Phantom Dive puts 6 damage counters on the Bench as chosen, even on a Benched Tera Pokémon', () => {
    let s = scenario({ p0: { active: dragapult }, p1: { active: 'mega-kangaskhan-ex', bench: ['teal-mask-ogerpon-ex', 'chien-pao'] } });
    s = attack(s, 'Phantom Dive');
    expect(s.pending?.request).toMatchObject({ purpose: 'counters', min: 6, max: 6, repeat: true });
    const [oger, pao] = [bench(s, 1, 0).uid, bench(s, 1, 1).uid];
    s = choose(s, oger, oger, oger, oger, pao, pao);
    expect(bench(s, 1, 0).damage).toBe(40);
    expect(bench(s, 1, 1).damage).toBe(20);
    expect(active(s, 1).damage).toBe(200);
  });

  it('Phantom Dive counters are stopped by Rabsca (effects of attacks)', () => {
    // Rabsca is the only Benched Pokémon, so all 6 counters go to it without asking.
    const s = attack(
      scenario({ p0: { active: dragapult }, p1: { active: 'mega-kangaskhan-ex', bench: [{ card: 'rabsca', under: ['rellor'] }] } }),
      'Phantom Dive',
    );
    expect(bench(s, 1, 0).damage).toBe(0);
  });

  it("a copied attack uses the copying Pokémon's type for Weakness (N's Zoroark ex copying N's Reshiram)", () => {
    const zoroark = { card: 'ns-zoroark-ex', under: ['ns-zorua'], energy: ['darkness-energy', 'darkness-energy'] };
    let s = scenario({ p0: { active: zoroark, bench: ['ns-reshiram'] }, p1: { active: 'latias-ex', bench: ['abra'] } });
    s = attack(s, 'Night Joker');
    s = choose(s, optionFor(s, 'Virtuous Flame'));
    expect(s.players[1].active).not.toBeNull();
    expect(s.players[0].prizes).toHaveLength(4); // 170 x2 (Latias ex is weak to Darkness) = 340 >= 210
  });

  it("Alakazam's Powerful Hand places 2 counters per card in hand, ignoring Resistance", () => {
    const zam = { card: 'alakazam', under: ['abra', 'kadabra'], energy: ['psychic-energy'] };
    const s = attack(scenario({ p0: { active: zam, hand: Array(5).fill('psychic-energy') }, p1: { active: 'mega-kangaskhan-ex' } }), 'Powerful Hand');
    expect(active(s, 1).damage).toBe(100);
  });

  it('Mega Pokémon ex give up 3 Prize cards', () => {
    const bolt = { card: 'raging-bolt-ex', energy: ['lightning-energy', 'fighting-energy'] };
    let s = scenario({
      p0: { active: bolt, bench: [{ card: 'teal-mask-ogerpon-ex', energy: ['grass-energy', 'grass-energy', 'grass-energy', 'grass-energy'] }] },
      p1: { active: 'mega-kangaskhan-ex', bench: ['meowth-ex'] },
    });
    s = attack(s, 'Bellowing Thunder');
    s = choose(s, ...s.pending!.request.options.slice(0, 5).map((o) => o.value)); // 5 x 70 = 350
    expect(s.players[0].prizes).toHaveLength(3); // Meowth ex is promoted without asking (only choice)
  });
});

describe('answers to a choice', () => {
  // The play screen answers with a Svelte $state proxy; a state holding it could not be posted to the bot's worker.
  it('are copied into the state, so it stays plain data that can be posted to a worker', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['ultra-ball', 'judge', 'cyrano', 'crispin'], deck: ['dreepy'] }, p1: { active: 'abra' } });
    s = apply(s, { t: 'trainer', card: handCard(s, 0, 'ultra-ball') });
    expect(s.pending?.request.purpose).toBe('discard-cost');
    const picks = s.pending!.request.options.slice(0, 2).map((o) => o.value);
    const proxied = new Proxy(picks, {});
    s = apply(s, { t: 'choose', picks: proxied });
    expect(s.pending).not.toBeNull(); // the search is next: the discard answers stay in pending.answers
    expect(() => structuredClone(s)).not.toThrow();
    picks.length = 0;
    expect(s.pending!.answers[0]).toHaveLength(2);
  });
});

describe('what a choice shows', () => {
  it('a deck search shows the whole deck; the options are the cards it may take; the opponent sees neither', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['buddy-buddy-poffin'], deck: ['dreepy', 'dreepy', 'meowth-ex', 'psychic-energy', 'ultra-ball'] }, p1: { active: 'abra' } });
    s = apply(s, { t: 'trainer', card: handCard(s, 0, 'buddy-buddy-poffin') });
    const req = s.pending!.request;
    expect([...req.view!].sort()).toEqual([...s.players[0].deck].sort());
    for (const o of req.options) expect(req.view).toContain(o.card);
    expect(req.options.length).toBeLessThan(req.view!.length);
    const theirs = viewFor(s, 1).pending!.request;
    expect(theirs.options).toEqual([]);
    expect(theirs.view).toBeUndefined();
    expect(viewFor(s, 0).pending!.request.view).toEqual(req.view);
  });

  it('with pickPrizes you take the face-down Prize cards you point at; bots and look-ahead take them in order', () => {
    const board = (pickPrizes: boolean) => {
      const s = scenario({ p0: { active: { card: 'dragapult-ex', energy: ['psychic-energy'] } }, p1: { active: 'budew', bench: ['dreepy'] } });
      return { ...s, rules: { ...s.rules, pickPrizes } };
    };
    const s = board(true);
    const prizes = s.players[0].prizes.slice();
    let n = attack(s, 'Jet Headbutt');
    const req = n.pending!.request;
    expect(req).toMatchObject({ player: 0, hint: 'prizes', min: 1, max: 1 });
    expect(req.options.map((o) => o.value)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const o of req.options) expect(o.card).toBeUndefined();
    n = choose(n, 4);
    expect(n.players[0].hand).toContain(prizes[4]);
    expect(n.players[0].prizes).toEqual(prizes.filter((_, i) => i !== 4));
    // Without the rule (bots, the simulator): the first Prize, no question.
    const auto = attack(board(false), 'Jet Headbutt');
    expect(auto.pending?.request.hint).not.toBe('prizes');
    expect(auto.players[0].hand).toContain(prizes[0]);
    expect(determinize(s, 1, 7).rules.pickPrizes).toBe(false);
  });
});

describe('turn rules', () => {
  it('the first player cannot attack or play a Supporter on turn 1', () => {
    const s = scenario({ p0: { active: { card: 'abra', energy: ['psychic-energy'] }, hand: ['judge'] }, p1: { active: 'abra' }, turn: 1 });
    expect(legalActions(s).filter((a) => a.t === 'attack' || a.t === 'trainer')).toEqual([]);
  });

  it('allows one Energy attachment per turn', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['psychic-energy', 'psychic-energy'] }, p1: { active: 'abra' } });
    s = apply(s, { t: 'energy', card: handCard(s, 0, 'psychic-energy'), target: active(s, 0).uid });
    expect(legalActions(s).some((a) => a.t === 'energy')).toBe(false);
  });

  it('does not evolve a Pokémon put into play this turn', () => {
    let s = scenario({ p0: { active: 'abra', hand: ['dreepy', 'drakloak'] }, p1: { active: 'abra' } });
    s = apply(s, { t: 'bench', card: handCard(s, 0, 'dreepy') });
    expect(legalActions(s).some((a) => a.t === 'evolve')).toBe(false);
  });

  it('loses when the deck is empty at the start of the turn', () => {
    let s = scenario({ p0: { active: 'abra' }, p1: { active: 'abra', deck: [] } });
    s = apply(s, { t: 'end' });
    expect(s.winner).toBe(0);
  });
});
