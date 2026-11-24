// How to play, taught when it comes up rather than read before the first game (NN/g: tutorials read up front don't
// help; help in context does). Each tip is shown in the command bar the first time its moment comes, once; the
// ones seen are kept in this browser. The full "วิธีเล่น" stays in the game menu.
import { tx } from '../i18n';

export type TipId = 'hand' | 'attack' | 'read-desktop' | 'read-touch';

export const TIPS: Record<TipId, [th: string, en: string]> = {
  hand: ['แตะการ์ดในมือเพื่ออ่าน แตะอีกครั้งหรือกดปุ่มเพื่อใช้ หรือจะลากลงสนามเลยก็ได้', 'Tap a card in your hand to read it, tap it again or press the button to play it, or drag it onto the table'],
  attack: ['แตะ Pokémon ตัวหลักของคุณเพื่อเลือกท่าโจมตี (คีย์ A)', 'Tap your Active Pokémon to pick an attack (key A)'],
  'read-desktop': ['ชี้เมาส์ที่การ์ดใบไหนก็ได้ ข้อความเต็มจะขึ้นในช่องทางขวา', 'Point at any card and its full text shows in the panel on the right'],
  'read-touch': ['กดค้างที่การ์ดใบไหนก็ได้ (บนสนามหรือในมือ) เพื่อดูใบใหญ่', 'Press and hold any card (on the table or in your hand) to see it large'],
};

export const tipText = (id: TipId): string => tx(...TIPS[id]);

/** What is on screen now, for picking the tip. */
export interface TipMoment {
  /** Your move, nothing asked and no card picked up. */
  free: boolean;
  /** An attack can be used. */
  canAttack: boolean;
  /** A screen with a mouse (the card text panel is there). */
  desktop: boolean;
}

/**
 * The tip for this moment not seen yet, the most useful first; null when there is none. A tip counts as seen once a
 * move is made while it shows (Game.svelte step()).
 */
export function nextTip(m: TipMoment, seen: ReadonlySet<TipId>): TipId | null {
  if (!m.free) return null;
  const order: [TipId, boolean][] = [
    ['hand', true],
    ['attack', m.canAttack],
    [m.desktop ? 'read-desktop' : 'read-touch', true],
  ];
  for (const [id, now] of order) if (now && !seen.has(id)) return id;
  return null;
}

const KEY = 'tcg-sim:tips-seen';

export function loadSeenTips(): Set<TipId> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? (v.filter((x) => x in TIPS) as TipId[]) : []);
  } catch {
    return new Set(); // storage blocked: tips come back next time, which is harmless
  }
}

export function saveSeenTips(seen: ReadonlySet<TipId>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore */
  }
}
