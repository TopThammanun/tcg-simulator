// apply(state, action) -> new state, and legalActions(state). The public engine API.
import { tx, verb } from '../i18n';
import { Ctx, GameOver, NeedChoice } from './ctx';
import { def, isBasicPokemon, pokemon } from './db';
import { performAttack } from './combat';
import { ABILITIES, activatedAbilities, offerTrigger } from './effects/abilities';
import { discardStadium, putOnBench } from './effects/common';
import { ON_ATTACH } from './effects/energy';
import { evolveSlot, TRAINERS } from './effects/trainers';
import {
  benchLimit,
  canRetreat,
  checkKOs,
  cleanConditions,
  endTurn,
  retreatCost,
  slotsWithAbility,
  stadiumIs,
  startTurn,
  switchIn,
  trimBenches,
  usableAttacks,
} from './rules';
import { cloneState, keyOf, knownTopCards, mustSlot, newState, opp, rulesBefore, slotsOf, topDef } from './state';
import type { Action, CardId, DealScript, DeckSpec, GameState, PlayerId, Rules, Slot } from './types';

export function createGame(opts: {
  seed: number;
  decks: [DeckSpec, DeckSpec];
  names?: [string, string];
  rules?: Partial<Rules>;
  quiet?: boolean;
  /** A transcribed game's deal (types.ts DealScript): its shuffles and coins instead of the seed's. */
  script?: DealScript;
}): GameState {
  const s = newState(opts);
  s.quiet = !!opts.quiet;
  return apply(s, { t: 'setup' }, { trusted: true });
}

/** The player who must act now: the one answering a pending choice, else the current player. */
export function actor(s: GameState): PlayerId {
  return s.pending ? s.pending.request.player : s.current;
}

export function apply(s: GameState, action: Action, opts: { trusted?: boolean } = {}): GameState {
  if (s.winner !== null) throw new Error('game is over');
  if (action.t === 'choose') {
    if (!s.pending) throw new Error('no choice is pending');
    const { base, action: inner, answers } = s.pending;
    // A copy: the state keeps the answers (pending.answers) and must not share the caller's array (the play
    // screen's picks are a Svelte $state proxy, which can't be posted to the bot's worker or saved).
    return run(base, inner, [...answers, [...action.picks]]);
  }
  if (s.pending) throw new Error('a choice is pending; answer it with { t: "choose" }');
  if (!opts.trusted && action.t !== 'setup' && !isLegal(s, action)) {
    throw new Error(`illegal action ${JSON.stringify(action)}`);
  }
  return run(s, action, []);
}

function run(base: GameState, action: Action, answers: number[][]): GameState {
  const s = cloneState(base);
  s.pending = null;
  const ctx = new Ctx(s, answers);
  try {
    execute(ctx, action);
  } catch (e) {
    if (e instanceof NeedChoice) {
      s.pending = { base, action, answers, request: e.request };
      return s;
    }
    if (!(e instanceof GameOver)) throw e;
  }
  // A revealed card that left the hand is no longer known to be there.
  for (const ps of s.players) if (ps.revealed?.length) ps.revealed = ps.revealed.filter((c) => ps.hand.includes(c));
  s.steps = base.steps + 1;
  return s;
}

// ---------- legal actions ----------

export function legalActions(s: GameState): Action[] {
  if (s.winner !== null || s.pending || s.phase !== 'main') return [];
  const p = s.current;
  const ps = s.players[p];
  const out: Action[] = [];
  const seen = new Set<string>();
  const add = (a: Action, dedupeKey: string) => {
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push(a);
  };
  const mine = slotsOf(ps);
  const aceBlocked = slotsWithAbility(s, opp(p), 'ACE Nullifier').some((sl) => sl.tool !== null);

  for (const c of ps.hand) {
    const k = keyOf(s, c);
    const d = def(k);
    if (d.category === 'pokemon') {
      if (d.stage === 'Basic' || excitedDive(s, p, k)) {
        if (ps.bench.length < benchLimit(s, p)) add({ t: 'bench', card: c }, `bench:${k}`);
      } else if (s.turn > 2) {
        for (const sl of mine) {
          if (canEvolve(s, sl, k)) add({ t: 'evolve', card: c, target: sl.uid }, `evolve:${k}:${sl.uid}`);
        }
      }
    } else if (d.category === 'energy') {
      if (ps.energyAttached || (aceBlocked && d.aceSpec)) continue;
      for (const sl of mine) add({ t: 'energy', card: c, target: sl.uid }, `energy:${k}:${sl.uid}`);
    } else {
      if (aceBlocked && d.aceSpec) continue;
      if (d.trainerType === 'Tool') {
        for (const sl of mine) if (sl.tool === null) add({ t: 'tool', card: c, target: sl.uid }, `tool:${k}:${sl.uid}`);
        continue;
      }
      if (d.trainerType === 'Item' && ps.itemLockTurn === s.turn) continue;
      if (d.trainerType === 'Supporter' && (ps.supporterPlayed || s.turn === 1)) continue;
      if (d.trainerType === 'Stadium' && (ps.stadiumPlayed || (s.stadium && keyOf(s, s.stadium.card) === k))) continue;
      const impl = TRAINERS[k];
      if (impl?.canPlay && !impl.canPlay(s, p, c)) continue;
      add({ t: 'trainer', card: c }, `trainer:${k}`);
    }
  }

  for (const sl of mine) {
    for (const name of activatedAbilities(s, p, sl)) add({ t: 'ability', slot: sl.uid, name }, `ability:${sl.uid}:${name}`);
  }
  if (stadiumIs(s, 'academy-at-night') && !ps.namedUsed.includes('Academy at Night') && ps.hand.length > 0) {
    out.push({ t: 'stadium' });
  }
  if (canRetreat(s, p)) for (const b of ps.bench) out.push({ t: 'retreat', to: b.uid });
  for (const { attack, from } of usableAttacks(s, p)) {
    out.push(from === undefined ? { t: 'attack', name: attack.name } : { t: 'attack', name: attack.name, from });
  }
  out.push({ t: 'end' });
  return out;
}

function canEvolve(s: GameState, sl: Slot, into: string): boolean {
  const d = pokemon(into);
  const top = topDef(s, sl);
  if (!d.evolvesFrom || top.name !== d.evolvesFrom) return false;
  // Forest of Vitality: a {G} Pokémon can evolve into a {G} Pokémon the turn it was played (or evolved).
  if (stadiumIs(s, 'forest-of-vitality') && d.types.includes('Grass') && top.types.includes('Grass')) return true;
  return sl.enteredTurn !== s.turn && sl.evolvedTurn !== s.turn;
}

/** Talonflame ex's Excited Dive: from the hand onto the Bench while a {C} Mega Evolution Pokémon ex is in play. */
function excitedDive(s: GameState, p: PlayerId, key: string): boolean {
  const d = pokemon(key);
  if (!d.abilities.some((a) => a.name === 'Excited Dive')) return false;
  return slotsOf(s.players[p]).some((sl) => {
    const t = topDef(s, sl);
    return (t.subtypes.includes('MEGA') || t.name.startsWith('Mega ')) && t.types.includes('Colorless');
  });
}

/**
 * Why the current player's hand card can't be played now, in a few words for the play screen; null when it can
 * (exactly when legalActions() has an action for a card of its name). Follows legalActions() check by check.
 */
export function whyNotPlayable(s: GameState, card: CardId): string | null {
  if (s.winner !== null || s.phase !== 'main') return tx('เกมยังไม่เริ่มหรือจบแล้ว', "The game hasn't started or is over");
  if (s.pending) return tx('ตอบตัวเลือกที่ค้างอยู่ให้เสร็จก่อน', 'Answer the open choice first');
  const p = s.current;
  const ps = s.players[p];
  if (!ps.hand.includes(card)) return tx('การ์ดไม่ได้อยู่ในมือ', 'The card is not in your hand');
  const k = keyOf(s, card);
  const d = def(k);
  const mine = slotsOf(ps);
  const aceBlocked = slotsWithAbility(s, opp(p), 'ACE Nullifier').some((sl) => sl.tool !== null);
  if (d.category === 'pokemon') {
    if (d.stage === 'Basic' || excitedDive(s, p, k)) {
      return ps.bench.length < benchLimit(s, p) ? null : tx(`Bench เต็มแล้ว (${benchLimit(s, p)} ตัว)`, `Your Bench is full (${benchLimit(s, p)})`);
    }
    if (s.turn <= 2) return tx('เทิร์นแรกของแต่ละฝั่งยังวิวัฒนาการไม่ได้', 'No one can evolve on their first turn');
    if (mine.some((sl) => canEvolve(s, sl, k))) return null;
    const from = pokemon(k).evolvesFrom;
    if (!from) return tx('ลงจากมือตรง ๆ ไม่ได้', "It can't be played straight from your hand");
    return mine.some((sl) => topDef(s, sl).name === from)
      ? tx(`${from} เพิ่งลงสนามหรือเพิ่งวิวัฒนาการในเทิร์นนี้ รอวิวัฒนาการเทิร์นหน้า`, `${from} came into play or evolved this turn (it can evolve next turn)`)
      : tx(`ต้องมี ${from} ในสนามก่อน`, `You need ${from} in play first`);
  }
  if (aceBlocked && d.aceSpec) return tx('ใช้การ์ด ACE SPEC ไม่ได้ เพราะติด ACE Nullifier ของคู่แข่ง', "Your opponent's ACE Nullifier blocks ACE SPEC cards");
  if (d.category === 'energy') return ps.energyAttached ? tx('ติดพลังงานจากมือไปแล้วเทิร์นนี้ (เทิร์นละ 1 ใบ)', 'You already attached an Energy from your hand this turn (1 per turn)') : null;
  if (d.trainerType === 'Tool') return mine.some((sl) => sl.tool === null) ? null : tx('Pokémon ทุกตัวติด Tool อยู่แล้ว', 'All your Pokémon already have a Tool');
  if (d.trainerType === 'Item' && ps.itemLockTurn === s.turn) return tx('เทิร์นนี้ใช้ Item ไม่ได้', "You can't play Items this turn");
  if (d.trainerType === 'Supporter') {
    if (ps.supporterPlayed) return tx('เล่น Supporter ไปแล้วเทิร์นนี้ (เทิร์นละ 1 ใบ)', 'You already played a Supporter this turn (1 per turn)');
    if (s.turn === 1) return tx('ผู้เล่นที่ได้เริ่มก่อน เล่น Supporter ในเทิร์นแรกไม่ได้', "The player going first can't play a Supporter on their first turn");
  }
  if (d.trainerType === 'Stadium') {
    if (ps.stadiumPlayed) return tx('เล่น Stadium ไปแล้วเทิร์นนี้', 'You already played a Stadium this turn');
    if (s.stadium && keyOf(s, s.stadium.card) === k) return tx('Stadium ใบนี้อยู่ในสนามแล้ว', 'This Stadium is already in play');
  }
  const impl = TRAINERS[k];
  if (impl?.canPlay && !impl.canPlay(s, p, card)) return TRAINER_NEEDS[k]?.(s, p) ?? tx('เงื่อนไขบนการ์ดยังไม่ครบ', "The card's conditions aren't met");
  return null;
}

/** What each Trainer with a condition needs, said when it isn't met (tests/ui/why.test.ts: every one has a line). */
export const TRAINER_NEEDS: Record<string, (s: GameState, p: PlayerId) => string> = {
  'ultra-ball': () => tx('ต้องมีการ์ดใบอื่นในมือให้ทิ้ง 2 ใบ', 'You need 2 other cards in your hand to discard'),
  'buddy-buddy-poffin': () => tx('Bench เต็มแล้ว', 'Your Bench is full'),
  'night-stretcher': () => tx('ไม่มี Pokémon หรือพลังงานพื้นฐานในกองทิ้ง', 'No Pokémon or Basic Energy in your discard pile'),
  'energy-switch': () => tx('ต้องมี Pokémon 2 ตัวขึ้นไป และมีพลังงานพื้นฐานติดอยู่ให้ย้าย', 'You need 2 or more Pokémon and a Basic Energy attached to move'),
  switch: () => tx('ไม่มี Pokémon บน Bench ให้สลับ', 'No Benched Pokémon to switch with'),
  'crushing-hammer': () => tx('Pokémon ของคู่แข่งไม่มีพลังงานติดอยู่', "Your opponent's Pokémon have no Energy attached"),
  'enhanced-hammer': () => tx('Pokémon ของคู่แข่งไม่มีพลังงานพิเศษ', "Your opponent's Pokémon have no Special Energy"),
  'rare-candy': (s) =>
    s.turn <= 2
      ? tx('ใช้ในเทิร์นแรกของแต่ละฝั่งไม่ได้', "It can't be used on anyone's first turn")
      : tx('ไม่มี Basic ในสนามที่มีร่าง Stage 2 ของมันอยู่ในมือ', 'No Basic in play whose Stage 2 is in your hand'),
  'tool-scrapper': () => tx('ไม่มี Tool ติดอยู่ในสนาม', 'No Tools attached in play'),
  'sacred-ash': () => tx('ไม่มี Pokémon ในกองทิ้ง', 'No Pokémon in your discard pile'),
  'secret-box': () => tx('ต้องมีการ์ดใบอื่นในมือให้ทิ้ง 3 ใบ', 'You need 3 other cards in your hand to discard'),
  'unfair-stamp': () => tx('ใช้ได้เฉพาะเทิร์นถัดจากที่ Pokémon ของคุณโดน KO', 'Only during a turn right after one of your Pokémon was Knocked Out'),
  'special-red-card': () => tx('ใช้ได้เมื่อคู่แข่งเหลือ Prize 3 ใบหรือน้อยกว่า', 'Only when your opponent has 3 or fewer Prize cards left'),
  'wondrous-patch': () =>
    tx('ต้องมี Psychic Energy ในกองทิ้ง และ Pokémon ประเภท Psychic บน Bench', 'You need a Psychic Energy in your discard pile and a Psychic Pokémon on your Bench'),
  'ns-pp-up': () => tx("ต้องมีพลังงานพื้นฐานในกองทิ้ง และ N's Pokémon บน Bench", "You need a Basic Energy in your discard pile and an N's Pokémon on your Bench"),
  'glass-trumpet': () =>
    tx(
      'ต้องมี Tera Pokémon ในสนาม พลังงานพื้นฐานในกองทิ้ง และ Pokémon ประเภท Colorless บน Bench',
      'You need a Tera Pokémon in play, a Basic Energy in your discard pile and a Colorless Pokémon on your Bench',
    ),
  'bosss-orders': () => tx('คู่แข่งไม่มี Pokémon บน Bench', 'Your opponent has no Benched Pokémon'),
  'janines-secret-art': () => tx('ไม่มี Pokémon ประเภท Darkness', 'You have no Darkness Pokémon'),
  'rosas-encouragement': () =>
    tx(
      'ต้องเหลือ Prize มากกว่าคู่แข่ง มี Stage 2 ในสนาม และพลังงานพื้นฐานในกองทิ้ง',
      'You need more Prize cards left than your opponent, a Stage 2 in play and a Basic Energy in your discard pile',
    ),
  'gladions-final-battle': () => tx('ต้องเป็นการ์ดใบเดียวที่เหลือในมือ', 'It must be the only card left in your hand'),
  'lanas-aid': () => tx('ไม่มี Pokémon (ที่ไม่มี Rule Box) หรือพลังงานพื้นฐานในกองทิ้ง', 'No Pokémon without a Rule Box or Basic Energy in your discard pile'),
  surfer: () => tx('ไม่มี Pokémon บน Bench ให้สลับ', 'No Benched Pokémon to switch with'),
};

/** Same as one of legalActions(), treating copies of the same card as equal. */
export function isLegal(s: GameState, a: Action): boolean {
  const norm = (x: Action) => JSON.stringify('card' in x ? { ...x, card: keyOf(s, x.card) } : x);
  const want = norm(a);
  return legalActions(s).some((x) => norm(x) === want);
}

// ---------- execution ----------

function execute(ctx: Ctx, action: Action): void {
  const s = ctx.s;
  const p = s.current;
  const ps = ctx.ps(p);
  // Cards played from the hand, in public: what the opponent saw this turn (PlayerState.played).
  if (action.t === 'bench' || action.t === 'evolve' || action.t === 'energy' || action.t === 'tool' || action.t === 'trainer') (ps.played ??= []).push(action.card);
  switch (action.t) {
    case 'setup':
      setup(ctx);
      return;
    case 'bench': {
      const slot = putOnBench(ctx, p, action.card);
      offerTrigger(ctx, p, slot, 'bench');
      break;
    }
    case 'evolve': {
      const { slot } = mustSlot(s, action.target);
      ctx.take(p, action.card);
      evolveSlot(ctx, slot, action.card);
      ctx.log(tx(`${ctx.who(p)} วิวัฒนาการเป็น ${ctx.cardName(action.card)}`, `${ctx.who(p)} ${verb(ctx.who(p), 'evolve')} into ${ctx.cardName(action.card)}`), p);
      offerTrigger(ctx, p, slot, 'evolve');
      break;
    }
    case 'energy': {
      if (ps.energyAttached) throw new Error('already attached Energy this turn');
      const { slot } = mustSlot(s, action.target);
      ps.energyAttached = true;
      ctx.take(p, action.card);
      slot.energy.push(action.card);
      ctx.log(
        tx(
          `${ctx.who(p)} ติด ${ctx.cardName(action.card)} ให้ ${topDef(s, slot).name}`,
          `${ctx.who(p)} ${verb(ctx.who(p), 'attach', 'attaches')} ${ctx.cardName(action.card)} to ${topDef(s, slot).name}`,
        ),
        p,
      );
      ON_ATTACH[keyOf(s, action.card)]?.(ctx, p, action.card, slot);
      break;
    }
    case 'tool': {
      const { slot } = mustSlot(s, action.target);
      if (slot.tool !== null) throw new Error('Pokémon already has a Tool');
      ctx.take(p, action.card);
      slot.tool = action.card;
      ctx.log(
        tx(
          `${ctx.who(p)} ติด ${ctx.cardName(action.card)} ให้ ${topDef(s, slot).name}`,
          `${ctx.who(p)} ${verb(ctx.who(p), 'attach', 'attaches')} ${ctx.cardName(action.card)} to ${topDef(s, slot).name}`,
        ),
        p,
      );
      break;
    }
    case 'trainer':
      playTrainer(ctx, p, action.card);
      break;
    case 'ability': {
      const { slot } = mustSlot(s, action.slot);
      const impl = ABILITIES[action.name];
      if (!impl) throw new Error(`no ability ${action.name}`);
      slot.usedAbility[action.name] = s.turn;
      if (impl.shared) ps.namedUsed.push(impl.shared);
      ctx.log(
        tx(`${ctx.who(p)} ใช้ Ability ${action.name} (${topDef(s, slot).name})`, `${ctx.who(p)} ${verb(ctx.who(p), 'use')} Ability ${action.name} (${topDef(s, slot).name})`),
        p,
      );
      impl.use(ctx, p, slot);
      break;
    }
    case 'stadium': {
      ps.namedUsed.push('Academy at Night');
      const [c] = ctx.pickCards(p, ps.hand, { purpose: 'discard', prompt: tx('Academy at Night: วางการ์ดจากมือไว้บนเด็ค', 'Academy at Night: put a card from your hand on top of your deck'), source: 'academy-at-night' });
      ctx.take(p, c!);
      const known = knownTopCards(ps);
      ps.deck.unshift(c!);
      ps.knownTop = [c!, ...known];
      ctx.log(tx(`${ctx.who(p)} วางการ์ด 1 ใบไว้บนเด็ค`, `${ctx.who(p)} ${verb(ctx.who(p), 'put')} a card on top of the deck`), p);
      break;
    }
    case 'retreat': {
      const active = ps.active!;
      const cost = retreatCost(s, p, active);
      const paid = ctx.pickCards(p, active.energy, { purpose: 'discard-cost', prompt: tx(`ถอยตัว: ทิ้งพลังงาน ${cost} ใบ`, `Retreat: discard ${cost} Energy`), min: cost, max: cost });
      for (const e of paid) {
        active.energy = active.energy.filter((x) => x !== e);
        ps.discard.push(e);
      }
      ps.retreated = true;
      ctx.log(tx(`${ctx.who(p)} ถอย ${topDef(s, active).name}`, `${ctx.who(p)} ${verb(ctx.who(p), 'retreat')} ${topDef(s, active).name}`), p);
      switchIn(ctx, p, mustSlot(s, action.to).slot);
      break;
    }
    case 'attack':
      performAttack(ctx, p, action.name, action.from);
      return;
    case 'end':
      ctx.log(tx(`${ctx.who(p)} จบเทิร์น`, `${ctx.who(p)} ${verb(ctx.who(p), 'end')} the turn`), p);
      endTurn(ctx);
      return;
    case 'choose':
      throw new Error('choose is handled by apply');
  }
  afterAction(ctx);
}

/** Tidy up after any action that doesn't end the turn. */
function afterAction(ctx: Ctx): void {
  cleanConditions(ctx.s);
  checkKOs(ctx);
  trimBenches(ctx, [ctx.s.current, opp(ctx.s.current)]);
}

function playTrainer(ctx: Ctx, p: PlayerId, card: CardId): void {
  const s = ctx.s;
  const ps = ctx.ps(p);
  const k = keyOf(s, card);
  const d = def(k);
  if (d.category !== 'trainer') throw new Error(`${k} is not a Trainer`);
  ctx.take(p, card);
  ctx.log(tx(`${ctx.who(p)} ใช้ ${d.name}`, `${ctx.who(p)} ${verb(ctx.who(p), 'play')} ${d.name}`), p);

  if (d.trainerType === 'Stadium') {
    if (ps.stadiumPlayed) throw new Error('already played a Stadium this turn');
    ps.stadiumPlayed = true;
    discardStadium(ctx);
    s.stadium = { card, owner: p };
    cleanConditions(s);
    return;
  }
  if (d.trainerType === 'Supporter') {
    if (ps.supporterPlayed) throw new Error('already played a Supporter this turn');
    ps.supporterPlayed = true;
  }
  // Discarded up front so the card is never "nowhere" while a choice is pending.
  // No effect in the card pool looks for Trainer cards in the discard pile.
  ps.discard.push(card);
  TRAINERS[k]?.play(ctx, p, card);
}

// ---------- setup ----------

function setup(ctx: Ctx): void {
  const s = ctx.s;
  const winner: PlayerId = ctx.flip() ? 0 : 1;
  const won = ctx.who(winner);
  const goFirst =
    ctx.pickOption(
      winner,
      tx(`${won} ชนะการโยนเหรียญ จะเริ่มก่อนหรือเริ่มหลัง?`, `${won} ${verb(won, 'win')} the coin flip: go first or second?`),
      [tx('เริ่มก่อน', 'Go first'), tx('เริ่มหลัง', 'Go second')],
      undefined,
      'first',
    ) === 0;
  s.first = goFirst ? winner : opp(winner);
  ctx.log(tx(`${ctx.who(s.first)} ได้เริ่มก่อน`, `${ctx.who(s.first)} ${verb(ctx.who(s.first), 'go', 'goes')} first`));

  for (const p of [0, 1] as const) {
    const ps = ctx.ps(p);
    if (!ps.deck.some((c) => isBasicPokemon(keyOf(s, c)))) throw new Error(`${s.names[p]} has no Basic Pokémon`);
    ctx.shuffle(p);
    ps.hand.push(...ps.deck.splice(0, 7));
    while (!ps.hand.some((c) => isBasicPokemon(keyOf(s, c)))) {
      ps.mulligans += 1;
      ctx.log(tx(`${ctx.who(p)} mulligan (ครั้งที่ ${ps.mulligans})`, `${ctx.who(p)} ${verb(ctx.who(p), 'mulligan')} (${ps.mulligans})`), p);
      ps.deck.push(...ps.hand.splice(0));
      ctx.shuffle(p);
      ps.hand.push(...ps.deck.splice(0, 7));
    }
  }
  const drawsFirst = rulesBefore(s, 2);
  if (drawsFirst) for (const p of [0, 1] as const) mulliganDraw(ctx, p);

  for (const p of [s.first, opp(s.first)] as const) {
    const ps = ctx.ps(p);
    const basics = () => ps.hand.filter((c) => isBasicPokemon(keyOf(s, c)));
    const [a] = ctx.pickCards(p, basics(), { purpose: 'setup-active', prompt: tx('เลือก Pokémon ตัวหลัก', 'Choose your Active Pokémon'), min: 1, max: 1 });
    ctx.take(p, a!);
    ps.active = ctx.newSlot(a!);
    benchFrom(ctx, p, basics(), tx('เลือก Pokémon ลง Bench (ไม่เกิน 5)', 'Choose Pokémon for your Bench (up to 5)'));
  }
  // The extra cards for the opponent's mulligans come once both sides have put their Pokémon down; Basics
  // drawn that way may still go onto the Bench.
  if (!drawsFirst) {
    for (const p of [s.first, opp(s.first)] as const) {
      const drawn = mulliganDraw(ctx, p);
      const basics = drawn.filter((c) => isBasicPokemon(keyOf(s, c)));
      if (basics.length) benchFrom(ctx, p, basics, tx('Basic ที่จั่วเพิ่มเพราะ mulligan: จะลง Bench ตัวไหน', 'Basics drawn for the mulligan: which go onto your Bench?'), 'mulligan');
    }
  }
  for (const p of [0, 1] as const) {
    const ps = ctx.ps(p);
    ps.prizes = ps.deck.splice(0, 6);
    ctx.log(
      tx(`${ctx.who(p)}: ${topDef(s, ps.active!).name} เป็นตัวหลัก, Bench ${ps.bench.length} ตัว`, `${ctx.who(p)}: ${topDef(s, ps.active!).name} Active, ${ps.bench.length} on the Bench`),
      p,
    );
  }
  s.phase = 'main';
  startTurn(ctx, s.first);
}

/** p draws up to one card for each mulligan the opponent took, as many as p chooses; the cards drawn. */
function mulliganDraw(ctx: Ctx, p: PlayerId): CardId[] {
  const m = ctx.ps(opp(p)).mulligans;
  if (m === 0) return [];
  const labels = Array.from({ length: m + 1 }, (_, i) => tx(`${i} ใบ`, `${i} ${i === 1 ? 'card' : 'cards'}`));
  const who = ctx.who(opp(p));
  const prompt = tx(`${who} mulligan ${m} ครั้ง จะจั่วเพิ่มกี่ใบ?`, `${who} took ${m} ${m === 1 ? 'mulligan' : 'mulligans'}: how many extra cards to draw?`);
  const n = ctx.pickOption(p, prompt, labels, undefined, 'mulligan-draw');
  const ps = ctx.ps(p);
  const drawn = ps.deck.slice(0, n);
  if (n > 0) ctx.draw(p, n);
  return drawn;
}

/** Setup: p puts any of `basics` (cards in hand) onto the Bench, up to its room. */
function benchFrom(ctx: Ctx, p: PlayerId, basics: CardId[], prompt: string, hint?: string): void {
  const ps = ctx.ps(p);
  const room = benchLimit(ctx.s, p) - ps.bench.length;
  if (room <= 0) return;
  const picked = ctx.pickCards(p, basics, { purpose: 'setup-bench', prompt, hint, min: 0, max: room });
  for (const c of picked) {
    ctx.take(p, c);
    ps.bench.push(ctx.newSlot(c));
  }
}
