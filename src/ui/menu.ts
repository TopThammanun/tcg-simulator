// What the pop-up shows when you tap one of your Pokémon: its attacks (the Active only; why one can't
// be used), its Abilities (the ones you can use now carry the action), and retreating.
import { def } from '../engine/db';
import { attackCost, canPay, energyOf, retreatCost } from '../engine/rules';
import { slotsOf, topKey } from '../engine/state';
import type { Action, GameState, PlayerId, Slot, SlotId } from '../engine/types';
import type { EnergyType } from '../data/cards';

export interface MenuAttack {
  name: string;
  cost: EnergyType[];
  damage: string;
  effect: string;
  /** Where the attack comes from when it isn't the Pokémon's own (Mew ex's Memory Helix). */
  from?: string;
  action: Action | null;
  reason: string | null;
}
export interface MenuAbility {
  name: string;
  effect: string;
  /** Works by itself (nothing to press), as opposed to one you use during your turn. */
  passive: boolean;
  action: Action | null;
}
export interface MenuRetreat {
  cost: number;
  options: { to: SlotId; key: string; action: Action }[];
  reason: string | null;
}
export interface SlotMenu {
  uid: SlotId;
  player: PlayerId;
  key: string;
  active: boolean;
  attacks: MenuAttack[];
  abilities: MenuAbility[];
  retreat: MenuRetreat | null;
}

function attackReason(s: GameState, user: Slot, name: string, cost: EnergyType[]): string {
  if (s.turn === 1) return 'เทิร์นแรกของเกมโจมตีไม่ได้';
  if (user.marks.some((m) => m.kind === 'cant-attack' && m.turn === s.turn)) return 'โจมตีไม่ได้ในเทิร์นนี้ (ผลจากท่าของอีกฝั่ง)';
  if (user.marks.some((m) => m.kind === 'cant-use' && m.attack === name && m.turn === s.turn)) return 'ใช้ท่านี้ซ้ำในเทิร์นนี้ไม่ได้';
  if (!canPay(energyOf(s, user), cost)) return 'พลังงานไม่พอ';
  return 'ใช้ไม่ได้ตอนนี้';
}

function retreatReason(s: GameState, p: PlayerId, user: Slot, cost: number): string {
  const ps = s.players[p];
  if (ps.retreated) return 'ถอยไปแล้วในเทิร์นนี้';
  if (ps.bench.length === 0) return 'ไม่มี Pokémon บน Bench';
  if (user.marks.some((m) => m.kind === 'cant-retreat' && m.turn === s.turn)) return 'ถอยไม่ได้ในเทิร์นนี้ (ผลจากท่าของอีกฝั่ง)';
  if (user.energy.length < cost) return `พลังงานไม่พอ (ต้องทิ้ง ${cost} ใบ)`;
  return 'ถอยไม่ได้ตอนนี้';
}

/** The menu for one of the current player's Pokémon; null for the other side's. */
export function slotMenu(s: GameState, legal: Action[], uid: SlotId): SlotMenu | null {
  const p = s.current;
  const ps = s.players[p];
  const slot = slotsOf(ps).find((x) => x.uid === uid);
  if (!slot || !ps.active) return null;
  const key = topKey(s, slot);
  const card = def(key);
  if (card.category !== 'pokemon') return null;
  const isActive = ps.active.uid === uid;

  const attacks: MenuAttack[] = [];
  if (isActive) {
    const own = (from?: SlotId) => (a: Action) => a.t === 'attack' && a.from === from;
    const add = (src: Slot, from?: SlotId) => {
      const d = def(topKey(s, src));
      if (d.category !== 'pokemon') return;
      for (const atk of d.attacks) {
        const action = legal.find((a) => own(from)(a) && a.t === 'attack' && a.name === atk.name) ?? null;
        if (from !== undefined && !action) continue; // borrowed attacks only show when usable
        const cost = attackCost(s, slot, atk);
        attacks.push({
          name: atk.name,
          cost,
          damage: atk.damage,
          effect: atk.effect,
          ...(from !== undefined && { from: d.name }),
          action,
          reason: action ? null : attackReason(s, slot, atk.name, cost),
        });
      }
    };
    add(slot);
    for (const b of ps.bench) add(b, b.uid);
  }

  const abilities = card.abilities.map((ab) => ({
    name: ab.name,
    effect: ab.effect,
    passive: !/once during your turn|you may use this ability/i.test(ab.effect),
    action: legal.find((a) => a.t === 'ability' && a.slot === uid && a.name === ab.name) ?? null,
  }));

  const cost = retreatCost(s, p, ps.active);
  const retreats = legal.filter((a): a is Extract<Action, { t: 'retreat' }> => a.t === 'retreat' && (isActive || a.to === uid));
  const options = retreats.map((a) => ({ to: a.to, key: topKey(s, ps.bench.find((b) => b.uid === a.to)!), action: a as Action }));
  const retreat: MenuRetreat | null =
    isActive || options.length ? { cost, options, reason: options.length ? null : retreatReason(s, p, ps.active, cost) } : null;

  return { uid, player: p, key, active: isActive, attacks, abilities, retreat };
}
