// A bot that plays from the policy network (one forward pass per decision, no search), and a recorder
// that turns any bot's moves into training rows (imitation data for ml/train.py).
// Pending choices are made one pick at a time; "stop" ends a pick that may take fewer than the maximum.
import { actor } from '../../engine/actions';
import { keyOf } from '../../engine/state';
import type { Action, GameState, PlayerId } from '../../engine/types';
import { makeRand } from '../random';
import type { Bot } from '../types';
import { cardNumber, encode, VOCAB, type Encoded, type OptionRef } from './encode';
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
  /** Training-only labels the player can't see: how many of each card (by number) the opponent holds now. */
  oppHand?: Uint8Array;
  /** Training-only: the hidden cards the critic that sees all reads (oracleOf). */
  oracle?: Int16Array;
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
  /**
   * With temperature 0: pick at random among the options whose probability is within this much of the best one
   * (BOT-NEXT.md N6: a player who replays the same game should not meet the same moves every time). 0 = never.
   */
  ties?: number;
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

/** How many of each card (by number) the opponent of `me` holds: a training label the player can't see. */
export function oppHand(s: GameState, me: PlayerId): Uint8Array {
  const out = new Uint8Array(VOCAB);
  for (const c of s.players[me === 0 ? 1 : 0].hand) out[cardNumber(keyOf(s, c))]!++;
  return out;
}

/** Numbers in oracleOf(): 6 Prize cards each, 3 cards on top of each deck. */
export const ORACLE = 18;

/**
 * Training-only (BOT-NEXT.md N4, the critic that sees all, PerfectDou): card numbers of `me`'s Prize cards, the
 * opponent's, the top 3 of `me`'s deck and of theirs (0 = none). Never an input of the policy.
 */
export function oracleOf(s: GameState, me: PlayerId): Int16Array {
  const out = new Int16Array(ORACLE);
  const put = (at: number, cards: number[], n: number) => cards.slice(0, n).forEach((c, i) => (out[at + i] = cardNumber(keyOf(s, c))));
  const mine = s.players[me];
  const theirs = s.players[me === 0 ? 1 : 0];
  put(0, mine.prizes, 6);
  put(6, theirs.prizes, 6);
  put(12, mine.deck, 3);
  put(15, theirs.deck, 3);
  return out;
}

/** The option to play with temperature 0: the best, or with `ties` a random one of those within `ties` of its probability. */
export function bestOption(logits: Float32Array, ties: number, rand: () => number): number {
  let i = 0;
  for (let k = 1; k < logits.length; k++) if (logits[k]! > logits[i]!) i = k;
  if (ties <= 0) return i;
  const p = softmax(logits);
  const near = [];
  for (let k = 0; k < p.length; k++) if (p[k]! >= p[i]! - ties) near.push(k);
  return near.length > 1 ? near[Math.floor(rand() * near.length)]! : i;
}

export function makeNetBot(model: Model, o: NetBotOptions): Bot {
  const rand = makeRand(o.seed ?? 1);
  const temperature = o.temperature ?? 0;
  const count = turnCounter();
  const pick = (enc: Encoded, me: PlayerId, s: GameState): number => {
    if (enc.refs.length === 1) return 0;
    const out = run(model, enc);
    let i = 0;
    if (temperature <= 0) {
      i = bestOption(out.logits, o.ties ?? 0, rand);
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
      o.onDecision({ enc, player: me, chosen: i, logp: Math.log(Math.max(p[i]!, 1e-12)), value: out.value, logits: out.logits, oppHand: oppHand(s, me), oracle: oracleOf(s, me) });
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
          const ref = enc.refs[pick(enc, me, s)]!;
          if (ref.t !== 'pick') break;
          picks.push(ref.value);
        }
        return { t: 'choose', picks };
      }
      const n = count(s, me);
      if (n >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
      const enc = encode(s, { decks: o.decks, actionsThisTurn: n });
      return (enc.refs[pick(enc, me, s)] as Extract<OptionRef, { t: 'action' }>).action;
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
