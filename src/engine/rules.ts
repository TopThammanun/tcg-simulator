import type { Attack, EnergyType } from '../data/cards';
import type { Ctx } from './ctx';
import { def, energyCard, hasRuleBox, isLilliesPokemon } from './db';
import { keyOf, opp, slotsOf, topDef, topKey } from './state';
import type { Condition, GameState, PlayerId, Slot, SlotId } from './types';

// ---------- stadium, abilities ----------

export function stadiumKey(s: GameState): string | undefined {
  return s.stadium ? keyOf(s, s.stadium.card) : undefined;
}

export const stadiumIs = (s: GameState, key: string) => stadiumKey(s) === key;

export function ownerOf(s: GameState, slot: Slot): PlayerId {
  return s.cards[slot.stack[0]!]!.owner;
}

export const isActive = (s: GameState, slot: Slot) => s.players[ownerOf(s, slot)].active?.uid === slot.uid;

/** Whether the Pokémon in `slot` currently has the named Ability (not switched off). */
export function abilityOn(s: GameState, slot: Slot, name: string): boolean {
  const d = topDef(s, slot);
  if (!d.abilities.some((a) => a.name === name)) return false;
  if (stadiumIs(s, 'team-rockets-watchtower') && d.types.includes('Colorless')) return false;
  if (name !== 'Midnight Fluttering' && isActive(s, slot)) {
    const other = s.players[opp(ownerOf(s, slot))].active;
    if (other && abilityOn(s, other, 'Midnight Fluttering')) return false;
  }
  return true;
}

export function slotsWithAbility(s: GameState, p: PlayerId, name: string): Slot[] {
  return slotsOf(s.players[p]).filter((sl) => abilityOn(s, sl, name));
}

export function toolKey(s: GameState, slot: Slot): string | undefined {
  return slot.tool === null ? undefined : keyOf(s, slot.tool);
}

// ---------- HP, energy, costs ----------

export function maxHp(s: GameState, slot: Slot): number {
  const d = topDef(s, slot);
  let hp = d.hp;
  if (toolKey(s, slot) === 'heros-cape') hp += 100;
  if (d.types.includes('Grass')) {
    hp += 20 * slot.energy.filter((e) => keyOf(s, e) === 'growing-grass-energy').length;
  }
  if (stadiumIs(s, 'gravity-mountain') && d.stage === 'Stage2') hp -= 30;
  return hp;
}

export const hpLeft = (s: GameState, slot: Slot) => maxHp(s, slot) - slot.damage;

/** Type a single attached Energy card provides. */
export function provides(key: string): EnergyType {
  const e = energyCard(key);
  if (!e) throw new Error(`${key} is not Energy`);
  if (e.provides) return e.provides;
  if (key === 'growing-grass-energy') return 'Grass';
  if (key === 'telepathic-psychic-energy') return 'Psychic';
  return 'Colorless';
}

export function energyOf(s: GameState, slot: Slot): EnergyType[] {
  return slot.energy.map((e) => provides(keyOf(s, e)));
}

export function attackCost(s: GameState, user: Slot, attack: Attack): EnergyType[] {
  const cost = attack.cost.slice();
  if (stadiumIs(s, 'nighttime-mine') && topDef(s, user).tera) cost.push('Colorless');
  if (attack.name === 'Blood Moon' && abilityOn(s, user, 'Seasoned Skill')) {
    let less = 6 - s.players[opp(ownerOf(s, user))].prizes.length;
    for (let i = cost.length - 1; i >= 0 && less > 0; i--) {
      if (cost[i] === 'Colorless') {
        cost.splice(i, 1);
        less--;
      }
    }
  }
  return cost;
}

export function canPay(have: EnergyType[], cost: EnergyType[]): boolean {
  const pool = have.slice();
  let colorless = 0;
  for (const c of cost) {
    if (c === 'Colorless') {
      colorless++;
      continue;
    }
    const i = pool.indexOf(c);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return pool.length >= colorless;
}

/** Attacks the Active Pokémon can use now: its own plus, for Mew ex, its Benched Pokémon's. */
export function usableAttacks(s: GameState, p: PlayerId): { attack: Attack; from?: SlotId }[] {
  const ps = s.players[p];
  const user = ps.active;
  if (!user || s.turn === 1) return [];
  if (user.marks.some((m) => m.kind === 'cant-attack' && m.turn === s.turn)) return [];
  const have = energyOf(s, user);
  const out: { attack: Attack; from?: SlotId }[] = [];
  const ok = (a: Attack) =>
    canPay(have, attackCost(s, user, a)) &&
    !user.marks.some((m) => m.kind === 'cant-use' && m.attack === a.name && m.turn === s.turn);
  for (const a of topDef(s, user).attacks) if (ok(a)) out.push({ attack: a });
  if (abilityOn(s, user, 'Memory Helix')) {
    for (const b of ps.bench) for (const a of topDef(s, b).attacks) if (ok(a)) out.push({ attack: a, from: b.uid });
  }
  return out;
}

// ---------- retreat, bench ----------

export function retreatCost(s: GameState, p: PlayerId, slot: Slot): number {
  const d = topDef(s, slot);
  if (d.stage === 'Basic' && slotsWithAbility(s, p, 'Skyliner').length > 0) return 0;
  if (stadiumIs(s, 'ns-castle') && d.name.startsWith("N's ")) return 0;
  const c = d.retreat - (toolKey(s, slot) === 'air-balloon' ? 2 : 0);
  return Math.max(0, c);
}

export function canRetreat(s: GameState, p: PlayerId): boolean {
  const ps = s.players[p];
  const a = ps.active;
  if (!a || ps.retreated || ps.bench.length === 0) return false;
  if (a.marks.some((m) => m.kind === 'cant-retreat' && m.turn === s.turn)) return false;
  return a.energy.length >= retreatCost(s, p, a);
}

export function benchLimit(s: GameState, p: PlayerId): number {
  return stadiumIs(s, 'area-zero-underdepths') && slotsOf(s.players[p]).some((sl) => topDef(s, sl).tera) ? 8 : 5;
}

/** Discard Benched Pokémon down to the limit; `order` says who discards first. */
export function trimBenches(ctx: Ctx, order: PlayerId[]): void {
  for (const p of order) {
    const ps = ctx.ps(p);
    const over = ps.bench.length - benchLimit(ctx.s, p);
    if (over <= 0) continue;
    const gone = ctx.pickSlots(p, ps.bench, {
      purpose: 'bench-trim',
      prompt: `ทิ้ง Pokémon บน Bench ${over} ตัวให้เหลือ ${benchLimit(ctx.s, p)}`,
      min: over,
      max: over,
    });
    for (const sl of gone) {
      ctx.log(`${ctx.who(p)} ทิ้ง ${topDef(ctx.s, sl).name} จาก Bench`, p);
      ctx.discardSlot(p, sl);
    }
  }
}

// ---------- conditions, switching ----------

export function addCondition(ctx: Ctx, slot: Slot, c: Condition): void {
  if (stadiumIs(ctx.s, 'festival-grounds') && slot.energy.length > 0) return;
  if (!isActive(ctx.s, slot) || slot.conditions.includes(c)) return;
  slot.conditions.push(c);
  ctx.log(`${topDef(ctx.s, slot).name} ติดสถานะ ${c === 'poisoned' ? 'Poisoned' : 'Confused'}`);
}

/** Festival Grounds: Pokémon with Energy recover from Special Conditions. */
export function cleanConditions(s: GameState): void {
  if (!stadiumIs(s, 'festival-grounds')) return;
  for (const p of [0, 1] as const) {
    const a = s.players[p].active;
    if (a && a.energy.length > 0 && a.conditions.length > 0) a.conditions = [];
  }
}

/** Effects of attacks, Special Conditions and marks end when a Pokémon leaves the Active Spot. */
export function leaveActive(slot: Slot): void {
  slot.conditions = [];
  slot.marks = [];
}

/** Swap p's Active with one of p's Benched Pokémon. */
export function switchIn(ctx: Ctx, p: PlayerId, benched: Slot): void {
  const ps = ctx.ps(p);
  const i = ps.bench.findIndex((b) => b.uid === benched.uid);
  if (i < 0) throw new Error('switch target is not on the bench');
  const old = ps.active;
  if (old) {
    leaveActive(old);
    ps.bench[i] = old;
  } else {
    ps.bench.splice(i, 1);
  }
  ps.active = benched;
  ctx.log(`${ctx.who(p)}: ${topDef(ctx.s, benched).name} ขึ้นเป็นตัวหลัก`, p);
}

/** p picks one of their Benched Pokémon and switches it with the Active. */
export function chooseSwitch(ctx: Ctx, p: PlayerId, source?: string): boolean {
  const ps = ctx.ps(p);
  if (ps.bench.length === 0 || !ps.active) return false;
  const [to] = ctx.pickSlots(p, ps.bench, { purpose: 'switch', prompt: 'เลือก Pokémon บน Bench มาเป็นตัวหลัก', source });
  switchIn(ctx, p, to!);
  return true;
}

export function promote(ctx: Ctx, p: PlayerId): void {
  const ps = ctx.ps(p);
  if (ps.active || ps.bench.length === 0) return;
  const [to] = ctx.pickSlots(p, ps.bench, { purpose: 'promote', prompt: 'เลือก Pokémon ขึ้นเป็นตัวหลัก' });
  switchIn(ctx, p, to!);
}

// ---------- knock outs, prizes, winning ----------

/**
 * Knock Out every Pokémon at 0 HP, take Prizes, check for a winner, then promote new Actives.
 * `byAttack` holds slots that were damaged by the attack that just finished.
 */
export function checkKOs(ctx: Ctx, byAttack: ReadonlySet<SlotId> = new Set()): void {
  const s = ctx.s;
  const durableTried = new Set<SlotId>();
  for (;;) {
    const kos: { p: PlayerId; slot: Slot }[] = [];
    for (const p of [0, 1] as const) {
      for (const sl of slotsOf(s.players[p])) {
        if (sl.damage < maxHp(s, sl)) continue;
        // Durable Body (Annihilape): a Knock Out by attack damage is survived at 10 HP on heads.
        if (byAttack.has(sl.uid) && abilityOn(s, sl, 'Durable Body') && !durableTried.has(sl.uid)) {
          durableTried.add(sl.uid);
          if (ctx.flip()) {
            sl.damage = maxHp(s, sl) - 10;
            ctx.log(`Durable Body: ${topDef(s, sl).name} ไม่ถูก Knock Out เหลือ HP 10`, p);
            continue;
          }
        }
        kos.push({ p, slot: sl });
      }
    }
    if (kos.length === 0) break;

    for (const { p, slot } of kos) {
      const d = topDef(s, slot);
      const attacked = byAttack.has(slot.uid);
      let prizes = d.prizes;
      if (attacked && toolKey(s, slot) === 'lillies-pearl' && isLilliesPokemon(topKey(s, slot))) prizes -= 1;
      ctx.log(`${d.name} ของ${ctx.who(p)} ถูก Knock Out`, p);
      ctx.discardSlot(p, slot);
      if (s.current !== p) {
        s.players[p].koThisTurn = true;
        if (attacked) s.players[p].koByAttackThisTurn = true;
      }
      takePrizes(ctx, opp(p), prizes);
    }
  }

  // Also covers Pokémon leaving play without a Knock Out (Tuck Tail, Run Away Draw).
  const wins = ([0, 1] as const).map(
    (p) => s.players[p].prizes.length === 0 || slotsOf(s.players[opp(p)]).length === 0,
  );
  if (wins[0] && wins[1]) ctx.end('draw', 'ทั้งสองฝั่งชนะพร้อมกัน');
  if (wins[0] || wins[1]) {
    const w: PlayerId = wins[0] ? 0 : 1;
    ctx.end(w, s.players[w].prizes.length === 0 ? 'เก็บ Prize ครบ' : 'อีกฝั่งไม่มี Pokémon ในสนาม');
  }
  promote(ctx, opp(s.current));
  promote(ctx, s.current);
  trimBenches(ctx, [s.current, opp(s.current)]);
}

function takePrizes(ctx: Ctx, p: PlayerId, n: number): void {
  const ps = ctx.ps(p);
  const k = Math.min(n, ps.prizes.length);
  if (k <= 0) return;
  if (p === 0 && ctx.s.rules.pickPrizes && k < ps.prizes.length) {
    // By position only (the options name no card): face down, which one is taken tells no one anything.
    const at = ctx.choose({
      player: p,
      purpose: 'take',
      hint: 'prizes',
      prompt: `เลือก Prize ${k} ใบ`,
      options: ps.prizes.map((_, i) => ({ value: i, label: `Prize ${i + 1}` })),
      min: k,
      max: k,
    });
    const taken = at.map((i) => ps.prizes[i]!);
    for (const i of [...at].sort((a, b) => b - a)) ps.prizes.splice(i, 1);
    ps.hand.push(...taken);
  } else ps.hand.push(...ps.prizes.splice(0, k));
  ctx.log(`${ctx.who(p)} เก็บ Prize ${k} ใบ (เหลือ ${ps.prizes.length})`, p);
}

// ---------- turns ----------

export function endTurn(ctx: Ctx): void {
  const s = ctx.s;
  const p = s.current;
  s.players[p].buffs = [];

  // Between turns: Poison puts 1 damage counter on the Poisoned Active Pokémon.
  cleanConditions(s);
  for (const q of [p, opp(p)] as const) {
    const a = s.players[q].active;
    if (a?.conditions.includes('poisoned')) {
      a.damage += 10;
      ctx.log(`${topDef(s, a).name} โดนพิษ 10`, q);
    }
  }
  checkKOs(ctx);

  startTurn(ctx, opp(p));
}

export function startTurn(ctx: Ctx, p: PlayerId): void {
  const s = ctx.s;
  s.turn += 1;
  s.current = p;
  const ps = s.players[p];
  ps.supporterPlayed = false;
  ps.energyAttached = false;
  ps.retreated = false;
  ps.stadiumPlayed = false;
  ps.namedUsed = [];
  ps.buffs = [];
  ps.koLastTurn = ps.koThisTurn;
  ps.koByAttackLastTurn = ps.koByAttackThisTurn;
  ps.koThisTurn = false;
  ps.koByAttackThisTurn = false;
  for (const q of [0, 1] as const) {
    for (const sl of slotsOf(s.players[q])) {
      if (sl.marks.length) sl.marks = sl.marks.filter((m) => m.turn >= s.turn);
    }
  }
  ctx.log(`— เทิร์น ${s.turn}: ${ctx.who(p)} —`, p);
  if (ps.deck.length === 0) ctx.end(opp(p), `${ctx.who(p)} ไม่มีการ์ดให้จั่ว`);
  ctx.draw(p, 1);
}

// ---------- misc helpers used by effects ----------

export function hasRuleBoxSlot(s: GameState, slot: Slot): boolean {
  return hasRuleBox(topKey(s, slot));
}

export function isTypeSlot(s: GameState, slot: Slot, type: EnergyType): boolean {
  return topDef(s, slot).types.includes(type);
}

export function cardIsType(s: GameState, card: number, category: 'pokemon' | 'trainer' | 'energy'): boolean {
  return def(keyOf(s, card)).category === category;
}
