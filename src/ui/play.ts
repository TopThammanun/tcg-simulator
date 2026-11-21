// Pure helpers for the play screen: what a click on a card or Pokémon can do, Thai labels.
import { tx } from '../i18n';
import { actor, legalActions } from '../engine/actions';
import { def, isBasicEnergy } from '../engine/db';
import { keyOf, topDef } from '../engine/state';
import type { Action, CardId, ChoiceRequest, GameState, SlotId } from '../engine/types';

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
      return tx(`ลง ${def(keyOf(s, a.card)).name} บน Bench`, `Bench ${def(keyOf(s, a.card)).name}`);
    case 'evolve':
      return tx(`วิวัฒนาการเป็น ${def(keyOf(s, a.card)).name}`, `Evolve into ${def(keyOf(s, a.card)).name}`);
    case 'energy':
    case 'tool':
      return tx(`ติด ${def(keyOf(s, a.card)).name}`, `Attach ${def(keyOf(s, a.card)).name}`);
    case 'trainer':
      return tx(`ใช้ ${def(keyOf(s, a.card)).name}`, `Play ${def(keyOf(s, a.card)).name}`);
    case 'ability':
      return `Ability ${a.name}`;
    case 'stadium':
      return tx('ใช้ Academy at Night', 'Use Academy at Night');
    case 'retreat':
      return tx('ถอย', 'Retreat');
    case 'attack':
      return tx(`โจมตี ${a.name}`, `Attack: ${a.name}`);
    case 'end':
      return tx('จบเทิร์น', 'End turn');
    case 'choose':
      return tx('เลือก', 'Choose');
    case 'setup':
      return tx('เริ่มเกม', 'Start the game');
  }
}

/** Like actionLabel, with the Pokémon the action goes to (drop hints, coach). */
export function describeAction(s: GameState, a: Action): string {
  switch (a.t) {
    case 'energy':
    case 'tool':
      return tx(`ติด ${def(keyOf(s, a.card)).name} ให้ ${slotTitle(s, a.target)}`, `Attach ${def(keyOf(s, a.card)).name} to ${slotTitle(s, a.target)}`);
    case 'evolve':
      return tx(`วิวัฒนาการ ${slotTitle(s, a.target)} เป็น ${def(keyOf(s, a.card)).name}`, `Evolve ${slotTitle(s, a.target)} into ${def(keyOf(s, a.card)).name}`);
    case 'retreat': {
      const act = s.players[s.current].active;
      return tx(`ถอย ${act ? topDef(s, act).name : ''} ให้ ${slotTitle(s, a.to)} ขึ้นมาแทน`, `Retreat ${act ? topDef(s, act).name : ''} for ${slotTitle(s, a.to)}`);
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

/** What the player whose turn it is has used of the once-a-turn plays (the chips beside tx("จบเทิร์น", 'End turn')). */
export function turnUses(s: GameState): TurnUse[] {
  const ps = s.players[s.current];
  return [
    ps.supporterPlayed
      ? { label: 'Supporter', state: 'used', title: tx('เล่น Supporter ไปแล้วเทิร์นนี้', 'Supporter played this turn') }
      : s.turn === 1
        ? { label: 'Supporter', state: 'barred', title: tx('คนที่ได้เล่นก่อนห้ามเล่น Supporter ในเทิร์นแรก', "The player going first can't play a Supporter on their first turn") }
        : { label: 'Supporter', state: 'free', title: tx('ยังเล่น Supporter ได้ 1 ใบ', 'You can still play 1 Supporter') },
    ps.energyAttached
      ? { label: tx('ติดพลังงาน', 'Energy'), state: 'used', title: tx('ติดพลังงานจากมือไปแล้วเทิร์นนี้', 'Energy attached from your hand this turn') }
      : { label: tx('ติดพลังงาน', 'Energy'), state: 'free', title: tx('ยังติดพลังงานจากมือได้ 1 ใบ', 'You can still attach 1 Energy from your hand') },
    ps.retreated
      ? { label: tx('ถอย', 'Retreat'), state: 'used', title: tx('ถอยไปแล้วเทิร์นนี้', 'Retreated this turn') }
      : { label: tx('ถอย', 'Retreat'), state: 'free', title: tx('ยังถอยได้ 1 ครั้ง', 'You can still retreat once') },
  ];
}

/**
 * The command bar when there is nothing for you to press: whose move it is and the last thing that happened (the
 * bot's turn), the question a box over the table asks, the result, or that an earlier position is shown.
 */
export function waitingText(s: GameState, o: { watch?: boolean; viewing?: boolean; prompt?: string }): string {
  if (o.viewing) return tx('กำลังดูสนามย้อนหลัง · กด "กลับไปเกมปัจจุบัน" ที่แถบบน', 'Viewing an earlier position · press "Back to the game" at the top');
  if (s.winner !== null) return `${s.winner === 0 ? tx('คุณชนะ', 'You win') : s.winner === 1 ? tx('บอทชนะ', 'Bot wins') : tx('เสมอ', 'Draw')}${s.winReason ? ` · ${s.winReason}` : ''}`;
  if (o.prompt) return o.prompt;
  const last = s.log[s.log.length - 1]?.text;
  const who = o.watch ? tx('ดูบอทเล่น', 'Watching the bot') : actor(s) === 1 ? tx('ตาบอท', "Bot's turn") : '';
  return [who, last].filter(Boolean).join(' · ');
}

/**
 * Setup, the Bench step: how many more Basics can go down, or why none can (the Bench is full, or the hand has no
 * Basic left). `room`: the Bench's free spots (the request's `max` is also cut to the Basics in hand).
 */
export function benchHint(req: ChoiceRequest, picked: number, room: number): string {
  const more = Math.min(room, req.options.length) - picked;
  const now =
    picked >= room ? tx('ลง Bench ครบแล้ว', 'Bench full') : more <= 0 ? tx('ไม่มี Basic ในมือแล้ว', 'No Basics left in your hand') : tx(`ลาก Basic ลง Bench ได้อีก ${more} ตัว (หรือแตะการ์ด)`, `Drag up to ${more} more Basics to the Bench (or tap the cards)`);
  return [req.hint === 'mulligan' ? tx('Basic ที่จั่วเพิ่มจาก mulligan ของคู่แข่ง', "Basics drawn for the opponent's mulligan") : '', now, picked ? tx('แตะตัวบน Bench เพื่อเอาคืน', 'Tap a Benched one to take it back') : '']
    .filter(Boolean)
    .join(' · ');
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
