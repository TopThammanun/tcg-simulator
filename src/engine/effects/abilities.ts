// Abilities a player uses or that trigger. Passive Abilities (Skyliner, Fairy Zone, Cobalt Command,
// Flower Curtain, Spherical Shield, Midnight Fluttering, Memory Helix, Festival Lead, Seasoned Skill,
// ACE Nullifier) are read directly by the rules where they apply; Damp and Watchful Eye by the Abilities they stop.
import { tx, verb } from '../../i18n';
import { uniqueByKey, type Ctx } from '../ctx';
import { def, isBasicEnergy, isTrainerType } from '../db';
import { abilityOn, addCondition, isActive, maxHp, provides, stadiumIs, switchIn } from '../rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../state';
import type { GameState, PlayerId, Slot } from '../types';
import { attachFrom, discardStadium } from './common';

export interface AbilityImpl {
  /** activated: used with an 'ability' action. bench/evolve: offered when played from hand. */
  when: 'activated' | 'bench' | 'evolve';
  /** Once per turn across all of the player's Pokémon ("You can't use more than 1 X Ability each turn"). */
  shared?: string;
  canUse?(s: GameState, p: PlayerId, slot: Slot): boolean;
  use(ctx: Ctx, p: PlayerId, slot: Slot): void;
}

export const ABILITIES: Record<string, AbilityImpl> = {
  'Run Errand': {
    when: 'activated',
    shared: 'Run Errand',
    canUse: (s, _p, slot) => isActive(s, slot),
    use: (ctx, p) => ctx.draw(p, 2),
  },
  'Flip the Script': {
    when: 'activated',
    shared: 'Flip the Script',
    canUse: (s, p) => s.players[p].koLastTurn,
    use: (ctx, p) => ctx.draw(p, 3),
  },
  Trade: {
    when: 'activated',
    canUse: (s, p) => s.players[p].hand.length > 0,
    use: (ctx, p) => {
      const [c] = ctx.pickCards(p, ctx.ps(p).hand, { purpose: 'discard-cost', prompt: tx('Trade: ทิ้งการ์ด 1 ใบ', 'Trade: discard a card'), source: 'ns-zoroark-ex' });
      ctx.toDiscard(p, [c!]);
      ctx.draw(p, 2);
    },
  },
  'Run Away Draw': {
    when: 'activated',
    use: (ctx, p, slot) => {
      if (ctx.draw(p, 3) === 0) return;
      const ps = ctx.ps(p);
      ctx.detachSlot(p, slot);
      ps.deck.push(...slot.stack, ...slot.energy, ...(slot.tool !== null ? [slot.tool] : []));
      ctx.shuffle(p);
      ctx.log(tx('Dudunsparce ถูกสับกลับเข้าเด็ค', 'Dudunsparce is shuffled back into the deck'), p);
    },
  },
  'Recon Directive': {
    when: 'activated',
    canUse: (s, p) => s.players[p].deck.length > 0,
    use: (ctx, p) => {
      const ps = ctx.ps(p);
      const top = ps.deck.slice(0, 2);
      const [keep] = ctx.pickCards(p, top, { purpose: 'take', prompt: tx('Recon Directive: เลือก 1 ใบขึ้นมือ', 'Recon Directive: choose a card to put into your hand'), secret: true, source: 'drakloak', view: top });
      ctx.toHand(p, [keep!]);
      for (const c of top) if (c !== keep) ps.deck.push(ctx.take(p, c));
    },
  },
  'Attract Customers': {
    when: 'activated',
    canUse: (s, p, slot) => isActive(s, slot) && s.players[p].deck.length > 0,
    use: (ctx, p) => {
      const top = ctx.ps(p).deck.slice(0, 6);
      const sups = top.filter((c) => isTrainerType(keyOf(ctx.s, c), 'Supporter'));
      const picked = ctx.pickCards(p, uniqueByKey(ctx.s, sups), {
        purpose: 'take',
        prompt: tx('Attract Customers: เลือก Supporter', 'Attract Customers: choose a Supporter'),
        min: 0,
        secret: true,
        reveal: true,
        view: top,
        source: 'tatsugiri',
      });
      ctx.toHand(p, picked);
      ctx.shuffle(p);
    },
  },
  'Boom Boom Groove': {
    when: 'activated',
    canUse: (s, p) => {
      const a = s.players[p].active;
      return !!a && abilityOn(s, a, 'Festival Lead') && s.players[p].deck.length > 0;
    },
    use: (ctx, p) => {
      const picked = ctx.search(p, () => true, { prompt: tx('Boom Boom Groove: ค้นการ์ด 1 ใบ', 'Boom Boom Groove: search for a card'), max: 1, source: 'thwackey', any: true });
      ctx.toHand(p, picked);
      ctx.shuffle(p);
    },
  },
  'Teal Dance': {
    when: 'activated',
    canUse: (s, p) => s.players[p].hand.some((c) => def(keyOf(s, c)).category === 'energy' && def(keyOf(s, c)).name === 'Grass Energy'),
    use: (ctx, p, slot) => {
      const grass = ctx.ps(p).hand.filter((c) => ctx.cardName(c) === 'Grass Energy');
      const [e] = ctx.pickCards(p, uniqueByKey(ctx.s, grass), { purpose: 'attach', prompt: tx('Teal Dance: ติด Grass Energy', 'Teal Dance: attach a Grass Energy'), source: 'teal-mask-ogerpon-ex' });
      ctx.take(p, e!);
      slot.energy.push(e!);
      ctx.draw(p, 1);
    },
  },
  'Adrena-Brain': {
    when: 'activated',
    canUse: (s, p, slot) =>
      !inPlayWith(s, 'Watchful Eye') &&
      slot.energy.some((e) => provides(keyOf(s, e)) === 'Darkness') &&
      slotsOf(s.players[p]).some((sl) => sl.damage > 0) &&
      adrenaTargets(s, p).length > 0,
    use: (ctx, p) => {
      const s = ctx.s;
      const damaged = slotsOf(s.players[p]).filter((sl) => sl.damage > 0);
      const [from] = ctx.pickSlots(p, damaged, { purpose: 'target', prompt: tx('Adrena-Brain: ย้ายตัวนับดาเมจจาก Pokémon ของคุณ', 'Adrena-Brain: move damage counters from one of your Pokémon'), source: 'munkidori', hint: 'own' });
      const most = Math.min(3, from!.damage / 10);
      const n = ctx.pickOption(p, tx('จะย้ายกี่ตัว?', 'How many?'), Array.from({ length: most }, (_, i) => tx(`${i + 1} ตัว`, String(i + 1))), 'munkidori') + 1;
      const [to] = ctx.pickSlots(p, adrenaTargets(s, p), { purpose: 'target', prompt: tx('ย้ายไปไว้ที่ Pokémon ตัวไหนของอีกฝั่ง', "Move them to one of your opponent's Pokémon"), source: 'munkidori' });
      from!.damage -= 10 * n;
      to!.damage += 10 * n;
      ctx.log(tx(`Adrena-Brain ย้ายตัวนับดาเมจ ${n} ตัวไปที่ ${topDef(s, to!).name}`, `Adrena-Brain moves ${n} damage ${n === 1 ? 'counter' : 'counters'} to ${topDef(s, to!).name}`), p);
    },
  },
  'Subjugating Chains': {
    when: 'activated',
    shared: 'Subjugating Chains',
    canUse: (s, p) => !!s.players[p].active && chainsTargets(s, p).length > 0,
    use: (ctx, p) => {
      const [to] = ctx.pickSlots(p, chainsTargets(ctx.s, p), { purpose: 'switch', prompt: tx('Subjugating Chains: เลือก Pokémon {D} มาเป็นตัวหลัก', 'Subjugating Chains: choose a {D} Pokémon to switch in'), source: 'pecharunt-ex' });
      switchIn(ctx, p, to!);
      addCondition(ctx, to!, 'poisoned');
    },
  },

  // Dusclops (5) and Dusknoir (13): the counters, then this Pokémon is Knocked Out (the opponent takes its Prize);
  // Psyduck's Damp switches it off. Battle Cage keeps the counters off Benched Pokémon.
  'Cursed Blast': {
    when: 'activated',
    canUse: (s, p) => !inPlayWith(s, 'Damp') && cursedTargets(s, p).length > 0,
    use: (ctx, p, slot) => {
      const s = ctx.s;
      const n = topKey(s, slot) === 'dusknoir' ? 13 : 5;
      const [to] = ctx.pickSlots(p, cursedTargets(s, p), { purpose: 'counters', prompt: tx(`Cursed Blast: วางตัวนับดาเมจ ${n} ตัวบน Pokémon ตัวไหน`, `Cursed Blast: put ${n} damage counters on which Pokémon?`), source: topKey(s, slot) });
      to!.damage += 10 * n;
      ctx.log(tx(`Cursed Blast: วางตัวนับดาเมจ ${n} ตัวบน ${topDef(s, to!).name}`, `Cursed Blast: ${n} damage counters on ${topDef(s, to!).name}`), p);
      slot.damage = Math.max(slot.damage, maxHp(s, slot));
    },
  },
  'Seething Spirit': {
    when: 'activated',
    canUse: (s, p) => s.players[p].discard.some((c) => isBasicEnergy(keyOf(s, c))),
    use: (ctx, p) => {
      const s = ctx.s;
      const energy = uniqueByKey(s, ctx.ps(p).discard.filter((c) => isBasicEnergy(keyOf(s, c))));
      const [e] = ctx.pickCards(p, energy, { purpose: 'attach', prompt: tx('Seething Spirit: ติดพลังงานพื้นฐานจากกองทิ้ง', 'Seething Spirit: attach a Basic Energy from your discard pile'), source: 'blaziken-ex' });
      const [to] = ctx.pickSlots(p, slotsOf(ctx.ps(p)), { purpose: 'attach', prompt: tx('ติดให้ Pokémon ตัวไหน', 'Attach it to which Pokémon?'), source: 'blaziken-ex' });
      attachFrom(ctx, p, e!, to!);
    },
  },

  // ---- triggered when played from hand ----
  'Last-Ditch Catch': {
    when: 'bench',
    shared: 'Last-Ditch',
    use: (ctx, p) => {
      const picked = ctx.search(p, (k) => isTrainerType(k, 'Supporter'), { prompt: tx('Last-Ditch Catch: ค้น Supporter', 'Last-Ditch Catch: search for a Supporter'), max: 1, source: 'meowth-ex' });
      ctx.toHand(p, picked);
      ctx.shuffle(p);
    },
  },
  'Snow Sink': {
    when: 'bench',
    canUse: (s) => s.stadium !== null,
    use: (ctx) => discardStadium(ctx),
  },
  'Rapid Vernier': {
    when: 'bench',
    canUse: (s, p) => !!s.players[p].active,
    use: (ctx, p, slot) => {
      switchIn(ctx, p, slot);
      const others = slotsOf(ctx.ps(p)).filter((sl) => sl.uid !== slot.uid);
      const energy = others.flatMap((sl) => sl.energy);
      const picked = ctx.pickCards(p, energy, {
        purpose: 'energy',
        prompt: tx('Rapid Vernier: ย้ายพลังงานจาก Pokémon ตัวอื่นมาที่ Iron Leaves ex (กี่ใบก็ได้)', 'Rapid Vernier: move any amount of Energy from your other Pokémon to Iron Leaves ex'),
        min: 0,
        max: energy.length,
        source: 'iron-leaves-ex',
      });
      for (const e of picked) {
        const from = others.find((sl) => sl.energy.includes(e))!;
        from.energy = from.energy.filter((x) => x !== e);
        slot.energy.push(e);
      }
    },
  },
  'Psychic Draw': {
    when: 'evolve',
    use: (ctx, p, slot) => ctx.draw(p, topKey(ctx.s, slot) === 'alakazam' ? 3 : 2),
  },
};

function adrenaTargets(s: GameState, p: PlayerId): Slot[] {
  const o = s.players[opp(p)];
  const all = slotsOf(o);
  return stadiumIs(s, 'battle-cage') ? all.filter((sl) => sl.uid === o.active?.uid) : all;
}

/** A Pokémon in play on either side has this Ability switched on (Damp, Watchful Eye). */
function inPlayWith(s: GameState, name: string): boolean {
  return ([0, 1] as const).some((q) => slotsOf(s.players[q]).some((sl) => abilityOn(s, sl, name)));
}

function cursedTargets(s: GameState, p: PlayerId): Slot[] {
  const o = s.players[opp(p)];
  const all = slotsOf(o);
  return stadiumIs(s, 'battle-cage') ? all.filter((sl) => sl.uid === o.active?.uid) : all;
}

function chainsTargets(s: GameState, p: PlayerId): Slot[] {
  return s.players[p].bench.filter((sl) => topDef(s, sl).types.includes('Darkness') && topKey(s, sl) !== 'pecharunt-ex');
}

/** Ability impls for the Pokémon in `slot` that can be used now with an 'ability' action. */
export function activatedAbilities(s: GameState, p: PlayerId, slot: Slot): string[] {
  const out: string[] = [];
  for (const a of topDef(s, slot).abilities) {
    const impl = ABILITIES[a.name];
    if (!impl || impl.when !== 'activated') continue;
    if (!abilityOn(s, slot, a.name)) continue;
    if (slot.usedAbility[a.name] === s.turn) continue;
    if (impl.shared && s.players[p].namedUsed.includes(impl.shared)) continue;
    if (impl.canUse && !impl.canUse(s, p, slot)) continue;
    out.push(a.name);
  }
  return out;
}

/** Offer the "when played from hand" Ability of a Pokémon that just came into play or evolved. */
export function offerTrigger(ctx: Ctx, p: PlayerId, slot: Slot, when: 'bench' | 'evolve'): void {
  const s = ctx.s;
  for (const a of topDef(s, slot).abilities) {
    const impl = ABILITIES[a.name];
    if (!impl || impl.when !== when || !abilityOn(s, slot, a.name)) continue;
    if (impl.shared && ctx.ps(p).namedUsed.includes(impl.shared)) continue;
    if (impl.canUse && !impl.canUse(s, p, slot)) continue;
    if (!ctx.yesNo(p, tx(`จะใช้ Ability ${a.name} ไหม?`, `Use Ability ${a.name}?`), topKey(s, slot), a.name)) continue;
    if (impl.shared) ctx.ps(p).namedUsed.push(impl.shared);
    slot.usedAbility[a.name] = s.turn;
    ctx.log(tx(`${ctx.who(p)} ใช้ Ability ${a.name}`, `${ctx.who(p)} ${verb(ctx.who(p), 'use')} Ability ${a.name}`), p);
    impl.use(ctx, p, slot);
  }
}
