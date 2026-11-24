// The command bar under the table (ActionBar.svelte): what is going on now, and the buttons for it, worked out from
// the game and the screen. One place decides which button is the main one (white); red is kept for leaving a game.
import { tx } from '../i18n';
import type { Action, ChoiceRequest, GameState } from '../engine/types';
import { turnUses, waitingText, type CardActions, type TurnUse } from './play';

export type BarAction =
  | 'end'
  | 'end-anyway'
  | 'back-to-attack'
  | 'stay'
  | 'leave'
  | 'cancel'
  | 'play'
  | 'setup-clear'
  | 'setup-confirm'
  | 'box-clear'
  | 'box-confirm'
  | 'recap';

export interface BarButton {
  id: BarAction;
  label: string;
  kind: 'primary' | 'default' | 'danger';
  disabled?: boolean;
  /** Keyboard shortcut shown in its tooltip. */
  key?: string;
  /** Shown on phones only (on a computer the same thing is on screen already). */
  narrowOnly?: boolean;
}

export interface Bar {
  /** turn: your move; held: a card picked up from the hand; warn: a question before something final; setup; box: a
      choice in a box over the table; wait: nothing for you to press. */
  kind: 'turn' | 'held' | 'warn' | 'setup' | 'box' | 'wait';
  title?: string;
  text?: string;
  /** `text` says why the card can't be played. */
  why?: boolean;
  /** `text` is a one-time tip (ui/tips.ts). */
  tip?: boolean;
  chips?: TurnUse[];
  /** Setup: which step (the end-to-end tests read it). */
  step?: 'active' | 'bench';
  buttons: BarButton[];
}

export interface BarInput {
  s: GameState;
  /** Your move now (not watching, not looking back, the game not over). */
  myTurn: boolean;
  legal: Action[];
  watch?: boolean;
  viewing?: boolean;
  confirmEnd?: boolean;
  confirmNew?: boolean;
  /** Attacks still usable (asked about before ending the turn). */
  attacksLeft?: string[];
  /** The card picked up from your hand: its name, what it can do, why not, and its play button's label. */
  held?: { name: string; actions?: CardActions; why?: string | null; playLabel?: string };
  /** Setup on the table: which step, the Bench step's hint, the Basics put down so far. */
  setup?: { step: 'active' | 'bench'; hint: string; picked: number };
  /** A choice in a box over the table (ChoicePanel); `cards`: the options are cards, marked then confirmed. */
  box?: { req: ChoiceRequest; picks: number[]; cards: boolean };
  /** Lines in the bot's last turn (on a phone a button opens them). */
  recap?: number;
  /** A one-time tip for what is on screen now (ui/tips.ts). */
  tip?: string | null;
  /** Another question being asked (the Prize cards, over the whole screen). */
  prompt?: string;
}

/** How many to pick, and how many are picked. */
export function pickNeed(req: ChoiceRequest, picked: number): string {
  const need = req.min === req.max ? tx(`เลือก ${req.max}`, `Choose ${req.max}`) : req.min === 0 ? tx(`เลือกได้ไม่เกิน ${req.max}`, `Choose up to ${req.max}`) : tx(`เลือก ${req.min}–${req.max}`, `Choose ${req.min}–${req.max}`);
  return tx(`${need} · เลือกแล้ว ${picked}`, `${need} · ${picked} chosen`);
}

export function actionBar(i: BarInput): Bar {
  if (i.confirmNew)
    return {
      kind: 'warn',
      title: tx('ออกจากเกมนี้?', 'Leave this game?'),
      text: tx('เกมนี้ยังไม่จบ ถ้าออกตอนนี้จะไม่ถูกบันทึก', 'An unfinished game is not saved'),
      buttons: [
        { id: 'stay', label: tx('เล่นต่อ', 'Keep playing'), kind: 'default' },
        { id: 'leave', label: tx('ออกจากเกม', 'Leave'), kind: 'danger' },
      ],
    };
  if (i.myTurn && i.box) {
    const { req, picks, cards } = i.box;
    const single = req.min === 1 && req.max === 1;
    if (!cards && single) return { kind: 'box', title: req.prompt, text: tx('เลือกในกล่องบนสนาม', 'Choose in the box on the table'), buttons: [] };
    const ready = picks.length >= req.min && picks.length <= req.max;
    return {
      kind: 'box',
      title: req.prompt,
      text: pickNeed(req, picks.length),
      buttons: [
        { id: 'box-clear', label: tx('ล้าง', 'Clear'), kind: 'default', disabled: picks.length === 0 },
        { id: 'box-confirm', label: picks.length === 0 && req.min === 0 && cards ? tx('ไม่เอาการ์ด', 'Take none') : tx('ยืนยัน', 'Confirm'), kind: 'primary', disabled: !ready, key: 'Enter' },
      ],
    };
  }
  if (i.myTurn && i.setup) {
    if (i.setup.step === 'active') return { kind: 'setup', step: 'active', title: tx('เลือกตัวหลัก', 'Choose your Active Pokémon'), text: tx('ลาก Basic จากมือไปวางที่ช่องตัวหลัก หรือแตะการ์ด', 'Drag a Basic from your hand to the Active Spot, or tap the card'), buttons: [] };
    const n = i.setup.picked;
    return {
      kind: 'setup',
      step: 'bench',
      title: tx('ลง Bench', 'Bench'),
      text: i.setup.hint,
      buttons: [
        ...(n ? [{ id: 'setup-clear', label: tx('ล้าง', 'Clear'), kind: 'default' } as const] : []),
        { id: 'setup-confirm', label: n ? tx(`ยืนยัน (ลง Bench ${n} ตัว)`, `Confirm (${n} on the Bench)`) : tx('ยืนยัน (ไม่ลง Bench)', 'Confirm (empty Bench)'), kind: 'primary' },
      ],
    };
  }
  if (i.myTurn && i.confirmEnd)
    return {
      kind: 'warn',
      title: tx('ยังโจมตีได้', 'You can still attack'),
      text: tx(`ยังใช้ ${(i.attacksLeft ?? []).join(', ')} ได้ · จะจบเทิร์นโดยไม่โจมตีเลยไหม?`, `(${(i.attacksLeft ?? []).join(', ')}) · End the turn without attacking?`),
      buttons: [
        { id: 'back-to-attack', label: tx('กลับไปโจมตี', 'Back to attack'), kind: 'primary' },
        { id: 'end-anyway', label: tx('จบเทิร์นเลย', 'End turn anyway'), kind: 'default', key: 'E' },
      ],
    };
  if (i.myTurn && i.held) {
    const { name, actions, why, playLabel } = i.held;
    const play = actions?.kind === 'now';
    return {
      kind: 'held',
      title: name,
      text: play
        ? tx('แตะการ์ดอีกครั้งหรือกดปุ่มเพื่อใช้ · จะลากลงสนามก็ได้', 'Tap the card again or press the button to play it · or drag it onto the table')
        : actions?.kind === 'target'
          ? tx('แตะ Pokémon ที่สว่าง หรือลากการ์ดไปวาง', 'Tap a lit Pokémon, or drag the card onto it')
          : tx(`ตอนนี้ใช้ไม่ได้${why ? `: ${why}` : ''}`, `Can't be played now${why ? `: ${why}` : ''}`),
      why: !actions,
      buttons: [
        { id: 'cancel', label: tx('ยกเลิก', 'Cancel'), kind: 'default' },
        ...(play ? [{ id: 'play', label: playLabel ?? tx('ใช้', 'Play'), kind: 'primary', key: 'Enter' } as const] : []),
      ],
    };
  }
  if (i.myTurn) {
    // Nothing left to do but end the turn: the button becomes the main one.
    const onlyEnd = i.legal.length > 0 && i.legal.every((a) => a.t === 'end');
    return {
      kind: 'turn',
      chips: turnUses(i.s),
      text: i.tip ?? undefined,
      tip: !!i.tip,
      buttons: [
        ...(i.recap ? [{ id: 'recap', label: tx(`บอทเล่นอะไรไป (${i.recap})`, `Bot's turn (${i.recap})`), kind: 'default', narrowOnly: true } as const] : []),
        { id: 'end', label: tx('จบเทิร์น', 'End turn'), kind: onlyEnd ? 'primary' : 'default', key: 'E' },
      ],
    };
  }
  return { kind: 'wait', text: waitingText(i.s, { watch: i.watch, viewing: i.viewing, prompt: i.prompt ?? i.box?.req.prompt }), buttons: [] };
}
