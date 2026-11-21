// The English site (/en/…): nothing Thai left in what a game shows (the log, prompts and their options, why a card
// can't be played, the buttons), the bot plays the same moves in either language, and the play screen still reads
// the engine's English log lines (coin flips, the turn header).
import { afterEach, describe, expect, it } from 'vitest';
import { makeBot } from '../../src/bots/core';
import { explainAction, explainEnd } from '../../src/bots/explain';
import { planFor } from '../../src/bots/plans';
import { makeRand, randomAction } from '../../src/bots/random';
import { apply, createGame, legalActions, whyNotPlayable } from '../../src/engine/actions';
import type { GameState } from '../../src/engine/types';
import { botName, langOfPath, localePath, setLang, stripLang, youName } from '../../src/i18n';
import { playGame } from '../../src/sim/game';
import { actionBar } from '../../src/ui/action-bar';
import { animEvents } from '../../src/ui/anim/events';
import { describeAction, handActions, turnUses, waitingText } from '../../src/ui/play';
import { turnRecap } from '../../src/ui/recap';
import { slotInfo } from '../../src/ui/slot-info';
import { deck, DECK_SLUGS } from '../engine/helpers';

const THAI = /[฀-๿]/;

afterEach(() => setLang('th'));

/** Every text a position shows on the play screen. */
function texts(s: GameState): string[] {
  const out = [...s.log.map((l) => l.text), s.winReason, waitingText(s, {})];
  if (s.pending) {
    const r = s.pending.request;
    out.push(r.prompt, ...r.options.map((o) => o.label));
  } else if (s.phase === 'main' && s.winner === null) {
    const p = s.current;
    for (const c of s.players[p].hand) out.push(whyNotPlayable(s, c) ?? '');
    out.push(...legalActions(s).map((a) => describeAction(s, a)));
    out.push(...turnUses(s).flatMap((u) => [u.label, u.title]));
    for (const sl of [s.players[p].active, ...s.players[p].bench]) {
      const info = sl && slotInfo(s, sl.uid);
      if (info) out.push(...info.marks, ...info.conditions.flatMap((c) => [c.name, c.does]));
    }
    const legal = legalActions(s);
    const card = s.players[p].hand[0];
    const bars = [
      actionBar({ s, legal, myTurn: true }),
      actionBar({ s, legal, myTurn: true, confirmEnd: true, attacksLeft: ['x'] }),
      ...(card === undefined ? [] : [actionBar({ s, legal, myTurn: true, held: { name: 'x', actions: handActions(s).get(card), why: whyNotPlayable(s, card) } })]),
    ];
    for (const bar of bars) out.push(bar.text ?? '', bar.title ?? '', ...bar.buttons.map((b) => b.label));
  }
  return out;
}

describe('i18n paths', () => {
  it('maps pages between the languages', () => {
    expect(localePath('en', '/')).toBe('/en/');
    expect(localePath('en', '/play/?opp=x')).toBe('/en/play/?opp=x');
    expect(localePath('th', '/en/decks/')).toBe('/decks/');
    expect(stripLang('/en/review/')).toBe('/review/');
    expect(langOfPath('/en/')).toBe('en');
    expect(langOfPath('/en')).toBe('en');
    expect(langOfPath('/play/')).toBe('th');
    expect(langOfPath('/entry/')).toBe('th');
  });
});

describe('the English game', () => {
  it('shows no Thai in random games across every deck', () => {
    setLang('en');
    const found: string[] = [];
    DECK_SLUGS.forEach((slug, i) => {
      const other = DECK_SLUGS[(i + 3) % DECK_SLUGS.length]!;
      const rand = makeRand(500 + i);
      let s = createGame({ seed: 500 + i, decks: [deck(slug), deck(other)], names: [youName(), botName()] });
      for (let n = 0; n < 400 && s.winner === null; n++) {
        for (const t of texts(s)) if (THAI.test(t)) found.push(t);
        s = apply(s, randomAction(s, rand));
      }
      for (const t of texts(s)) if (THAI.test(t)) found.push(t);
    });
    expect([...new Set(found)].slice(0, 10)).toEqual([]);
  }, 120_000);

  it("explains the bot's moves in English", () => {
    setLang('en');
    const plan = planFor('dragapult-ex');
    const rand = makeRand(7);
    let s = createGame({ seed: 7, decks: [deck('dragapult-ex'), deck('basic-box')], names: [youName(), botName()] });
    const found: string[] = [];
    for (let n = 0; n < 160 && s.winner === null; n++) {
      if (!s.pending && s.phase === 'main' && s.current === 0) {
        for (const a of legalActions(s).slice(0, 4)) {
          const e = explainAction(s, 0, { action: a }, plan);
          for (const t of [e.title, e.why, ...e.facts]) if (THAI.test(t)) found.push(t);
        }
        const e = explainEnd(s, 0);
        for (const t of [e.title, e.why, ...e.facts]) if (THAI.test(t)) found.push(t);
      }
      s = apply(s, randomAction(s, rand));
    }
    expect([...new Set(found)].slice(0, 10)).toEqual([]);
  }, 120_000);

  it('the bot plays the same moves in Thai and in English', () => {
    const play = (lang: 'th' | 'en', i: number) => {
      setLang(lang);
      const a = DECK_SLUGS[i % DECK_SLUGS.length]!;
      const b = DECK_SLUGS[(i + 2) % DECK_SLUGS.length]!;
      return playGame({
        seed: 40 + i,
        decks: [deck(a), deck(b)],
        bots: [makeBot(planFor(a), { seed: 1 }), makeBot(planFor(b), { seed: 2 })],
        record: true,
      }).history;
    };
    for (let i = 0; i < 6; i++) expect(play('en', i)).toEqual(play('th', i));
  }, 120_000);

  it('the play screen reads the English log: coin flips and the bot turn recap', () => {
    setLang('en');
    const s = createGame({ seed: 3, decks: [deck(DECK_SLUGS[0]!), deck(DECK_SLUGS[1]!)], names: [youName(), botName()] });
    expect(s.log.some((l) => /^Coin flip: (heads|tails)$/.test(l.text))).toBe(true);
    expect(animEvents(null, s).filter((e) => e.t === 'coin')).toHaveLength(1);
    const rand = makeRand(3);
    let g = s;
    while (g.winner === null && g.turn < 4) g = apply(g, randomAction(g, rand));
    const recap = turnRecap(g, 2);
    expect(recap.some((l) => l.startsWith('— Turn'))).toBe(false);
  });
});
