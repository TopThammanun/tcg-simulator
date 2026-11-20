// apply(state, action) -> new state, and legalActions(state). The public engine API.
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
import { cloneState, keyOf, knownTopCards, mustSlot, newState, opp, slotsOf, topDef } from './state';
import type { Action, CardId, DeckSpec, GameState, PlayerId, Rules, Slot } from './types';

export function createGame(opts: {
  seed: number;
  decks: [DeckSpec, DeckSpec];
  names?: [string, string];
  rules?: Partial<Rules>;
  quiet?: boolean;
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
      ctx.log(`${ctx.who(p)} วิวัฒนาการเป็น ${ctx.cardName(action.card)}`, p);
      offerTrigger(ctx, p, slot, 'evolve');
      break;
    }
    case 'energy': {
      if (ps.energyAttached) throw new Error('already attached Energy this turn');
      const { slot } = mustSlot(s, action.target);
      ps.energyAttached = true;
      ctx.take(p, action.card);
      slot.energy.push(action.card);
      ctx.log(`${ctx.who(p)} ติด ${ctx.cardName(action.card)} ให้ ${topDef(s, slot).name}`, p);
      ON_ATTACH[keyOf(s, action.card)]?.(ctx, p, action.card, slot);
      break;
    }
    case 'tool': {
      const { slot } = mustSlot(s, action.target);
      if (slot.tool !== null) throw new Error('Pokémon already has a Tool');
      ctx.take(p, action.card);
      slot.tool = action.card;
      ctx.log(`${ctx.who(p)} ติด ${ctx.cardName(action.card)} ให้ ${topDef(s, slot).name}`, p);
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
      ctx.log(`${ctx.who(p)} ใช้ Ability ${action.name} (${topDef(s, slot).name})`, p);
      impl.use(ctx, p, slot);
      break;
    }
    case 'stadium': {
      ps.namedUsed.push('Academy at Night');
      const [c] = ctx.pickCards(p, ps.hand, { purpose: 'discard', prompt: 'Academy at Night: วางการ์ดจากมือไว้บนเด็ค', source: 'academy-at-night' });
      ctx.take(p, c!);
      const known = knownTopCards(ps);
      ps.deck.unshift(c!);
      ps.knownTop = [c!, ...known];
      ctx.log(`${ctx.who(p)} วางการ์ด 1 ใบไว้บนเด็ค`, p);
      break;
    }
    case 'retreat': {
      const active = ps.active!;
      const cost = retreatCost(s, p, active);
      const paid = ctx.pickCards(p, active.energy, { purpose: 'discard-cost', prompt: `ถอยตัว: ทิ้งพลังงาน ${cost} ใบ`, min: cost, max: cost });
      for (const e of paid) {
        active.energy = active.energy.filter((x) => x !== e);
        ps.discard.push(e);
      }
      ps.retreated = true;
      ctx.log(`${ctx.who(p)} ถอย ${topDef(s, active).name}`, p);
      switchIn(ctx, p, mustSlot(s, action.to).slot);
      break;
    }
    case 'attack':
      performAttack(ctx, p, action.name, action.from);
      return;
    case 'end':
      ctx.log(`${ctx.who(p)} จบเทิร์น`, p);
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
  ctx.log(`${ctx.who(p)} ใช้ ${d.name}`, p);

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
  const goFirst = ctx.pickOption(winner, `${ctx.who(winner)} ชนะการโยนเหรียญ: ไปก่อนหรือไปหลัง?`, ['ไปก่อน', 'ไปหลัง'], undefined, 'first') === 0;
  s.first = goFirst ? winner : opp(winner);
  ctx.log(`${ctx.who(s.first)} ได้เล่นก่อน`);

  for (const p of [0, 1] as const) {
    const ps = ctx.ps(p);
    if (!ps.deck.some((c) => isBasicPokemon(keyOf(s, c)))) throw new Error(`${s.names[p]} has no Basic Pokémon`);
    ctx.shuffle(p);
    ps.hand.push(...ps.deck.splice(0, 7));
    while (!ps.hand.some((c) => isBasicPokemon(keyOf(s, c)))) {
      ps.mulligans += 1;
      ctx.log(`${ctx.who(p)} mulligan (ครั้งที่ ${ps.mulligans})`, p);
      ps.deck.push(...ps.hand.splice(0));
      ctx.shuffle(p);
      ps.hand.push(...ps.deck.splice(0, 7));
    }
  }
  for (const p of [0, 1] as const) {
    const m = ctx.ps(opp(p)).mulligans;
    if (m === 0) continue;
    const labels = Array.from({ length: m + 1 }, (_, i) => `${i} ใบ`);
    const n = ctx.pickOption(p, `${ctx.who(opp(p))} mulligan ${m} ครั้ง: จั่วเพิ่มกี่ใบ?`, labels, undefined, 'mulligan-draw');
    if (n > 0) ctx.draw(p, n);
  }

  for (const p of [s.first, opp(s.first)] as const) {
    const ps = ctx.ps(p);
    const basics = () => ps.hand.filter((c) => isBasicPokemon(keyOf(s, c)));
    const [a] = ctx.pickCards(p, basics(), { purpose: 'setup-active', prompt: 'เลือก Pokémon ตัวหลัก', min: 1, max: 1 });
    ctx.take(p, a!);
    ps.active = ctx.newSlot(a!);
    const bench = ctx.pickCards(p, basics(), { purpose: 'setup-bench', prompt: 'เลือก Pokémon ลง Bench (ไม่เกิน 5)', min: 0, max: 5 });
    for (const c of bench) {
      ctx.take(p, c);
      ps.bench.push(ctx.newSlot(c));
    }
  }
  for (const p of [0, 1] as const) {
    const ps = ctx.ps(p);
    ps.prizes = ps.deck.splice(0, 6);
    ctx.log(`${ctx.who(p)}: ${topDef(s, ps.active!).name} เป็นตัวหลัก, Bench ${ps.bench.length} ตัว`, p);
  }
  s.phase = 'main';
  startTurn(ctx, s.first);
}
