// Trainer card effects. Stadiums and Pokémon Tools are put into play by the engine (actions.ts) and act
// through the rules; only Stadiums with a "use" (Academy at Night) appear in actions.
import { tx, verb } from '../../i18n';
import { uniqueByKey, type Ctx } from '../ctx';
import {
  basicBelow,
  energyCard,
  hasRuleBox,
  isBasicEnergy,
  isBasicPokemon,
  isEnergy,
  isEx,
  isNsPokemon,
  isPokemon,
  isSpecialEnergy,
  isTrainerType,
  pokemon,
} from '../db';
import { addCondition, benchLimit, chooseSwitch, isActive, switchIn } from '../rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../state';
import type { CardId, GameState, PlayerId, Slot } from '../types';
import { attachFrom, benchSpace, putOnBench, shuffleHandIn } from './common';
import { offerTrigger } from './abilities';

export interface TrainerImpl {
  canPlay?(s: GameState, p: PlayerId, card: CardId): boolean;
  play(ctx: Ctx, p: PlayerId, card: CardId): void;
}

const key = (s: GameState, c: CardId) => keyOf(s, c);
const handOthers = (s: GameState, p: PlayerId, card: CardId) => s.players[p].hand.filter((c) => c !== card);
const discardWhere = (s: GameState, p: PlayerId, f: (k: string) => boolean) =>
  s.players[p].discard.filter((c) => f(keyOf(s, c)));
const basicEnergyOfType = (type: string) => (k: string) => isBasicEnergy(k) && energyCard(k)!.provides === type;

function searchToHand(ctx: Ctx, p: PlayerId, filter: (k: string) => boolean, prompt: string, max: number, source: string) {
  const picked = ctx.search(p, filter, { prompt, max, source });
  ctx.toHand(p, picked);
  ctx.shuffle(p);
  return picked;
}

/** Attach a card from the discard pile to one of `targets`, both chosen by p. */
function attachFromDiscard(ctx: Ctx, p: PlayerId, energyFilter: (k: string) => boolean, targets: Slot[], prompt: string, source: string) {
  const energies = discardWhere(ctx.s, p, energyFilter);
  if (energies.length === 0 || targets.length === 0) return;
  const [e] = ctx.pickCards(p, uniqueByKey(ctx.s, energies), { purpose: 'attach', prompt, source });
  const [to] = ctx.pickSlots(p, targets, { purpose: 'attach', prompt: tx('จะติดให้ Pokémon ตัวไหน', 'Attach it to which Pokémon?'), source });
  attachFrom(ctx, p, e!, to!);
}

export const TRAINERS: Record<string, TrainerImpl> = {
  // ---- Items ----
  'ultra-ball': {
    canPlay: (s, p, c) => handOthers(s, p, c).length >= 2,
    play: (ctx, p, c) => {
      const cost = ctx.pickCards(p, handOthers(ctx.s, p, c), { purpose: 'discard-cost', prompt: tx('Ultra Ball: ทิ้งการ์ด 2 ใบ', 'Ultra Ball: discard 2 cards'), min: 2, max: 2, source: 'ultra-ball' });
      ctx.toDiscard(p, cost);
      searchToHand(ctx, p, isPokemon, tx('ค้นหา Pokémon 1 ใบ', 'Search for a Pokémon'), 1, 'ultra-ball');
    },
  },
  'poke-pad': {
    play: (ctx, p) => searchToHand(ctx, p, (k) => isPokemon(k) && !hasRuleBox(k), tx('ค้นหา Pokémon ที่ไม่มี Rule Box', 'Search for a Pokémon without a Rule Box'), 1, 'poke-pad'),
  },
  'buddy-buddy-poffin': {
    canPlay: (s, p) => s.players[p].bench.length < benchLimit(s, p),
    play: (ctx, p) => {
      const room = benchSpace(ctx, p);
      const picked = ctx.search(p, (k) => isBasicPokemon(k) && pokemon(k).hp <= 70, {
        prompt: tx('ค้น Basic Pokémon HP ไม่เกิน 70 (สูงสุด 2 ใบ) ลง Bench', 'Search for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench'),
        max: Math.min(2, room),
        source: 'buddy-buddy-poffin',
      });
      for (const c of picked) putOnBench(ctx, p, c);
      ctx.shuffle(p);
    },
  },
  'night-stretcher': {
    canPlay: (s, p) => discardWhere(s, p, (k) => isPokemon(k) || isBasicEnergy(k)).length > 0,
    play: (ctx, p) => {
      const opts = discardWhere(ctx.s, p, (k) => isPokemon(k) || isBasicEnergy(k));
      const picked = ctx.pickCards(p, uniqueByKey(ctx.s, opts), { prompt: tx('Night Stretcher: เลือก Pokémon หรือพลังงานพื้นฐานขึ้นมือ', 'Night Stretcher: choose a Pokémon or a Basic Energy to put into your hand'), source: 'night-stretcher' });
      ctx.toHand(p, picked);
    },
  },
  'energy-switch': {
    canPlay: (s, p) =>
      slotsOf(s.players[p]).length >= 2 && slotsOf(s.players[p]).some((sl) => sl.energy.some((e) => isBasicEnergy(key(s, e)))),
    play: (ctx, p) => {
      const s = ctx.s;
      const mine = slotsOf(ctx.ps(p));
      const sources = mine.filter((sl) => sl.energy.some((e) => isBasicEnergy(key(s, e))));
      const [from] = ctx.pickSlots(p, sources, { purpose: 'energy', prompt: tx('Energy Switch: ย้ายพลังงานจาก', 'Energy Switch: move an Energy from'), source: 'energy-switch', hint: 'from' });
      const basics = from!.energy.filter((e) => isBasicEnergy(key(s, e)));
      const [e] = ctx.pickCards(p, uniqueByKey(s, basics), { purpose: 'energy', prompt: tx('เลือกพลังงาน', 'Choose an Energy'), source: 'energy-switch' });
      const [to] = ctx.pickSlots(p, mine.filter((sl) => sl.uid !== from!.uid), { purpose: 'attach', prompt: tx('ย้ายไปที่', 'Move it to'), source: 'energy-switch' });
      from!.energy = from!.energy.filter((x) => x !== e);
      to!.energy.push(e!);
      ctx.log(tx(`ย้าย ${ctx.cardName(e!)} ไปที่ ${topDef(s, to!).name}`, `${ctx.cardName(e!)} moved to ${topDef(s, to!).name}`), p);
    },
  },
  switch: {
    canPlay: (s, p) => s.players[p].bench.length > 0,
    play: (ctx, p) => chooseSwitch(ctx, p, 'switch'),
  },
  'crushing-hammer': {
    canPlay: (s, p) => slotsOf(s.players[opp(p)]).some((sl) => sl.energy.length > 0),
    play: (ctx, p) => {
      const targets = slotsOf(ctx.ps(opp(p))).filter((sl) => sl.energy.length > 0);
      if (!ctx.flip() || targets.length === 0) return;
      const [t] = ctx.pickSlots(p, targets, { purpose: 'target', prompt: tx('Crushing Hammer: ทิ้งพลังงานจาก Pokémon ตัวไหน', 'Crushing Hammer: discard an Energy from which Pokémon?'), source: 'crushing-hammer' });
      const [e] = ctx.pickCards(p, uniqueByKey(ctx.s, t!.energy), { purpose: 'energy', prompt: tx('เลือกพลังงานที่จะทิ้ง', 'Choose the Energy to discard'), source: 'crushing-hammer' });
      t!.energy = t!.energy.filter((x) => x !== e);
      ctx.ps(opp(p)).discard.push(e!);
      ctx.log(tx(`ทิ้ง ${ctx.cardName(e!)} จาก ${topDef(ctx.s, t!).name}`, `${ctx.cardName(e!)} discarded from ${topDef(ctx.s, t!).name}`), p);
    },
  },
  'enhanced-hammer': {
    canPlay: (s, p) => slotsOf(s.players[opp(p)]).some((sl) => sl.energy.some((e) => isSpecialEnergy(keyOf(s, e)))),
    play: (ctx, p) => {
      const s = ctx.s;
      const special = (sl: Slot) => sl.energy.filter((e) => isSpecialEnergy(keyOf(s, e)));
      const targets = slotsOf(ctx.ps(opp(p))).filter((sl) => special(sl).length > 0);
      const [t] = ctx.pickSlots(p, targets, { purpose: 'target', prompt: tx('Enhanced Hammer: ทิ้ง Special Energy จาก Pokémon ตัวไหน', 'Enhanced Hammer: discard a Special Energy from which Pokémon?'), source: 'enhanced-hammer' });
      const [e] = ctx.pickCards(p, uniqueByKey(s, special(t!)), { purpose: 'energy', prompt: tx('เลือก Special Energy ที่จะทิ้ง', 'Choose the Special Energy to discard'), source: 'enhanced-hammer' });
      t!.energy = t!.energy.filter((x) => x !== e);
      ctx.ps(opp(p)).discard.push(e!);
      ctx.log(tx(`ทิ้ง ${ctx.cardName(e!)} จาก ${topDef(s, t!).name}`, `${ctx.cardName(e!)} discarded from ${topDef(s, t!).name}`), p);
    },
  },
  'rare-candy': {
    canPlay: (s, p) => s.turn > 2 && candyPairs(s, p).length > 0,
    play: (ctx, p) => {
      const s = ctx.s;
      const pairs = candyPairs(s, p);
      const [st2] = ctx.pickCards(p, uniqueByKey(s, [...new Set(pairs.map((x) => x.card))]), { purpose: 'take', prompt: tx('Rare Candy: เลือก Stage 2 ในมือ', 'Rare Candy: choose a Stage 2 in your hand'), source: 'rare-candy' });
      const targets = pairs.filter((x) => key(s, x.card) === key(s, st2!)).map((x) => x.slot);
      const [t] = ctx.pickSlots(p, uniqueSlots(targets), { purpose: 'target', prompt: tx('วิวัฒนาการ Pokémon ตัวไหน', 'Evolve which Pokémon?'), source: 'rare-candy' });
      ctx.take(p, st2!);
      evolveSlot(ctx, t!, st2!);
      ctx.log(tx(`${ctx.who(p)} ใช้ Rare Candy: ${pokemon(key(s, st2!)).name}`, `${ctx.who(p)} ${verb(ctx.who(p), 'play')} Rare Candy: ${pokemon(key(s, st2!)).name}`), p);
      offerTrigger(ctx, p, t!, 'evolve');
    },
  },
  'tool-scrapper': {
    canPlay: (s) => [0, 1].some((q) => slotsOf(s.players[q as PlayerId]).some((sl) => sl.tool !== null)),
    play: (ctx, p) => {
      const all = [...slotsOf(ctx.ps(p)), ...slotsOf(ctx.ps(opp(p)))].filter((sl) => sl.tool !== null);
      const picked = ctx.pickSlots(p, all, { purpose: 'target', prompt: tx('Tool Scrapper: เลือก Tool ที่จะทิ้ง (สูงสุด 2)', 'Tool Scrapper: choose up to 2 Tools to discard'), min: 0, max: 2, source: 'tool-scrapper' });
      for (const sl of picked) {
        const owner = ctx.s.cards[sl.stack[0]!]!.owner;
        ctx.ps(owner).discard.push(sl.tool!);
        ctx.log(tx(`ทิ้ง ${ctx.cardName(sl.tool!)}`, `${ctx.cardName(sl.tool!)} discarded`), p);
        sl.tool = null;
      }
    },
  },
  'sacred-ash': {
    canPlay: (s, p) => discardWhere(s, p, isPokemon).length > 0,
    play: (ctx, p) => {
      const mons = discardWhere(ctx.s, p, isPokemon);
      const picked = ctx.pickCards(p, mons, { purpose: 'take', prompt: tx('Sacred Ash: สับ Pokémon จากกองทิ้งเข้าเด็ค (สูงสุด 5)', 'Sacred Ash: shuffle up to 5 Pokémon from your discard pile into your deck'), min: 0, max: 5, source: 'sacred-ash' });
      ctx.shuffleIn(p, picked);
    },
  },
  'hand-trimmer': {
    play: (ctx, p) => {
      for (const q of [opp(p), p] as const) {
        const hand = ctx.ps(q).hand;
        const over = hand.length - 5;
        if (over <= 0) continue;
        const gone = ctx.pickCards(q, hand, { purpose: 'discard', prompt: tx(`Hand Trimmer: ทิ้งการ์ดให้เหลือ 5 ใบ (${over} ใบ)`, `Hand Trimmer: discard down to 5 cards (${over})`), min: over, max: over, source: 'hand-trimmer' });
        ctx.toDiscard(q, gone);
      }
    },
  },
  'secret-box': {
    canPlay: (s, p, c) => handOthers(s, p, c).length >= 3,
    play: (ctx, p, c) => {
      const cost = ctx.pickCards(p, handOthers(ctx.s, p, c), { purpose: 'discard-cost', prompt: tx('Secret Box: ทิ้งการ์ด 3 ใบ', 'Secret Box: discard 3 cards'), min: 3, max: 3, source: 'secret-box' });
      ctx.toDiscard(p, cost);
      for (const [type, label] of [['Item', 'Item'], ['Tool', 'Pokémon Tool'], ['Supporter', 'Supporter'], ['Stadium', 'Stadium']] as const) {
        const picked = ctx.search(p, (k) => isTrainerType(k, type), { prompt: tx(`Secret Box: ค้น ${label}`, `Secret Box: search for ${type === 'Item' ? 'an' : 'a'} ${label}`), max: 1, source: 'secret-box' });
        ctx.toHand(p, picked);
      }
      ctx.shuffle(p);
    },
  },
  'unfair-stamp': {
    canPlay: (s, p) => s.players[p].koLastTurn,
    play: (ctx, p) => {
      shuffleHandIn(ctx, p);
      shuffleHandIn(ctx, opp(p));
      ctx.draw(p, 5);
      ctx.draw(opp(p), 2);
    },
  },
  'special-red-card': {
    canPlay: (s, p) => s.players[opp(p)].prizes.length <= 3,
    play: (ctx, p) => {
      const o = ctx.ps(opp(p));
      const hand = o.hand.splice(0);
      if (hand.length === 0) return;
      // Shuffled, then put on the bottom of the deck.
      ctx.shuffleCards(opp(p), hand);
      o.deck.push(...hand);
      ctx.log(tx(`${ctx.who(opp(p))} ส่งการ์ดในมือ ${hand.length} ใบไปไว้ใต้เด็ค`, `${ctx.who(opp(p))} ${verb(ctx.who(opp(p)), 'put')} ${hand.length} cards from hand on the bottom of the deck`), p);
      ctx.draw(opp(p), 3);
    },
  },
  'wondrous-patch': {
    canPlay: (s, p) =>
      discardWhere(s, p, basicEnergyOfType('Psychic')).length > 0 &&
      s.players[p].bench.some((sl) => topDef(s, sl).types.includes('Psychic')),
    play: (ctx, p) =>
      attachFromDiscard(ctx, p, basicEnergyOfType('Psychic'), ctx.ps(p).bench.filter((sl) => topDef(ctx.s, sl).types.includes('Psychic')), tx('Wondrous Patch: เลือก Psychic Energy', 'Wondrous Patch: choose a Psychic Energy'), 'wondrous-patch'),
  },
  'ns-pp-up': {
    canPlay: (s, p) => discardWhere(s, p, isBasicEnergy).length > 0 && s.players[p].bench.some((sl) => isNsPokemon(topKey(s, sl))),
    play: (ctx, p) =>
      attachFromDiscard(ctx, p, isBasicEnergy, ctx.ps(p).bench.filter((sl) => isNsPokemon(topKey(ctx.s, sl))), tx("N's PP Up: เลือกพลังงานพื้นฐาน", "N's PP Up: choose a Basic Energy"), 'ns-pp-up'),
  },
  'glass-trumpet': {
    canPlay: (s, p) =>
      slotsOf(s.players[p]).some((sl) => topDef(s, sl).tera) &&
      discardWhere(s, p, isBasicEnergy).length > 0 &&
      s.players[p].bench.some((sl) => topDef(s, sl).types.includes('Colorless')),
    play: (ctx, p) => {
      const s = ctx.s;
      const targets = ctx.ps(p).bench.filter((sl) => topDef(s, sl).types.includes('Colorless'));
      const picked = ctx.pickSlots(p, targets, { purpose: 'attach', prompt: tx('Glass Trumpet: เลือก Pokémon {C} บน Bench (สูงสุด 2)', 'Glass Trumpet: choose up to 2 Benched {C} Pokémon'), min: 0, max: 2, source: 'glass-trumpet' });
      for (const sl of picked) {
        const energies = discardWhere(s, p, isBasicEnergy);
        if (energies.length === 0) break;
        const [e] = ctx.pickCards(p, uniqueByKey(s, energies), { purpose: 'attach', prompt: tx(`ติดพลังงานให้ ${topDef(s, sl).name}`, `Energy for ${topDef(s, sl).name}`), source: 'glass-trumpet' });
        attachFrom(ctx, p, e!, sl);
      }
    },
  },
  'bug-catching-set': {
    play: (ctx, p) => {
      const top = ctx.ps(p).deck.slice(0, 7);
      const ok = top.filter((c) => {
        const k = key(ctx.s, c);
        return (isPokemon(k) && pokemon(k).types.includes('Grass')) || basicEnergyOfType('Grass')(k);
      });
      const picked = ctx.pickCards(p, ok, { purpose: 'take', prompt: tx('Bug Catching Set: เลือก Pokémon {G} หรือ Grass Energy (สูงสุด 2)', 'Bug Catching Set: choose up to 2 {G} Pokémon or Grass Energy'), min: 0, max: 2, secret: true, reveal: true, source: 'bug-catching-set', view: top });
      ctx.toHand(p, picked);
      ctx.shuffle(p);
    },
  },

  // ---- Supporters ----
  'lillies-determination': {
    play: (ctx, p) => {
      shuffleHandIn(ctx, p);
      ctx.draw(p, ctx.ps(p).prizes.length === 6 ? 8 : 6);
    },
  },
  judge: {
    play: (ctx, p) => {
      shuffleHandIn(ctx, p);
      shuffleHandIn(ctx, opp(p));
      ctx.draw(p, 4);
      ctx.draw(opp(p), 4);
    },
  },
  cyrano: {
    play: (ctx, p) => {
      const picked = ctx.search(p, isEx, { prompt: tx('Cyrano: ค้น Pokémon ex (สูงสุด 3)', 'Cyrano: search for up to 3 Pokémon ex'), max: 3, source: 'cyrano' });
      ctx.toHand(p, picked);
      ctx.shuffle(p);
    },
  },
  'bosss-orders': {
    canPlay: (s, p) => s.players[opp(p)].bench.length > 0,
    play: (ctx, p) => {
      const [t] = ctx.pickSlots(p, ctx.ps(opp(p)).bench, { purpose: 'gust', prompt: tx("Boss's Orders: ดึง Pokémon ตัวไหนขึ้นมา", "Boss's Orders: switch in which Pokémon?"), source: 'bosss-orders' });
      switchIn(ctx, opp(p), t!);
    },
  },
  crispin: {
    play: (ctx, p) => {
      const s = ctx.s;
      // "of different types": one option per type.
      const types = uniqueByKey(s, ctx.ps(p).deck.filter((c) => isBasicEnergy(keyOf(s, c))));
      const distinct = ctx.pickCards(p, types, { purpose: 'search', prompt: tx('Crispin: ค้นพลังงานพื้นฐานต่างชนิดกัน (สูงสุด 2)', 'Crispin: search for up to 2 Basic Energy of different types'), min: 0, max: 2, secret: true, reveal: true, source: 'crispin', view: ctx.ps(p).deck.slice() });
      if (distinct.length === 0) {
        ctx.shuffle(p);
        return;
      }
      if (distinct.length === 1) {
        ctx.toHand(p, distinct);
      } else {
        const [toHand] = ctx.pickCards(p, distinct, { purpose: 'take', prompt: tx('เลือกใบที่จะขึ้นมือ (อีกใบติดให้ Pokémon)', 'Choose the one for your hand (the other is attached to a Pokémon)'), source: 'crispin' });
        const other = distinct.find((c) => c !== toHand)!;
        ctx.toHand(p, [toHand!]);
        const [to] = ctx.pickSlots(p, slotsOf(ctx.ps(p)), { purpose: 'attach', prompt: tx(`ติด ${ctx.cardName(other)} ให้ตัวไหน`, `Attach ${ctx.cardName(other)} to which Pokémon?`), source: 'crispin' });
        attachFrom(ctx, p, other, to!);
      }
      ctx.shuffle(p);
    },
  },
  'ciphermaniacs-codebreaking': {
    play: (ctx, p) => {
      const picked = ctx.search(p, () => true, { prompt: tx("Ciphermaniac's Codebreaking: ค้นการ์ด 2 ใบ", "Ciphermaniac's Codebreaking: search for 2 cards"), max: 2, source: 'ciphermaniacs-codebreaking', any: true });
      const order = picked.length > 1
        ? ctx.pickCards(p, picked, { purpose: 'order', prompt: tx('เรียงการ์ดบนเด็ค (ใบแรก = บนสุด)', 'Order the cards on top of your deck (first = top)'), min: picked.length, max: picked.length, ordered: true, source: 'ciphermaniacs-codebreaking' })
        : picked;
      for (const c of order) ctx.take(p, c);
      ctx.shuffle(p);
      ctx.ps(p).deck.unshift(...order);
      ctx.ps(p).knownTop = order.slice();
    },
  },
  'janines-secret-art': {
    canPlay: (s, p) => slotsOf(s.players[p]).some((sl) => topDef(s, sl).types.includes('Darkness')),
    play: (ctx, p) => {
      const s = ctx.s;
      const dark = slotsOf(ctx.ps(p)).filter((sl) => topDef(s, sl).types.includes('Darkness'));
      const picked = ctx.pickSlots(p, dark, { purpose: 'attach', prompt: tx("Janine's Secret Art: เลือก Pokémon {D} (สูงสุด 2)", "Janine's Secret Art: choose up to 2 {D} Pokémon"), min: 0, max: 2, source: 'janines-secret-art' });
      let active = false;
      for (const sl of picked) {
        const found = ctx.search(p, basicEnergyOfType('Darkness'), { prompt: tx(`ค้น Darkness Energy ให้ ${topDef(s, sl).name}`, `Search for a Darkness Energy for ${topDef(s, sl).name}`), max: 1, source: 'janines-secret-art' });
        for (const e of found) {
          attachFrom(ctx, p, e, sl);
          if (isActive(s, sl)) active = true;
        }
      }
      ctx.shuffle(p);
      const a = ctx.ps(p).active;
      if (active && a) addCondition(ctx, a, 'poisoned');
    },
  },
  'rosas-encouragement': {
    canPlay: (s, p) =>
      s.players[p].prizes.length > s.players[opp(p)].prizes.length &&
      slotsOf(s.players[p]).some((sl) => topDef(s, sl).stage === 'Stage2') &&
      discardWhere(s, p, isBasicEnergy).length > 0,
    play: (ctx, p) => {
      const s = ctx.s;
      const st2 = slotsOf(ctx.ps(p)).filter((sl) => topDef(s, sl).stage === 'Stage2');
      const [to] = ctx.pickSlots(p, st2, { purpose: 'attach', prompt: tx("Rosa's Encouragement: เลือก Stage 2", "Rosa's Encouragement: choose a Stage 2"), source: 'rosas-encouragement' });
      const energies = discardWhere(s, p, isBasicEnergy);
      const picked = ctx.pickCards(p, energies, { purpose: 'attach', prompt: tx('เลือกพลังงานพื้นฐาน (สูงสุด 2)', 'Choose up to 2 Basic Energy'), min: 0, max: 2, source: 'rosas-encouragement' });
      for (const e of picked) attachFrom(ctx, p, e, to!);
    },
  },
  'black-belts-training': {
    play: (ctx, p) => {
      ctx.ps(p).buffs.push('black-belt');
    },
  },
  'gladions-final-battle': {
    canPlay: (s, p) => s.players[p].hand.length === 1,
    play: (ctx, p) => {
      ctx.ps(p).buffs.push('gladion');
    },
  },
  kieran: {
    play: (ctx, p) => {
      const canSwitch = ctx.ps(p).bench.length > 0;
      const i = ctx.pickOption(p, tx('Kieran: เลือก 1 อย่าง', 'Kieran: choose 1'), canSwitch ? [tx('เทิร์นนี้ทำดาเมจใส่ ex ตัวหลักเพิ่ม 30', '+30 damage to Active Pokémon ex this turn'), tx('สลับตัวหลักกับตัวบน Bench', 'Switch your Active Pokémon with a Benched one')] : [tx('เทิร์นนี้ทำดาเมจใส่ ex ตัวหลักเพิ่ม 30', '+30 damage to Active Pokémon ex this turn')], 'kieran');
      if (i === 1) chooseSwitch(ctx, p, 'kieran');
      else ctx.ps(p).buffs.push('kieran');
    },
  },
  'lanas-aid': {
    canPlay: (s, p) => discardWhere(s, p, (k) => (isPokemon(k) && !hasRuleBox(k)) || isBasicEnergy(k)).length > 0,
    play: (ctx, p) => {
      const opts = discardWhere(ctx.s, p, (k) => (isPokemon(k) && !hasRuleBox(k)) || isBasicEnergy(k));
      const picked = ctx.pickCards(p, opts, { purpose: 'take', prompt: tx("Lana's Aid: เลือก Pokémon ไม่มี Rule Box / พลังงานพื้นฐาน (สูงสุด 3)", "Lana's Aid: choose up to 3 Pokémon without a Rule Box / Basic Energy"), min: 0, max: 3, source: 'lanas-aid' });
      ctx.toHand(p, picked);
    },
  },
  dawn: {
    play: (ctx, p) => {
      for (const stage of ['Basic', 'Stage1', 'Stage2'] as const) {
        const picked = ctx.search(p, (k) => isPokemon(k) && pokemon(k).stage === stage, { prompt: tx(`Dawn: ค้น ${stage === 'Basic' ? 'Basic' : stage === 'Stage1' ? 'Stage 1' : 'Stage 2'} Pokémon`, `Dawn: search for a ${stage === 'Basic' ? 'Basic' : stage === 'Stage1' ? 'Stage 1' : 'Stage 2'} Pokémon`), max: 1, source: 'dawn' });
        ctx.toHand(p, picked);
      }
      ctx.shuffle(p);
    },
  },
  hilda: {
    play: (ctx, p) => {
      const evo = ctx.search(p, (k) => isPokemon(k) && pokemon(k).stage !== 'Basic', { prompt: tx('Hilda: ค้น Evolution Pokémon', 'Hilda: search for an Evolution Pokémon'), max: 1, source: 'hilda' });
      ctx.toHand(p, evo);
      const en = ctx.search(p, isEnergy, { prompt: tx('Hilda: ค้นพลังงาน', 'Hilda: search for an Energy'), max: 1, source: 'hilda' });
      ctx.toHand(p, en);
      ctx.shuffle(p);
    },
  },
  surfer: {
    canPlay: (s, p) => s.players[p].bench.length > 0,
    play: (ctx, p) => {
      if (!chooseSwitch(ctx, p, 'surfer')) return;
      const need = 5 - ctx.ps(p).hand.length;
      if (need > 0) ctx.draw(p, need);
    },
  },
  eri: {
    play: (ctx, p) => {
      const o = ctx.ps(opp(p));
      const items = o.hand.filter((c) => isTrainerType(key(ctx.s, c), 'Item'));
      const picked = ctx.pickCards(p, items, { purpose: 'discard', prompt: tx('Eri: ทิ้ง Item ในมืออีกฝั่ง (สูงสุด 2)', "Eri: discard up to 2 Items from your opponent's hand"), min: 0, max: 2, source: 'eri' });
      ctx.toDiscard(opp(p), picked);
      ctx.log(tx(`อีกฝั่งมีการ์ดในมือ ${o.hand.length} ใบ`, `Opponent's hand: ${o.hand.length} cards`), p);
    },
  },
};

// ---------- helpers ----------

function uniqueSlots(slots: Slot[]): Slot[] {
  return slots.filter((sl, i) => slots.findIndex((x) => x.uid === sl.uid) === i);
}

/** (Stage 2 card in hand, Basic in play) pairs Rare Candy can use. */
function candyPairs(s: GameState, p: PlayerId): { card: CardId; slot: Slot }[] {
  const ps = s.players[p];
  const out: { card: CardId; slot: Slot }[] = [];
  for (const c of ps.hand) {
    const k = keyOf(s, c);
    if (!isPokemon(k) || pokemon(k).stage !== 'Stage2') continue;
    const basic = basicBelow(k);
    if (!basic) continue;
    for (const sl of slotsOf(ps)) {
      if (sl.stack.length === 1 && topDef(s, sl).name === basic && sl.enteredTurn !== s.turn) out.push({ card: c, slot: sl });
    }
  }
  return out;
}

/** Put an Evolution card on a Pokémon. Evolving ends Special Conditions and effects of attacks. */
export function evolveSlot(ctx: Ctx, slot: Slot, card: CardId): void {
  slot.stack.push(card);
  slot.evolvedTurn = ctx.s.turn;
  slot.conditions = [];
  slot.marks = [];
}
