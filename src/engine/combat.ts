// Attacks: damage calculation (PLAN.md order), damage counters, copied attacks and Festival Lead.
import type { Attack, TypeValue } from '../data/cards';
import { tx } from '../i18n';
import { uniqueByKey, type Ctx } from './ctx';
import { hasRuleBox } from './db';
import { ATTACKS } from './effects/attacks';
import {
  abilityOn,
  addCondition,
  checkKOs,
  endTurn,
  hpLeft,
  isActive,
  ownerOf,
  slotsWithAbility,
  stadiumIs,
  toolKey,
  usableAttacks,
} from './rules';
import { keyOf, mustSlot, opp, slotsOf, topDef, topKey } from './state';
import type { CardId, Condition, GameState, Mark, PlayerId, Slot, SlotId } from './types';

export interface HitOpts {
  /** Don't apply Weakness and Resistance. */
  noWR?: boolean;
  /** Not affected by effects on the target (Twin Shotels, Shred). */
  pierce?: boolean;
}

export type AttackImpl = (a: AttackCtx) => void;

export function baseDamage(attack: Attack): number {
  const n = parseInt(attack.damage, 10);
  return Number.isFinite(n) ? n : 0;
}

export class AttackCtx {
  readonly s: GameState;
  readonly opp: PlayerId;
  readonly hits = new Set<SlotId>();
  readonly boomerang: CardId[] = [];
  readonly defender: Slot | null;
  attack: Attack;
  base: number;

  constructor(
    readonly ctx: Ctx,
    readonly me: PlayerId,
    readonly user: Slot,
    attack: Attack,
  ) {
    this.s = ctx.s;
    this.opp = opp(me);
    this.defender = this.s.players[this.opp].active;
    this.attack = attack;
    this.base = baseDamage(attack);
  }

  /** Run an attack's effect with this Pokémon as the user (also used for copied attacks). */
  use(attack: Attack): void {
    const prev = [this.attack, this.base] as const;
    this.attack = attack;
    this.base = baseDamage(attack);
    (ATTACKS[attack.name] ?? defaultAttack)(this);
    [this.attack, this.base] = prev;
  }

  oppSlots(): Slot[] {
    const ps = this.s.players[this.opp];
    return ps.active ? [ps.active, ...ps.bench] : ps.bench.slice();
  }

  flip(): boolean {
    return this.ctx.flip();
  }

  /** Attack damage to one Pokémon. Returns the damage actually done. */
  hit(target: Slot | null, amount: number, opts: HitOpts = {}): number {
    if (!target || amount <= 0) return 0;
    const s = this.s;
    let dmg = amount;
    const theirs = ownerOf(s, target) !== this.me;
    const theirActive = theirs && isActive(s, target);
    if (theirActive) {
      dmg += attackerBonus(this, target);
      if (!opts.noWR) dmg = applyWR(s, this.user, target, dmg, this.me);
    }
    if (damagePrevented(this, target, opts)) dmg = 0;
    if (dmg <= 0) return 0;
    target.damage += dmg;
    this.hits.add(target.uid);
    this.ctx.log(tx(`${topDef(s, target).name} โดน ${dmg}`, `${topDef(s, target).name} takes ${dmg}`));
    return dmg;
  }

  /** Effects of this attack can't touch `target` (Mist Energy, Dig, Rabsca on the Bench). */
  blocked(target: Slot): boolean {
    const s = this.s;
    const owner = ownerOf(s, target);
    if (owner === this.me) return false;
    if (target.marks.some((m) => m.kind === 'protected' && m.turn === s.turn)) return true;
    if (target.energy.some((e) => keyOf(s, e) === 'mist-energy')) return true;
    if (!isActive(s, target) && slotsWithAbility(s, owner, 'Spherical Shield').length > 0) return true;
    return false;
  }

  /** Place damage counters (not damage: no Weakness, Resistance or damage prevention). */
  counters(target: Slot, n: number): void {
    if (n <= 0) return;
    const s = this.s;
    if (ownerOf(s, target) !== this.me) {
      if (this.blocked(target)) return;
      if (stadiumIs(s, 'battle-cage') && !isActive(s, target)) return;
    }
    target.damage += 10 * n;
    this.ctx.log(tx(`วางตัวนับดาเมจ ${n} ตัวบน ${topDef(s, target).name}`, `${n} damage ${n === 1 ? 'counter' : 'counters'} on ${topDef(s, target).name}`));
  }

  condition(target: Slot | null, c: Condition): void {
    if (target && !this.blocked(target)) addCondition(this.ctx, target, c);
  }

  mark(target: Slot | null, m: Mark): void {
    if (target && !this.blocked(target)) target.marks.push(m);
  }

  /** Discard Energy attached to a Pokémon as an effect of this attack. */
  discardEnergy(slot: Slot, cards: CardId[]): void {
    const owner = ownerOf(this.s, slot);
    for (const c of cards) {
      slot.energy = slot.energy.filter((e) => e !== c);
      this.s.players[owner].discard.push(c);
      if (slot.uid === this.user.uid && keyOf(this.s, c) === 'boomerang-energy') this.boomerang.push(c);
    }
    if (cards.length) this.ctx.log(tx(`ทิ้งพลังงาน ${cards.length} ใบจาก ${topDef(this.s, slot).name}`, `${cards.length} Energy discarded from ${topDef(this.s, slot).name}`));
  }

  /** The attacking player picks one Pokémon from `from`. */
  pickTarget(from: Slot[], prompt: string, purpose: 'target' | 'counters' = 'target'): Slot | undefined {
    if (from.length === 0) return undefined;
    return this.ctx.pickSlots(this.me, from, { prompt, purpose, source: topKey(this.s, this.user) })[0];
  }
}

export const defaultAttack: AttackImpl = (a) => {
  a.hit(a.defender, a.base);
};

function attackerBonus(a: AttackCtx, target: Slot): number {
  if (a.base <= 0) return 0;
  const s = a.s;
  const uk = topKey(s, a.user);
  const ud = topDef(s, a.user);
  const noRuleBox = !hasRuleBox(uk);
  const targetEx = hasRuleBox(topKey(s, target));
  const buffs = s.players[a.me].buffs;
  let b = 0;
  if (toolKey(s, a.user) === 'brave-bangle' && noRuleBox && targetEx) b += 30;
  if (buffs.includes('gladion') && noRuleBox) b += 80;
  if (buffs.includes('black-belt') && targetEx) b += 40;
  if (buffs.includes('kieran') && targetEx) b += 30;
  if (ud.subtypes.includes('Future') && uk !== 'iron-crown-ex') {
    b += 20 * slotsWithAbility(s, a.me, 'Cobalt Command').length;
  }
  if (toolKey(s, a.user) === 'binding-mochi' && a.user.conditions.includes('poisoned')) b += 40;
  return b;
}

export function weaknessOf(s: GameState, target: Slot): TypeValue[] {
  const d = topDef(s, target);
  const otherSide = opp(ownerOf(s, target));
  if (d.types.includes('Dragon') && slotsWithAbility(s, otherSide, 'Fairy Zone').length > 0) {
    return [{ type: 'Psychic', value: '×2' }];
  }
  return d.weaknesses;
}

export function applyWR(s: GameState, user: Slot, target: Slot, dmg: number, _me: PlayerId): number {
  const types = topDef(s, user).types;
  let out = dmg;
  if (weaknessOf(s, target).some((w) => types.includes(w.type))) out *= 2;
  for (const r of topDef(s, target).resistances) {
    if (types.includes(r.type)) out += parseInt(r.value.replace('−', '-'), 10) || -30;
  }
  return out;
}

function damagePrevented(a: AttackCtx, target: Slot, opts: HitOpts): boolean {
  const s = a.s;
  const owner = ownerOf(s, target);
  const benched = !isActive(s, target);
  // Tera: prevent all damage done to this Pokémon by attacks while on the Bench (yours and theirs).
  if (benched && topDef(s, target).tera && !opts.pierce) return true;
  if (owner === a.me) return false;
  if (!opts.pierce && target.marks.some((m) => m.kind === 'protected' && m.turn === s.turn)) return true;
  if (benched) {
    const shields = !opts.pierce || !s.rules.twinShotelsPiercesBenchShields;
    if (shields && slotsWithAbility(s, owner, 'Spherical Shield').length > 0) return true;
    if (shields && !hasRuleBox(topKey(s, target)) && slotsWithAbility(s, owner, 'Flower Curtain').length > 0) {
      return true;
    }
  }
  return false;
}

// ---------- attack flow ----------

export function performAttack(ctx: Ctx, p: PlayerId, name: string, from?: SlotId): void {
  const s = ctx.s;
  const src = from !== undefined ? mustSlot(s, from).slot : s.players[p].active!;
  const attack = topDef(s, src).attacks.find((x) => x.name === name);
  if (!attack) throw new Error(`no attack ${name}`);
  const userUid = s.players[p].active!.uid;
  // HP the opponent's Pokémon lose to this attack (a Knocked Out one: all it had), for PlayerState.attacked.
  const before = new Map(slotsOf(s.players[opp(p)]).map((sl) => [sl.uid, hpLeft(s, sl)]));
  resolveAttack(ctx, p, attack);
  festivalLead(ctx, p, userUid);
  const now = new Map(slotsOf(s.players[opp(p)]).map((sl) => [sl.uid, hpLeft(s, sl)]));
  let damage = 0;
  for (const [uid, hp] of before) damage += Math.max(0, hp - Math.max(0, now.get(uid) ?? 0));
  s.players[p].attacked = { name, damage };
  endTurn(ctx);
}

function resolveAttack(ctx: Ctx, p: PlayerId, attack: Attack): void {
  const s = ctx.s;
  const user = s.players[p].active!;
  ctx.log(tx(`${ctx.who(p)}: ${topDef(s, user).name} ใช้ ${attack.name}`, `${ctx.who(p)}: ${topDef(s, user).name} uses ${attack.name}`), p);
  if (user.conditions.includes('confused') && !ctx.flip()) {
    user.damage += 30;
    ctx.log(tx(`${topDef(s, user).name} สับสน ทำร้ายตัวเอง 30`, `${topDef(s, user).name} is Confused and hurts itself for 30`), p);
    checkKOs(ctx);
    return;
  }
  const a = new AttackCtx(ctx, p, user, attack);
  a.use(attack);
  afterAttack(a);
}

function afterAttack(a: AttackCtx): void {
  const { s, ctx, defender, user } = a;
  const userInPlay = s.players[a.me].active?.uid === user.uid || s.players[a.me].bench.some((b) => b.uid === user.uid);

  if (defender && a.hits.has(defender.uid) && s.players[a.opp].active?.uid === defender.uid) {
    const tk = toolKey(s, defender);
    if (tk === 'lucky-helmet') ctx.draw(a.opp, 2);
    // Punk Helmet: 4 damage counters on the attacker, even when the Darkness Pokémon is Knocked Out.
    if (tk === 'punk-helmet' && userInPlay && topDef(s, defender).types.includes('Darkness')) {
      user.damage += 40;
      ctx.log(tx(`Punk Helmet: วางตัวนับดาเมจ 4 ตัวบน ${topDef(s, user).name}`, `Punk Helmet: 4 damage counters on ${topDef(s, user).name}`));
    }
    const bench = s.players[a.me].bench;
    if (tk === 'handheld-fan' && userInPlay && user.energy.length > 0 && bench.length > 0) {
      const [e] = ctx.pickCards(a.opp, uniqueByKey(s, user.energy), {
        purpose: 'energy',
        prompt: tx('Handheld Fan: เลือกพลังงานของตัวที่โจมตี', "Handheld Fan: choose an Energy on the Attacking Pokémon"),
        source: 'handheld-fan',
      });
      const [to] = ctx.pickSlots(a.opp, bench, {
        purpose: 'target',
        prompt: tx('Handheld Fan: ย้ายพลังงานไปไว้ที่ Pokémon บน Bench ของอีกฝั่ง', "Handheld Fan: move it to one of the attacker's Benched Pokémon"),
        source: 'handheld-fan',
      });
      user.energy = user.energy.filter((x) => x !== e);
      to!.energy.push(e!);
      ctx.log(tx(`Handheld Fan ย้ายพลังงานไปที่ ${topDef(s, to!).name}`, `Handheld Fan moves an Energy to ${topDef(s, to!).name}`));
    }
  }

  for (const e of a.boomerang) {
    const discard = s.players[a.me].discard;
    if (userInPlay && discard.includes(e)) {
      discard.splice(discard.indexOf(e), 1);
      user.energy.push(e);
      ctx.log(tx('Boomerang Energy กลับมาติด', 'Boomerang Energy is attached again'));
    }
  }
  checkKOs(ctx, a.hits);
}

function festivalLead(ctx: Ctx, p: PlayerId, userUid: SlotId): void {
  const s = ctx.s;
  const user = s.players[p].active;
  if (s.phase === 'over' || !user || user.uid !== userUid) return;
  if (!stadiumIs(s, 'festival-grounds') || !abilityOn(s, user, 'Festival Lead')) return;
  const options = usableAttacks(s, p).filter((x) => x.from === undefined);
  if (options.length === 0) return;
  const labels = [...options.map((o) => o.attack.name), tx('ไม่โจมตีอีก', 'No more attacks')];
  const i = ctx.pickOption(p, tx('Festival Lead: โจมตีอีกครั้ง?', 'Festival Lead: attack again?'), labels, topKey(s, user), 'attack');
  if (i < options.length) resolveAttack(ctx, p, options[i]!.attack);
}
