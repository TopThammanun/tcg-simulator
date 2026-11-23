// Plays the events from events.ts on the play screen with the Web Animations API. The state on screen
// has already changed; this only moves pictures: flying copies of cards on an overlay (pointer-events
// none), and short animations on the real elements that start from where they were before.
// Nothing here blocks input: finish() jumps every running animation to its end.
import { tx } from '../../i18n';
import { def, imageFor } from '../../engine/db';
import { topKey } from '../../engine/state';
import type { CardId, GameState, PlayerId, SlotId } from '../../engine/types';
import { CARD_BACK } from '../card-back';
import { isLoaded } from '../images';
import { COIN } from '../symbols';
import { PHASES, type AnimEvent, type Phase, type Place } from './events';

export type AnimLevel = 'full' | 'fast' | 'off';

interface SlotSnap {
  rect: DOMRect;
  left: number;
  max: number;
  dmg: number;
}
/** Where things were on screen (viewport coordinates), taken before the DOM updates. */
export interface Snapshot {
  cards: Map<CardId, DOMRect>;
  slots: Map<SlotId, SlotSnap>;
  zones: Map<string, DOMRect>;
}

const visible = (r: DOMRect) => r.width > 0 && r.height > 0;

export function snapshot(root: ParentNode): Snapshot {
  const cards = new Map<CardId, DOMRect>();
  const slots = new Map<SlotId, SlotSnap>();
  const zones = new Map<string, DOMRect>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-card]')) {
    const r = el.getBoundingClientRect();
    if (visible(r)) cards.set(Number(el.dataset.card), r);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-slot]')) {
    const r = (el.querySelector('.card') ?? el).getBoundingClientRect();
    const v = (name: string) => Number(el.style.getPropertyValue(name)) || 0;
    if (visible(r)) slots.set(Number(el.dataset.slot), { rect: r, left: v('--left'), max: v('--max'), dmg: v('--dmg') });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-zone]')) {
    const r = el.getBoundingClientRect();
    if (visible(r)) zones.set(el.dataset.zone!, r);
  }
  return { cards, slots, zones };
}

const CARD = 63 / 88;
const EASE = 'cubic-bezier(.25,.8,.3,1)';
const STAGGER = 80;
const typeColor = (type: string) => `var(--t-${type.toLowerCase()}, #f2c94c)`;

/** A card-sized box centred in (or, for your hand, at the right end of) a zone. */
function cardIn(r: DOMRect, at: 'center' | 'end' = 'center', scale = 1): DOMRect {
  const h = Math.min(r.height, r.width / CARD) * scale;
  const w = h * CARD;
  const x = at === 'end' ? r.right - w - 8 : r.left + (r.width - w) / 2;
  return new DOMRect(x, r.top + (r.height - h) / 2, w, h);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

type Ev<T extends AnimEvent['t']> = Extract<AnimEvent, { t: T }>;

interface Ctx {
  prev: GameState;
  next: GameState;
  before: Snapshot;
  after: Snapshot;
  /** The table, for things shown in its middle. */
  board: DOMRect;
  attack?: Ev<'attack'>;
  /** Copies of Knocked Out Pokémon: their real cards leave the DOM at once. */
  standIns: Map<SlotId, HTMLElement>;
}

export class Fx {
  level: AnimLevel = 'full';
  /** Called as each event's animation is scheduled, with how many ms from now it starts (the sounds, ui/sound.ts). */
  cue: ((e: AnimEvent, inMs: number) => void) | null = null;
  private anims: Animation[] = [];
  private nodes: HTMLElement[] = [];

  constructor(
    private layer: HTMLElement,
    private root: HTMLElement,
  ) {
    // The opening coin toss is the first thing played: have its faces loaded by then.
    for (const src of Object.values(COIN)) new Image().src = src;
  }

  private get k() {
    return this.level === 'fast' ? 0.5 : 1;
  }

  /** Jump every running animation to its end and clear the overlay. */
  finish(): void {
    for (const a of this.anims) {
      try {
        a.finish();
      } catch {
        a.cancel();
      }
    }
    this.anims = [];
    for (const n of this.nodes) n.remove();
    this.nodes = [];
  }

  /** Play one action's events; returns the time (ms) until they are done. */
  play(events: AnimEvent[], ctx: { prev: GameState; next: GameState; before: Snapshot }): number {
    if (this.level === 'off' || events.length === 0) return 0;
    const after = snapshot(this.root);
    const board = after.zones.get('board') ?? ctx.before.zones.get('board');
    if (!board) return 0;
    const c: Ctx = { ...ctx, after, board, attack: events.find((e): e is Ev<'attack'> => e.t === 'attack'), standIns: new Map() };
    for (const e of events) {
      const r = e.t === 'ko' ? ctx.before.slots.get(e.uid)?.rect : undefined;
      if (e.t === 'ko' && r) c.standIns.set(e.uid, this.card(e.key, r, true).node);
    }
    let t = 0;
    let moveStart = 0;
    for (const phase of PHASES) {
      if (phase === 'move') moveStart = t;
      const group = events.filter((e) => e.phase === phase);
      if (group.length) t += this.phase(phase, group, t, c);
    }
    this.reflow(events, c, moveStart);
    this.anims = this.anims.filter((a) => a.playState !== 'finished');
    return t;
  }

  // ---------- building blocks ----------

  private anim(target: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
    // Copies on the overlay hold their last frame until removed; real elements only hold the first
    // frame while waiting, so nothing stays pinned over the live state (HP, hover lift) afterwards.
    const fill = this.layer.contains(target) ? 'both' : 'backwards';
    // Easing goes on each step, not the whole run, so the holds in multi-step animations keep their length.
    const { easing = EASE, ...rest } = opts;
    const steps = frames.map((f) => ({ easing, ...f }));
    const a = target.animate(steps, { fill, ...rest, easing: 'linear' });
    this.anims.push(a);
    return a;
  }

  private node(className: string, rect?: DOMRect, text?: string): HTMLElement {
    const n = el('div', className, text);
    if (rect) Object.assign(n.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    this.layer.append(n);
    this.nodes.push(n);
    return n;
  }

  /** Remove a node when its animation ends. */
  private drop(n: HTMLElement, a: Animation) {
    a.finished.then(() => n.remove()).catch(() => n.remove());
  }

  private at(n: HTMLElement, x: number, y: number) {
    Object.assign(n.style, { left: `${x}px`, top: `${y}px` });
  }

  /**
   * A card picture (front and back) that can flip; `sharp`: the large image (shown big, to be read), over the small one
   * until it has loaded (images.ts fetches Trainers' large pictures ahead, so it usually has).
   */
  private card(key: string | null, rect: DOMRect, faceUp: boolean, sharp = false): { node: HTMLElement; inner: HTMLElement } {
    const node = this.node('fx-card', rect);
    const inner = el('div', 'fx-inner');
    const front = el('div', 'fx-front');
    const { high, low } = key ? imageFor(key) : {};
    const srcs = sharp && high ? (isLoaded(high) || !low ? [high] : [low, high]) : low ? [low] : [];
    for (const src of srcs) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      img.decoding = 'sync';
      front.append(img);
    }
    if (!srcs.length && key) front.textContent = def(key).name;
    const back = el('div', 'fx-back');
    const backImg = el('img');
    backImg.src = CARD_BACK;
    backImg.alt = '';
    backImg.onerror = () => backImg.replaceWith(el('span', '', '◆'));
    back.append(backImg);
    inner.append(front, back);
    node.append(inner);
    if (!faceUp) inner.style.transform = 'rotateY(180deg)';
    return { node, inner };
  }

  private q(selector: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(selector);
  }

  /** Where a place is on screen. */
  private rectAt(pl: Place, card: CardId, snap: Snapshot, c: Ctx): DOMRect | undefined {
    const own = snap.cards.get(card);
    if (own) return own;
    const zone = (name: string) => snap.zones.get(name);
    switch (pl.zone) {
      case 'pokemon':
      case 'energy':
      case 'tool': {
        const sl = snap.slots.get(pl.uid)?.rect;
        if (sl) return sl;
        const isActive = c.next.players[pl.player].active?.uid === pl.uid || c.prev.players[pl.player].active?.uid === pl.uid;
        const z = zone(isActive ? `active-${pl.player}` : `bench-${pl.player}`);
        return z && cardIn(z, 'center', isActive ? 1 : 0.8);
      }
      case 'hand': {
        const z = zone(`hand-${pl.player}`);
        return z && cardIn(z, pl.player === 0 ? 'end' : 'center', pl.player === 0 ? 0.9 : 1.4);
      }
      case 'prizes': {
        const z = zone(`prizes-${pl.player}`);
        return z && cardIn(z, 'center', 0.32);
      }
      case 'stadium':
        return zone('stadium');
      default:
        return zone(`${pl.zone}-${pl.player}`);
    }
  }

  // ---------- phases ----------

  private phase(phase: Phase, group: AnimEvent[], t: number, c: Ctx): number {
    const k = this.k;
    let end = 0;
    const span = (d: number) => (end = Math.max(end, d));
    let i = 0;
    const nextDelay = (lag = 0) => lag + Math.min(i++, 8) * STAGGER * k;
    switch (phase) {
      case 'play':
      case 'move':
      case 'ko':
        for (const e of group) {
          if (e.t === 'ko') {
            this.cue?.(e, t);
            span(this.knockOut(e, t, c));
          } else if (e.t === 'move') {
            if (phase === 'ko' && e.from.zone === 'pokemon') continue; // the stand-in goes instead
            const d = nextDelay(phase === 'ko' ? 520 * k : 0);
            this.cue?.(e, t + d);
            span(d + this.move(e, t + d, c));
          } else if (e.t === 'evolve') {
            this.cue?.(e, t + 380 * k);
            span(this.evolve(e, t + 380 * k, c) + 380 * k);
          } else if (e.t === 'shuffle') {
            this.cue?.(e, t);
            span(this.shuffle(e.player, t));
          }
        }
        break;
      case 'act':
        for (const e of group) {
          this.cue?.(e, t);
          if (e.t === 'attack') span(this.banner(e.name, e.player, typeColor(e.type), t, c));
          if (e.t === 'ability') span(this.ability(e, t, c));
        }
        break;
      case 'coin':
        group.forEach((e, n) => {
          if (e.t !== 'coin') return;
          this.cue?.(e, t + n * 720 * k);
          span(n * 720 * k + this.coin(e.heads, n, group.length, t + n * 720 * k, c));
        });
        break;
      case 'hit': {
        const lunge = c.attack ? this.lunge(c.attack, t) : 0;
        span(lunge);
        for (const e of group) {
          if (e.t === 'damage') {
            this.cue?.(e, t + lunge);
            span(lunge + this.damage(e, t + lunge, c));
          }
          if (e.t === 'condition') span(lunge + this.condition(e, t + lunge, c));
        }
        break;
      }
      case 'turn': {
        let lag = 0;
        for (const e of group) {
          if (e.t === 'reveal') {
            this.cue?.(e, t);
            span(this.reveal(t));
            lag = Math.max(lag, 300 * k);
          } else if (e.t === 'turn') {
            this.cue?.(e, t);
            span(this.turn(e.turn, e.player, t, c));
            lag = 620 * k;
          } else if (e.t === 'move') {
            const d = nextDelay(lag);
            this.cue?.(e, t + d);
            span(d + this.move(e, t + d, c));
          }
        }
        break;
      }
      case 'end':
        for (const e of group) this.cue?.(e, t);
        break;
    }
    return end;
  }

  /** A card flying from where it was to where it is now. Returns its duration. */
  private move(e: Ev<'move'>, t: number, c: Ctx): number {
    const k = this.k;
    const from = this.rectAt(e.from, e.card, c.before, c) ?? this.rectAt(e.from, e.card, c.after, c);
    const to = this.rectAt(e.to, e.card, c.after, c);
    if (!from || !to) return 0;
    const dest = this.destination(e, c);
    // A played Trainer goes up to the middle of the table, large enough to read. Its copy is laid out at that size
    // and scaled down for the flight: a copy laid out small and scaled up is drawn blurred until the browser redraws it.
    const w = Math.max(from.width * 1.5, Math.min(c.board.width * 0.3, c.board.height * 0.52 * CARD));
    const mid = new DOMRect(c.board.left + (c.board.width - w) / 2, c.board.top + c.board.height / 2 - w / CARD / 2, w, w / CARD);
    const box = e.stage ? new DOMRect(from.left, from.top, mid.width, mid.height) : from;
    const { node, inner } = this.card(e.key, box, e.faceUp[0], !!e.stage);
    node.style.transformOrigin = '0 0';
    const at = (r: DOMRect, lift = 0, s = 1) =>
      `translate(${r.left - from.left}px, ${r.top - from.top - lift}px) scale(${(r.width / box.width) * s})`;
    const fades = !dest && e.to.zone !== 'discard' && e.to.zone !== 'stadium';
    let dur: number;
    let frames: Keyframe[];
    if (e.stage) {
      // Held in the middle (the bot's longer: you didn't choose it), then to the discard pile.
      dur = (e.from.player === 0 ? 1300 : 2300) * k;
      frames = [
        { transform: at(from), offset: 0 },
        { transform: at(mid, 0, 0.98), offset: 0.28 },
        { transform: at(mid), offset: 0.72 },
        { transform: at(to), offset: 1 },
      ];
      const who = e.from.player === 0 ? tx('คุณ', 'You') : tx('บอท', 'Bot');
      const label = this.node('fx-stage-label', undefined, tx(`${who} ใช้ ${e.key ? def(e.key).name : ''}`, `${who} ${e.from.player === 0 ? 'play' : 'plays'} ${e.key ? def(e.key).name : ''}`));
      this.at(label, c.board.left + c.board.width / 2, mid.bottom + 8);
      this.drop(
        label,
        this.anim(label, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1, offset: 0.32 }, { opacity: 1, offset: 0.68 }, { opacity: 0, offset: 0.76 }, { opacity: 0, offset: 1 }], {
          duration: dur,
          delay: t,
        }),
      );
    } else {
      dur = 430 * k;
      const lift = Math.min(60, Math.hypot(to.left - from.left, to.top - from.top) * 0.15);
      const half = new DOMRect((from.left + to.left) / 2, (from.top + to.top) / 2, (from.width + to.width) / 2, 0);
      frames = [
        { transform: at(from), opacity: 1 },
        { transform: at(half, lift, 1.08), opacity: 1, offset: 0.5 },
        { transform: at(to), opacity: fades ? 0.2 : 1 },
      ];
    }
    this.drop(node, this.anim(node, frames, { duration: dur, delay: t }));
    if (e.faceUp[0] !== e.faceUp[1]) {
      const [a, b] = e.faceUp[0] ? ['rotateY(0deg)', 'rotateY(180deg)'] : ['rotateY(180deg)', 'rotateY(0deg)'];
      this.anim(inner, [{ transform: a }, { transform: a, offset: 0.25 }, { transform: b }], { duration: dur * (e.stage ? 0.3 : 1), delay: t });
    }
    // The real card waits under the flying copy, then lands with a small bounce.
    if (dest) {
      this.anim(dest, [{ opacity: 0 }, { opacity: 0 }], { duration: t + dur, fill: 'none', easing: 'linear' });
      this.anim(dest, [{ scale: '1.12' }, { scale: '0.97', offset: 0.6 }, { scale: '1' }], {
        duration: 240 * k,
        delay: t + dur,
        fill: 'none',
      });
    } else if (e.to.zone === 'discard' || e.to.zone === 'deck' || e.to.zone === 'prizes') {
      const z = this.q(`[data-zone="${e.to.zone}-${e.to.player}"]`);
      if (z) this.anim(z, [{ transform: 'none' }, { transform: 'scale(1.08)' }, { transform: 'none' }], { duration: 220 * k, delay: t + dur, fill: 'none' });
    }
    return dur;
  }

  /** The real element a card ends up in, hidden until the flying copy lands. */
  private destination(e: Ev<'move'>, c: Ctx): HTMLElement | null {
    if (e.to.zone === 'pokemon' && !c.before.slots.has(e.to.uid)) return this.q(`[data-slot="${e.to.uid}"]`);
    if (e.to.zone === 'discard') {
      const last = c.next.players[e.to.player].discard.at(-1);
      return last === e.card ? this.q(`[data-zone="discard-${e.to.player}"] .face`) : null;
    }
    return this.q(`[data-card="${e.card}"]`);
  }

  private evolve(e: Ev<'evolve'>, t: number, c: Ctx): number {
    const k = this.k;
    const r = c.after.slots.get(e.uid)?.rect;
    if (!r) return 0;
    // The old form stays on show until the new card lands on it.
    const prevSlot = [c.prev.players[e.player].active, ...c.prev.players[e.player].bench].find((s) => s?.uid === e.uid);
    if (prevSlot) {
      const old = this.card(topKey(c.prev, prevSlot), r, true).node;
      this.drop(old, this.anim(old, [{ opacity: 1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: t + 60 * k, easing: 'linear' }));
    }
    const flash = this.node('fx-evolve', r);
    this.drop(
      flash,
      this.anim(flash, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1.05)', offset: 0.3 }, { opacity: 0, transform: 'scale(1.5)' }], {
        duration: 650 * k,
        delay: t,
      }),
    );
    return 650 * k;
  }

  private shuffle(p: PlayerId, t: number): number {
    const deck = this.q(`[data-zone="deck-${p}"]`);
    if (!deck) return 0;
    const k = this.k;
    const r = (deg: number, x: number) => ({ transform: `translateX(${x}px) rotate(${deg}deg)` });
    this.anim(deck, [r(0, 0), r(-6, -5), r(5, 4), r(-4, -3), r(3, 2), r(0, 0)], { duration: 480 * k, delay: t, fill: 'none', easing: 'ease-in-out' });
    return 480 * k;
  }

  /** The attack's name across the table, from the attacker's side. */
  private banner(text: string, p: PlayerId, color: string, t: number, c: Ctx): number {
    const k = this.k;
    const n = this.node(`fx-banner ${p === 0 ? 'mine' : 'theirs'}`, undefined, text);
    n.style.setProperty('--c', color);
    this.at(n, c.board.left + c.board.width / 2, c.board.top + c.board.height / 2);
    const dx = p === 0 ? -60 : 60;
    const pose = (x: number, o: number, offset?: number) => ({ opacity: o, transform: `translate(calc(-50% + ${x}px), -50%) skewX(-12deg)`, ...(offset !== undefined && { offset }) });
    this.drop(n, this.anim(n, [pose(dx, 0), pose(0, 1, 0.25), pose(0, 1, 0.8), pose(-dx, 0)], { duration: 700 * k, delay: t }));
    return 620 * k;
  }

  private ability(e: Ev<'ability'>, t: number, c: Ctx): number {
    const k = this.k;
    const r = c.after.slots.get(e.uid)?.rect ?? c.before.slots.get(e.uid)?.rect;
    if (!r) return 0;
    const ring = this.node('fx-ring gold', r);
    this.drop(ring, this.anim(ring, [{ opacity: 0.9, transform: 'scale(.9)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 700 * k, delay: t }));
    const label = this.node('fx-tag gold', undefined, `✦ ${e.name}`);
    this.at(label, r.left + r.width / 2, r.top);
    const pose = (y: number, o: number, offset?: number) => ({ opacity: o, transform: `translate(-50%, ${y}%)`, ...(offset !== undefined && { offset }) });
    this.drop(label, this.anim(label, [pose(0, 0), pose(-120, 1, 0.25), pose(-120, 1, 0.8), pose(-160, 0)], { duration: 900 * k, delay: t }));
    return 700 * k;
  }

  private coin(heads: boolean, i: number, n: number, t: number, c: Ctx): number {
    const k = this.k;
    const size = Math.min(72, c.board.width * 0.12);
    const x = c.board.left + c.board.width / 2 + (i - (n - 1) / 2) * (size + 12) - size / 2;
    const y = c.board.top + c.board.height / 2 - size / 2;
    const coin = this.node('fx-coin', new DOMRect(x, y, size, size));
    const spin = el('div', 'fx-coin-spin');
    // Gold heads, silver tails; the word shows once it lands.
    const face = (side: 'heads' | 'tails') => {
      const n = el('span', side);
      n.style.backgroundImage = `url(${COIN[side]})`;
      return n;
    };
    spin.append(face('heads'), face('tails'));
    const label = el('span', 'fx-coin-label', heads ? tx('หัว', 'Heads') : tx('ก้อย', 'Tails'));
    coin.append(spin, label);
    const turns = 5 * 360 + (heads ? 0 : 180);
    const dur = 900 * k;
    this.anim(label, [{ opacity: 0, transform: 'translate(-50%, -4px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 180 * k, delay: t + dur * 0.7 });
    // Every coin stays until the last one has landed.
    const hold = 720 * k * (n - 1 - i) + 450 * k;
    this.drop(
      coin,
      this.anim(
        coin,
        [
          { transform: 'translateY(0) scale(.6)', opacity: 0 },
          { transform: `translateY(${-size}px) scale(1.1)`, opacity: 1, offset: 0.25 },
          { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.5 },
          { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.9 },
          { transform: 'translateY(0) scale(1)', opacity: 0 },
        ],
        { duration: dur + hold, delay: t, easing: 'ease-out' },
      ),
    );
    this.anim(spin, [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${turns}deg)` }], { duration: dur * 0.7, delay: t, easing: 'cubic-bezier(.2,.6,.3,1)' });
    return dur * 0.75;
  }

  /** The attacker lunges at the other side. */
  private lunge(a: Ev<'attack'>, t: number): number {
    const k = this.k;
    const slot = this.q(`[data-slot="${a.uid}"]`);
    if (!slot) return 0;
    const dy = a.player === 0 ? -34 : 34;
    this.anim(
      slot,
      [{ transform: 'none' }, { transform: `translateY(${-dy * 0.25}px) scale(.98)`, offset: 0.3 }, { transform: `translateY(${dy}px) scale(1.08)`, offset: 0.62 }, { transform: 'none' }],
      { duration: 420 * k, delay: t, fill: 'none', easing: 'ease-in-out' },
    );
    return 260 * k;
  }

  private damage(e: Ev<'damage'>, t: number, c: Ctx): number {
    const k = this.k;
    const r = c.after.slots.get(e.uid)?.rect ?? c.before.slots.get(e.uid)?.rect;
    if (!r) return 0;
    const heal = e.amount < 0;
    if (!heal) {
      const burst = this.node('fx-burst', r);
      burst.style.setProperty('--c', c.attack ? typeColor(c.attack.type) : '#e2574b');
      for (let i = 0; i < 8; i++) {
        const shard = el('i');
        shard.style.setProperty('--a', `${i * 45 + 20}deg`);
        burst.append(shard);
      }
      this.drop(burst, this.anim(burst, [{ opacity: 1, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.4 }, { opacity: 0, transform: 'scale(1.25)' }], { duration: 520 * k, delay: t }));
      const target = c.standIns.get(e.uid) ?? this.q(`[data-slot="${e.uid}"]`);
      const sx = (x: number) => ({ transform: `translateX(${x}px)` });
      if (target) this.anim(target, [sx(0), sx(-7), sx(6), sx(-4), sx(3), sx(0)], { duration: 380 * k, delay: t + 60 * k, fill: 'none' });
    }
    const num = this.node(`fx-num${heal ? ' heal' : ''}`, undefined, heal ? `+${-e.amount}` : `-${e.amount}`);
    this.at(num, r.left + r.width / 2, r.top + r.height * 0.35);
    this.drop(
      num,
      this.anim(
        num,
        [
          { opacity: 0, transform: 'translate(-50%, 0) scale(.5)' },
          { opacity: 1, transform: 'translate(-50%, -30%) scale(1.25)', offset: 0.18 },
          { opacity: 1, transform: 'translate(-50%, -80%) scale(1)', offset: 0.7 },
          { opacity: 0, transform: 'translate(-50%, -130%) scale(1)' },
        ],
        { duration: 1000 * k, delay: t + 80 * k },
      ),
    );
    // HP counts down and the bar drains on the real card.
    const slot = this.q(`[data-slot="${e.uid}"]`);
    const was = c.before.slots.get(e.uid);
    const now = c.after.slots.get(e.uid);
    if (slot && was && now) {
      const pct = (s: SlotSnap) => `${(s.left / Math.max(1, s.max)) * 100}%`;
      this.anim(
        slot,
        [
          { '--left': was.left, '--dmg': was.dmg, '--pct': pct(was) },
          { '--left': now.left, '--dmg': now.dmg, '--pct': pct(now) },
        ],
        { duration: 520 * k, delay: t + 80 * k, easing: 'ease-out' },
      );
      const badge = slot.querySelector('.dmg');
      if (badge && was.dmg === 0) {
        this.anim(badge, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.3)', offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 320 * k, delay: t + 80 * k });
      }
    }
    return 700 * k;
  }

  private condition(e: Ev<'condition'>, t: number, c: Ctx): number {
    const k = this.k;
    const badge = this.q(`[data-slot="${e.uid}"] .cond`);
    if (badge) this.anim(badge, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.3)', offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 380 * k, delay: t });
    const r = c.after.slots.get(e.uid)?.rect;
    if (r) {
      const tag = this.node('fx-tag cond', undefined, e.condition === 'poisoned' ? tx('ติดพิษ', 'Poisoned') : tx('สับสน', 'Confused'));
      this.at(tag, r.left + r.width / 2, r.top + r.height * 0.6);
      this.drop(tag, this.anim(tag, [{ opacity: 0, transform: 'translate(-50%, 0)' }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.3 }, { opacity: 0, transform: 'translate(-50%, -120%)' }], { duration: 900 * k, delay: t }));
    }
    return 500 * k;
  }

  /** Red flash and a stamped "KO", then the card greys out and goes to the discard pile. */
  private knockOut(e: Ev<'ko'>, t: number, c: Ctx): number {
    const k = this.k;
    const r = c.before.slots.get(e.uid)?.rect;
    const standIn = c.standIns.get(e.uid);
    if (!r || !standIn) return 0;
    const flash = this.node('fx-ko-flash', r);
    this.drop(flash, this.anim(flash, [{ opacity: 0 }, { opacity: 0.85, offset: 0.2 }, { opacity: 0.35, offset: 0.6 }, { opacity: 0 }], { duration: 560 * k, delay: t }));
    const ring = this.node('fx-ring red', r);
    this.drop(ring, this.anim(ring, [{ opacity: 1, transform: 'scale(.8)' }, { opacity: 0, transform: 'scale(1.9)' }], { duration: 620 * k, delay: t }));
    const stamp = this.node('fx-stamp', undefined, 'KO');
    this.at(stamp, r.left + r.width / 2, r.top + r.height / 2);
    const pose = (s: number, o: number, offset?: number) => ({ opacity: o, transform: `translate(-50%, -50%) rotate(-14deg) scale(${s})`, ...(offset !== undefined && { offset }) });
    this.drop(stamp, this.anim(stamp, [pose(2.4, 0), pose(1, 1, 0.25), pose(1, 1, 0.75), pose(1, 0)], { duration: 820 * k, delay: t }));
    const to = c.after.zones.get(`discard-${e.player}`) ?? r;
    const move = (x: DOMRect, s: number) => `translate(${x.left - r.left}px, ${x.top - r.top}px) scale(${(x.width / r.width) * s})`;
    standIn.style.transformOrigin = '0 0';
    this.drop(
      standIn,
      this.anim(
        standIn,
        [
          { transform: 'none', filter: 'none', opacity: 1 },
          { transform: 'none', filter: 'grayscale(.6) brightness(.8)', opacity: 1, offset: 0.55 },
          { transform: move(r, 0.96), filter: 'grayscale(1) brightness(.7)', opacity: 1, offset: 0.7 },
          { transform: move(to, 1), filter: 'grayscale(1) brightness(.7)', opacity: 0.9 },
        ],
        { duration: 1000 * k, delay: t },
      ),
    );
    return 1000 * k;
  }

  /** Both sides' setup Pokémon turn face up together. */
  private reveal(t: number): number {
    const k = this.k;
    this.root.querySelectorAll('[data-slot] .card').forEach((card, i) => {
      this.anim(card, [{ transform: 'perspective(600px) rotateY(90deg)' }, { transform: 'none' }], { duration: 420 * k, delay: t + i * 60 * k });
    });
    return 600 * k;
  }

  /** "Turn N · your turn" sweeps across the table. */
  private turn(turn: number, p: PlayerId, t: number, c: Ctx): number {
    const k = this.k;
    const n = this.node(`fx-turn ${p === 0 ? 'mine' : 'theirs'}`);
    const text = el('strong', '', p === 0 ? tx('ตาคุณ', 'Your turn') : tx('ตาบอท', "Bot's turn"));
    n.append(el('small', '', tx(`เทิร์น ${turn}`, `Turn ${turn}`)), text);
    Object.assign(n.style, { left: `${c.board.left}px`, width: `${c.board.width}px`, top: `${c.board.top + c.board.height / 2}px` });
    const pose = (sy: number, o: number, offset?: number) => ({ opacity: o, transform: `translateY(-50%) scaleY(${sy})`, ...(offset !== undefined && { offset }) });
    this.drop(n, this.anim(n, [pose(0.2, 0), pose(1, 1, 0.18), pose(1, 1, 0.78), pose(0.2, 0)], { duration: 1000 * k, delay: t }));
    this.anim(text, [{ transform: 'translateX(-40px)', letterSpacing: '0.3em' }, { transform: 'none', letterSpacing: '0.04em', offset: 0.3 }, { transform: 'translateX(20px)', letterSpacing: '0.04em' }], {
      duration: 1000 * k,
      delay: t,
    });
    return 1000 * k;
  }

  /** Pokémon and hand cards that only changed position (retreat, promotion, the hand closing a gap) slide there. */
  private reflow(events: AnimEvent[], c: Ctx, moveStart: number) {
    const k = this.k;
    const moved = new Set(events.flatMap((e) => (e.t === 'move' ? [e.card] : [])));
    const fresh = new Set(events.flatMap((e) => (e.t === 'move' && e.to.zone === 'pokemon' ? [e.to.uid] : [])));
    for (const [uid, now] of c.after.slots) {
      const was = c.before.slots.get(uid);
      if (!was || fresh.has(uid)) continue;
      const dx = was.rect.left - now.rect.left;
      const dy = was.rect.top - now.rect.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      const slot = this.q(`[data-slot="${uid}"]`);
      const s = was.rect.width / now.rect.width;
      if (slot) {
        this.anim(slot, [{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], {
          duration: 380 * k,
          delay: moveStart,
        });
      }
    }
    for (const card of this.root.querySelectorAll<HTMLElement>('.hcard[data-card]')) {
      const id = Number(card.dataset.card);
      const was = c.before.cards.get(id);
      const now = c.after.cards.get(id);
      if (!was || !now || moved.has(id)) continue;
      const dx = was.left - now.left;
      if (Math.abs(dx) >= 2) this.anim(card, [{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 260 * k, fill: 'none' });
    }
  }
}
