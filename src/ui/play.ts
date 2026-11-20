// Pure helpers for the play screen: what a click on a card or Pokémon can do, Thai labels.
import { legalActions } from '../engine/actions';
import { def, isBasicEnergy } from '../engine/db';
import { keyOf, topDef } from '../engine/state';
import type { Action, CardId, GameState, SlotId } from '../engine/types';

export type CardActions = { kind: 'now'; action: Action } | { kind: 'target'; actions: Action[] };

/** Legal actions for each card in hand: played directly, or needing a target Pokémon. */
export function handActions(s: GameState): Map<CardId, CardActions> {
  const out = new Map<CardId, CardActions>();
  const legal = legalActions(s);
  const hand = s.players[s.current].hand;
  for (const card of hand) {
    const k = keyOf(s, card);
    // legalActions lists one card per name; any copy may be played.
    const mine = legal.filter((a) => 'card' in a && keyOf(s, a.card) === k).map((a) => ({ ...a, card }) as Action);
    if (mine.length === 0) continue;
    const needsTarget = mine.some((a) => a.t === 'energy' || a.t === 'tool' || a.t === 'evolve');
    out.set(card, needsTarget ? { kind: 'target', actions: mine } : { kind: 'now', action: mine[0]! });
  }
  return out;
}

export function targetOf(a: Action): SlotId | undefined {
  return a.t === 'energy' || a.t === 'tool' || a.t === 'evolve' ? a.target : undefined;
}

export function actionLabel(s: GameState, a: Action): string {
  switch (a.t) {
    case 'bench':
      return `ลง ${def(keyOf(s, a.card)).name} บน Bench`;
    case 'evolve':
      return `วิวัฒนาการเป็น ${def(keyOf(s, a.card)).name}`;
    case 'energy':
    case 'tool':
      return `ติด ${def(keyOf(s, a.card)).name}`;
    case 'trainer':
      return `ใช้ ${def(keyOf(s, a.card)).name}`;
    case 'ability':
      return `Ability ${a.name}`;
    case 'stadium':
      return 'ใช้ Academy at Night';
    case 'retreat':
      return 'ถอย';
    case 'attack':
      return `โจมตี ${a.name}`;
    case 'end':
      return 'จบเทิร์น';
    case 'choose':
      return 'เลือก';
    case 'setup':
      return 'เริ่มเกม';
  }
}

/** Like actionLabel, with the Pokémon the action goes to (drop hints, coach). */
export function describeAction(s: GameState, a: Action): string {
  switch (a.t) {
    case 'energy':
    case 'tool':
      return `ติด ${def(keyOf(s, a.card)).name} ให้ ${slotTitle(s, a.target)}`;
    case 'evolve':
      return `วิวัฒนาการ ${slotTitle(s, a.target)} เป็น ${def(keyOf(s, a.card)).name}`;
    case 'retreat': {
      const act = s.players[s.current].active;
      return `ถอย ${act ? topDef(s, act).name : ''} ให้ ${slotTitle(s, a.to)} ขึ้นมาแทน`;
    }
    default:
      return actionLabel(s, a);
  }
}

export function slotTitle(s: GameState, uid: SlotId): string {
  for (const p of [0, 1] as const) {
    const ps = s.players[p];
    const sl = ps.active?.uid === uid ? ps.active : ps.bench.find((b) => b.uid === uid);
    if (sl) return topDef(s, sl).name;
  }
  return '';
}

export interface TurnUse {
  label: string;
  /** used: done this turn; free: still yours; barred: not allowed this turn (the first player's Supporter on turn 1). */
  state: 'used' | 'free' | 'barred';
  title: string;
}

/** What the player whose turn it is has used of the once-a-turn plays (the chips beside "จบเทิร์น"). */
export function turnUses(s: GameState): TurnUse[] {
  const ps = s.players[s.current];
  return [
    ps.supporterPlayed
      ? { label: 'Supporter', state: 'used', title: 'เล่น Supporter ไปแล้วเทิร์นนี้' }
      : s.turn === 1
        ? { label: 'Supporter', state: 'barred', title: 'คนที่ได้เล่นก่อนห้ามเล่น Supporter ในเทิร์นแรก' }
        : { label: 'Supporter', state: 'free', title: 'ยังเล่น Supporter ได้ 1 ใบ' },
    ps.energyAttached
      ? { label: 'ติดพลังงาน', state: 'used', title: 'ติดพลังงานจากมือไปแล้วเทิร์นนี้' }
      : { label: 'ติดพลังงาน', state: 'free', title: 'ยังติดพลังงานจากมือได้ 1 ใบ' },
    ps.retreated
      ? { label: 'ถอย', state: 'used', title: 'ถอยไปแล้วเทิร์นนี้' }
      : { label: 'ถอย', state: 'free', title: 'ยังถอยได้ 1 ครั้ง' },
  ];
}

const TRAINER_RANK = { Supporter: 10, Item: 11, Tool: 12, Stadium: 13 } as const;
const STAGE_RANK = { Basic: 0, Stage1: 1, Stage2: 2 } as const;

/**
 * Your hand in a fixed order, as players hold it: Pokémon (Basic, Stage 1, Stage 2), Supporters, Items, Tools,
 * Stadiums, Basic then Special Energy; by name inside each, copies together, otherwise in the order drawn.
 */
export function sortedHand(s: GameState, cards: readonly CardId[]): CardId[] {
  const rank = (c: CardId) => {
    const k = keyOf(s, c);
    const d = def(k);
    if (d.category === 'pokemon') return STAGE_RANK[d.stage];
    if (d.category === 'energy') return isBasicEnergy(k) ? 20 : 21;
    return TRAINER_RANK[d.trainerType];
  };
  return cards
    .map((c, i) => ({ c, i, r: rank(c), n: def(keyOf(s, c)).name }))
    .sort((a, b) => a.r - b.r || a.n.localeCompare(b.n) || a.i - b.i)
    .map((x) => x.c);
}

export type KeyCommand = { t: 'end' } | { t: 'attack' } | { t: 'confirm' } | { t: 'close' } | { t: 'hand'; index: number };

/**
 * The play screen's keyboard (a computer): E end the turn, A your Active's attacks, 1–9 the Nth card of your hand as
 * shown, Enter confirm / play the card picked up, Esc close. Nothing with Ctrl/Alt/⌘ or while typing in a field.
 */
export function keyCommand(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; typing?: boolean }): KeyCommand | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.typing) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'e') return { t: 'end' };
  if (k === 'a') return { t: 'attack' };
  if (k === 'Enter') return { t: 'confirm' };
  if (k === 'Escape') return { t: 'close' };
  if (/^[1-9]$/.test(k)) return { t: 'hand', index: Number(k) - 1 };
  return null;
}
