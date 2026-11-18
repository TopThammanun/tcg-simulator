// What the network knows about a card from its printed text alone (category, stage, HP, types, costs,
// damage, and flags read from the effect text). The v2 network builds each card's vector from these plus a
// learned vector per card it was trained with, so a card it has never seen (a new list, a new set) still
// means something, and a list change doesn't change the network's shapes.
import type { CardDef, EnergyType } from '../../data/cards';
import { CARDS } from '../../engine/db';

const TYPES: readonly EnergyType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless'];

/** Effect-text flags: a name and the pattern that sets it (case-insensitive, over attacks, abilities and effect). */
const FLAGS: readonly [string, RegExp][] = [
  ['draw', /\bdraw\b/i],
  ['search-deck', /search your deck/i],
  ['search-pokemon', /search your deck for [^.]*pok[eé]mon/i],
  ['search-energy', /search your deck for [^.]*energy/i],
  ['discard-pile', /from your discard pile/i],
  ['attach', /\battach\b/i],
  ['heal', /\bheal\b/i],
  ['switch-own', /switch (?:this pok[eé]mon|your active)|switch .* with 1 of your benched/i],
  ['gust', /switch (?:in )?1 of your opponent's benched|switch out your opponent's active/i],
  ['bench-damage', /benched pok[eé]mon/i],
  ['counters', /damage counters?/i],
  ['each-opponent', /each of your opponent's|to \d+ of your opponent's pok[eé]mon/i],
  ['coin', /flip (?:a|\d+) coins?/i],
  ['condition', /\b(?:asleep|burned|confused|paralyzed|poisoned)\b/i],
  ['cant-attack', /can't attack/i],
  ['hand-disrupt', /your opponent (?:shuffles|reveals) their hand|opponent's hand/i],
  ['shuffle-hand', /shuffle your hand/i],
  ['top-deck', /top (?:card )?of (?:your|their) deck|in any order/i],
  ['discard-own', /discard (?:\d+ |a |all |up to )?(?:cards?|energy)[^.]*(?:from (?:your|this)|your hand)/i],
  ['discard-their', /discard (?:an|\d+) energy from your opponent|opponent discards/i],
  ['prize', /prize cards?/i],
  ['evolve', /\bevolv/i],
  ['retreat', /retreat cost/i],
  ['damage-plus', /more damage/i],
  ['damage-less', /less damage|prevent all damage|takes \d+ less/i],
  ['copy-attack', /use it as this attack|choose 1 of [^.]*attacks/i],
  ['ability-lock', /abilities? (?:have no effect|can't be used)/i],
  ['item-lock', /can't play (?:any )?item/i],
  ['once-per-turn', /once during your turn/i],
  ['only-first-turn', /first turn/i],
];

/** Numbers per card. */
export const CARD_F = 3 + 5 + 3 + 1 + 1 + 1 + 11 + 11 + 1 + 1 + 1 + 2 * 4 + 5 + 2 + 11 + FLAGS.length;

const n = (x: number, scale: number) => Math.max(0, Math.min(2, x / scale));
const damageOf = (d: string) => Number(d.replace(/[^0-9]/g, '')) || 0;

export function cardFeatures(c: CardDef): number[] {
  const f: number[] = [];
  const put = (...xs: number[]) => f.push(...xs);
  put(c.category === 'pokemon' ? 1 : 0, c.category === 'trainer' ? 1 : 0, c.category === 'energy' ? 1 : 0);
  const sub = new Set(c.subtypes.map((x) => x.toLowerCase()));
  put(sub.has('ex') ? 1 : 0, sub.has('mega') ? 1 : 0, sub.has('tera') ? 1 : 0, sub.has('ace spec') || ('aceSpec' in c && c.aceSpec) ? 1 : 0, sub.has('future') || sub.has('ancient') ? 1 : 0);
  let text = '';
  if (c.category === 'pokemon') {
    put(c.stage === 'Basic' ? 1 : 0, c.stage === 'Stage1' ? 1 : 0, c.stage === 'Stage2' ? 1 : 0);
    put(n(c.hp, 300), n(c.prizes, 3), n(c.retreat, 4));
    for (const t of TYPES) put(c.types.includes(t) ? 1 : 0);
    for (const t of TYPES) put(c.weaknesses.some((w) => w.type === t) ? 1 : 0);
    put(c.resistances.length ? 1 : 0, n(c.abilities.length, 2), c.evolvesFrom ? 1 : 0);
    for (let i = 0; i < 2; i++) {
      const a = c.attacks[i];
      put(a ? n(a.cost.length, 5) : 0, a ? n(a.cost.filter((x) => x === 'Colorless').length, 5) : 0, a ? n(damageOf(a.damage), 300) : 0, a?.effect ? 1 : 0);
    }
    text = [...c.abilities.map((a) => a.effect), ...c.attacks.map((a) => a.effect)].join(' ');
  } else {
    put(0, 0, 0, 0, 0, 0, ...TYPES.map(() => 0), ...TYPES.map(() => 0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  if (c.category === 'trainer') {
    put(c.trainerType === 'Item' ? 1 : 0, c.trainerType === 'Supporter' ? 1 : 0, c.trainerType === 'Stadium' ? 1 : 0, c.trainerType === 'Tool' ? 1 : 0, 1);
    text = c.effect;
  } else put(0, 0, 0, 0, 0);
  if (c.category === 'energy') {
    put(c.energyType === 'Basic' ? 1 : 0, c.energyType === 'Special' ? 1 : 0);
    for (const t of TYPES) put(c.provides === t ? 1 : 0);
    text = c.effect ?? '';
  } else put(0, 0, ...TYPES.map(() => 0));
  for (const [, re] of FLAGS) put(re.test(text) ? 1 : 0);
  if (f.length !== CARD_F) throw new Error(`card features: ${f.length} ≠ ${CARD_F}`);
  return f;
}

/** Features of `keys` (row 0 = no card: zeros), as one flat table. */
export function featureTable(keys: readonly string[]): Float32Array {
  const t = new Float32Array((keys.length + 1) * CARD_F);
  keys.forEach((k, i) => {
    const c = CARDS[k];
    if (c) t.set(cardFeatures(c), (i + 1) * CARD_F);
  });
  return t;
}
