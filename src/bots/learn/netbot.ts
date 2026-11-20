// A bot that plays from the policy network (one forward pass per decision, no search), and a recorder
// that turns any bot's moves into training rows (imitation data for ml/train.py).
// Pending choices are made one pick at a time; "stop" ends a pick that may take fewer than the maximum.
import { actor } from '../../engine/actions';
import { keyOf } from '../../engine/state';
import type { Action, GameState, PlayerId } from '../../engine/types';
import { makeRand } from '../random';
import type { Bot } from '../types';
import { encode, type Encoded, type OptionRef } from './encode';
import { run, softmax, type Model } from './model';

export const MAX_ACTIONS_PER_TURN = 60;

export interface Decision {
  enc: Encoded;
  player: PlayerId;
  /** Index of the option taken. */
  chosen: number;
  /** Log-probability of that option under the policy that chose it (0 for a recorded bot). */
  logp: number;
  /** The network's value estimate (NaN for a recorded bot). */
  value: number;
  /** The recorded bot searched this decision (look-ahead), rather than playing its first instinct. */
  searched?: boolean;
  /** The deciding network's logits for every option (soft targets for imitation, ml/train_bc.py). */
  logits?: Float32Array;
}

/** A bot that can say whether its last main-phase move came out of a search (search.ts). */
export interface SearchingBot extends Bot {
  lastSearched?: boolean;
}

export interface NetBotOptions {
  /** Plan names [mine, theirs]. */
  decks: readonly [string, string];
  seed?: number;
  /** 0 = always the best option; otherwise sample from softmax(logits / temperature). */
  temperature?: number;
  /** Called for every decision with more than one option. */
  onDecision?: (d: Decision) => void;
}

/** Same action, treating copies of the same card as equal. */
export function actionKey(s: GameState, a: Action): string {
  return JSON.stringify('card' in a ? { ...a, card: keyOf(s, a.card) } : a);
}

/** Per-turn action count of the player to act (both the bot and the recorder use it as a feature). */
export function turnCounter() {
  let turn = -1;
  let player = -1;
  let n = 0;
  return (s: GameState, me: PlayerId) => {
    if (s.turn !== turn || player !== me) {
      turn = s.turn;
      player = me;
      n = 0;
    }
    return n++;
  };
}

export function makeNetBot(model: Model, o: NetBotOptions): Bot {
  const rand = makeRand(o.seed ?? 1);
  const temperature = o.temperature ?? 0;
  const count = turnCounter();
  const pick = (enc: Encoded, me: PlayerId): number => {
    if (enc.refs.length === 1) return 0;
    const out = run(model, enc);
    let i = 0;
    if (temperature <= 0) {
      for (let k = 1; k < out.logits.length; k++) if (out.logits[k]! > out.logits[i]!) i = k;
    } else {
      const p = softmax(out.logits, temperature);
      let r = rand();
      i = p.length - 1;
      for (let k = 0; k < p.length; k++) {
        r -= p[k]!;
        if (r <= 0) {
          i = k;
          break;
        }
      }
    }
    if (o.onDecision) {
      const p = softmax(out.logits);
      o.onDecision({ enc, player: me, chosen: i, logp: Math.log(Math.max(p[i]!, 1e-12)), value: out.value, logits: out.logits });
    }
    return i;
  };

  return {
    act(s: GameState): Action {
      const me = actor(s);
      if (s.pending) {
        const picks: number[] = [];
        for (;;) {
          const enc = encode(s, { decks: o.decks }, picks);
          const ref = enc.refs[pick(enc, me)]!;
          if (ref.t !== 'pick') break;
          picks.push(ref.value);
        }
        return { t: 'choose', picks };
      }
      const n = count(s, me);
      if (n >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
      const enc = encode(s, { decks: o.decks, actionsThisTurn: n });
      return (enc.refs[pick(enc, me)] as Extract<OptionRef, { t: 'action' }>).action;
    },
  };
}

/**
 * Wrap a bot so each of its decisions is also written as rows (`onDecision`), as if the network had
 * chosen the same options. Picks are split the way makeNetBot makes them.
 */
export function recordBot(bot: SearchingBot, decks: readonly [string, string], onDecision: (d: Decision) => void): Bot {
  const count = turnCounter();
  return {
    act(s: GameState): Action {
      const me = actor(s);
      const a = bot.act(s);
      if (s.pending) {
        if (a.t !== 'choose') return a;
        const picks: number[] = [];
        for (const v of [...a.picks, null]) {
          const enc = encode(s, { decks }, picks);
          const i = enc.refs.findIndex((r) => (v === null ? r.t === 'stop' : r.t === 'pick' && r.value === v));
          if (i < 0) break;
          if (enc.refs.length > 1) onDecision({ enc, player: me, chosen: i, logp: 0, value: NaN });
          if (v === null) break;
          picks.push(v);
        }
        return a;
      }
      const n = count(s, me);
      const enc = encode(s, { decks, actionsThisTurn: n });
      if (enc.refs.length > 1) {
        const k = actionKey(s, a);
        const i = enc.refs.findIndex((r) => r.t === 'action' && actionKey(s, r.action) === k);
        if (i >= 0) onDecision({ enc, player: me, chosen: i, logp: 0, value: NaN, searched: bot.lastSearched === true });
      }
      return a;
    },
  };
}
