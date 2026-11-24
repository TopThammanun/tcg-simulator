// Every card with effect text in the manifest must be implemented somewhere in the engine.
import { describe, expect, it } from 'vitest';
import { CARDS } from '../../src/engine/db';
import { ABILITIES } from '../../src/engine/effects/abilities';
import { ATTACKS } from '../../src/engine/effects/attacks';
import { ON_ATTACH } from '../../src/engine/effects/energy';
import { TRAINERS } from '../../src/engine/effects/trainers';

// Read by the rules where they apply (rules.ts, combat.ts, actions.ts).
const PASSIVE_ABILITIES = [
  'Skyliner', 'Fairy Zone', 'Cobalt Command', 'Flower Curtain', 'Spherical Shield', 'Midnight Fluttering',
  'Memory Helix', 'Festival Lead', 'Seasoned Skill', 'ACE Nullifier', 'Durable Body', 'Excited Dive',
  // Read by the Abilities they stop: Damp (Cursed Blast), Watchful Eye (Adrena-Brain).
  'Damp', 'Watchful Eye',
  // No card in the pool can trigger it: Plasma Bane ("Colress" cards).
  'Plasma Bane',
];
const TOOLS = ['heros-cape', 'air-balloon', 'brave-bangle', 'lillies-pearl', 'handheld-fan', 'lucky-helmet', 'binding-mochi', 'punk-helmet'];
const STADIUMS = [
  'area-zero-underdepths', 'festival-grounds', 'nighttime-mine', 'team-rockets-watchtower', 'ns-castle', 'risky-ruins',
  'battle-cage', 'academy-at-night', 'gravity-mountain', 'forest-of-vitality', 'jamming-tower',
];
const SPECIAL_ENERGY_IN_RULES = ['mist-energy', 'boomerang-energy', 'growing-grass-energy', 'ignition-energy', 'neo-upper-energy'];
// Attacks whose text only restates how damage works.
const PLAIN_TEXT = new Set<string>();

describe('every card effect is implemented', () => {
  const cards = Object.values(CARDS);

  it.each(cards.filter((c) => c.category === 'pokemon').map((c) => [c.key, c] as const))('%s', (_k, c) => {
    if (c.category !== 'pokemon') return;
    for (const a of c.attacks) {
      if (a.effect && !PLAIN_TEXT.has(a.name)) expect(ATTACKS[a.name], `attack ${a.name}`).toBeDefined();
    }
    for (const ab of c.abilities) {
      expect(ABILITIES[ab.name] !== undefined || PASSIVE_ABILITIES.includes(ab.name), `ability ${ab.name}`).toBe(true);
    }
  });

  it.each(cards.filter((c) => c.category === 'trainer').map((c) => [c.key, c] as const))('%s', (k, c) => {
    if (c.category !== 'trainer') return;
    if (c.trainerType === 'Tool') expect(TOOLS).toContain(k);
    else if (c.trainerType === 'Stadium') expect(STADIUMS).toContain(k);
    else expect(TRAINERS[k], k).toBeDefined();
  });

  it.each(cards.filter((c) => c.category === 'energy' && c.energyType === 'Special').map((c) => [c.key] as const))('%s', (k) => {
    expect(ON_ATTACH[k] !== undefined || SPECIAL_ENERGY_IN_RULES.includes(k)).toBe(true);
  });
});
