// Short sounds for what happens on the table, made with Web Audio (no sound files): a card, a played card, an
// attack, a hit, a Knock Out, a coin, a new turn, the end. The animation player (fx.ts) cues each one when its event
// starts; with animations off the important ones play at once. Off with the "เสียง" switch.
import type { AnimEvent } from './anim/events';

export type Voice = 'card' | 'play' | 'shuffle' | 'attack' | 'ability' | 'hit' | 'heal' | 'ko' | 'coin' | 'turn' | 'win' | 'lose';

/** Which sound an animation event makes (null: none). `me` is the player the screen belongs to. */
export function voiceFor(e: AnimEvent, me: 0 | 1 = 0): Voice | null {
  switch (e.t) {
    case 'move':
      if (e.stage) return 'play';
      return e.from.zone === 'hand' && (e.to.zone === 'pokemon' || e.to.zone === 'energy' || e.to.zone === 'tool') ? 'play' : 'card';
    case 'shuffle':
      return 'shuffle';
    case 'evolve':
    case 'ability':
      return 'ability';
    case 'coin':
      return 'coin';
    case 'attack':
      return 'attack';
    case 'damage':
      return e.amount > 0 ? 'hit' : 'heal';
    case 'ko':
      return 'ko';
    case 'turn':
    case 'reveal':
      return 'turn';
    case 'over':
      return e.winner === me ? 'win' : 'lose';
    default:
      return null;
  }
}

/** The sounds worth hearing when nothing is animated. */
export const KEY_VOICES = new Set<Voice>(['attack', 'ko', 'coin', 'turn', 'win', 'lose']);

/** How close two sounds of the same kind may be (a hand of seven cards dealt is a few ticks, not seven). */
export const MIN_GAP: Partial<Record<Voice, number>> = { card: 70, play: 120, hit: 90, shuffle: 400, coin: 150 };

let enabled = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const lastAt = new Map<Voice, number>();

export function setSound(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  // Browsers start it suspended until the page has been used.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Play `e`'s sound in `inMs` milliseconds. */
export function cue(e: AnimEvent, inMs = 0, me: 0 | 1 = 0): void {
  const v = voiceFor(e, me);
  if (v) playVoice(v, inMs);
}

export function playVoice(v: Voice, inMs = 0): void {
  if (!enabled) return;
  const now = performance.now() + inMs;
  const gap = MIN_GAP[v] ?? 0;
  if (gap && now - (lastAt.get(v) ?? -Infinity) < gap) return;
  lastAt.set(v, now);
  const a = audio();
  if (!a || !master) return;
  try {
    VOICES[v](a, a.currentTime + Math.max(0, inMs) / 1000, master);
  } catch {
    /* a sound is never worth an error */
  }
}

// ---------- the sounds ----------

interface Tone {
  f: number;
  to?: number;
  type?: OscillatorType;
  dur: number;
  vol: number;
  delay?: number;
}

function tone(a: AudioContext, t0: number, out: AudioNode, { f, to, type = 'sine', dur, vol, delay = 0 }: Tone): void {
  const t = t0 + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(a: AudioContext, t0: number, out: AudioNode, { dur, vol, freq, q = 1, to }: { dur: number; vol: number; freq: number; q?: number; to?: number }): void {
  const n = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(freq, t0);
  if (to) bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const VOICES: Record<Voice, (a: AudioContext, t: number, out: AudioNode) => void> = {
  card: (a, t, o) => noise(a, t, o, { dur: 0.05, vol: 0.25, freq: 2600, q: 1.5 }),
  play: (a, t, o) => {
    noise(a, t, o, { dur: 0.16, vol: 0.3, freq: 900, to: 3200, q: 0.8 });
    tone(a, t, o, { f: 520, to: 780, dur: 0.12, vol: 0.08 });
  },
  shuffle: (a, t, o) => {
    for (let i = 0; i < 6; i++) noise(a, t + i * 0.045, o, { dur: 0.04, vol: 0.18, freq: 2000 + i * 150, q: 2 });
  },
  attack: (a, t, o) => {
    tone(a, t, o, { f: 220, to: 110, type: 'sawtooth', dur: 0.2, vol: 0.12 });
    noise(a, t, o, { dur: 0.22, vol: 0.25, freq: 500, to: 1800, q: 0.7 });
  },
  ability: (a, t, o) => {
    tone(a, t, o, { f: 880, dur: 0.12, vol: 0.08 });
    tone(a, t, o, { f: 1320, dur: 0.16, vol: 0.07, delay: 0.07 });
    tone(a, t, o, { f: 1760, dur: 0.2, vol: 0.06, delay: 0.14 });
  },
  hit: (a, t, o) => {
    tone(a, t, o, { f: 150, to: 55, type: 'triangle', dur: 0.16, vol: 0.35 });
    noise(a, t, o, { dur: 0.08, vol: 0.3, freq: 700, q: 0.6 });
  },
  heal: (a, t, o) => tone(a, t, o, { f: 600, to: 1100, dur: 0.3, vol: 0.08 }),
  ko: (a, t, o) => {
    tone(a, t, o, { f: 120, to: 35, type: 'triangle', dur: 0.6, vol: 0.4 });
    noise(a, t, o, { dur: 0.5, vol: 0.25, freq: 400, to: 120, q: 0.5 });
  },
  coin: (a, t, o) => {
    tone(a, t, o, { f: 2093, dur: 0.25, vol: 0.09, type: 'triangle' });
    tone(a, t, o, { f: 3136, dur: 0.18, vol: 0.05, delay: 0.02 });
  },
  turn: (a, t, o) => {
    tone(a, t, o, { f: 660, dur: 0.16, vol: 0.09 });
    tone(a, t, o, { f: 990, dur: 0.22, vol: 0.08, delay: 0.12 });
  },
  win: (a, t, o) => [523, 659, 784, 1047].forEach((f, i) => tone(a, t, o, { f, dur: 0.3, vol: 0.1, delay: i * 0.12, type: 'triangle' })),
  lose: (a, t, o) => [392, 330, 262].forEach((f, i) => tone(a, t, o, { f, dur: 0.35, vol: 0.09, delay: i * 0.16, type: 'triangle' })),
};
