// Attack effects by attack name. Attacks not listed only do their printed damage.
// `a.user` is the Pokémon using the attack, which differs from the card that prints it when the
// attack is copied (Mew ex, N's Zoroark ex, Slowking).
import { tx } from '../../i18n';
import type { Attack } from '../../data/cards';
import type { AttackCtx, AttackImpl } from '../combat';
import { uniqueByKey } from '../ctx';
import { def, hasRuleBox, isBasicEnergy, isBasicPokemon, isNsPokemon, isPokemon } from '../db';
import { chooseSwitch, maxHp, provides, switchIn } from '../rules';
import { keyOf, nameOf, rulesBefore, slotsOf, topDef, topKey } from '../state';

/** Attacks that copy other attacks are not offered as copy targets themselves (avoids loops). */
const COPYING = new Set(['Night Joker', 'Seek Inspiration']);

const cantAttackNextTurn = (a: AttackCtx) => a.user.marks.push({ kind: 'cant-attack', turn: a.s.turn + 2 });

const isStage1 = (a: AttackCtx) => (a.defender ? topDef(a.s, a.defender).stage === 'Stage1' : false);

function bench(a: AttackCtx, side: 'me' | 'opp') {
  return a.s.players[side === 'me' ? a.me : a.opp].bench;
}

/** Copy one attack from a list, chosen by the attacking player. */
function copyAttack(a: AttackCtx, attacks: Attack[], prompt: string): void {
  const usable = attacks.filter((x) => !COPYING.has(x.name));
  if (usable.length === 0) return;
  const i = a.ctx.pickOption(a.me, prompt, usable.map((x) => x.name), topKey(a.s, a.user), 'attack');
  a.ctx.log(tx(`ใช้ท่า ${usable[i]!.name}`, `Uses ${usable[i]!.name}`));
  a.use(usable[i]!);
}

export const ATTACKS: Record<string, AttackImpl> = {
  // ---- Mew ex, Abra, Dunsparce: switching ----
  'Teleportation Burst': (a) => {
    a.hit(a.defender, a.base);
    if (bench(a, 'me').length > 0 && a.ctx.yesNo(a.me, tx('จะสลับ Mew ex กับ Pokémon บน Bench ไหม?', 'Switch Mew ex with a Benched Pokémon?'), 'mew-ex')) {
      chooseSwitch(a.ctx, a.me, 'mew-ex');
    }
  },
  'Teleportation Attack': (a) => {
    a.hit(a.defender, a.base);
    chooseSwitch(a.ctx, a.me, topKey(a.s, a.user));
  },
  'Trading Places': (a) => {
    chooseSwitch(a.ctx, a.me, topKey(a.s, a.user));
  },

  // ---- damage that depends on the board ----
  'Orichalcum Fang': (a) => a.hit(a.defender, a.base + (a.s.players[a.me].koByAttackLastTurn ? 120 : 0)),
  'Full Moon Rondo': (a) => a.hit(a.defender, 20 + 20 * (bench(a, 'me').length + bench(a, 'opp').length)),
  'Powerful Rage': (a) => a.hit(a.defender, 20 * (a.user.damage / 10)),
  'Fighting Wings': (a) => a.hit(a.defender, a.base + (a.defender && hasRuleBox(topKey(a.s, a.defender)) ? 90 : 0)),
  'Spirited Tackle': (a) => a.hit(a.defender, a.base + (isStage1(a) ? 90 : 0)),
  'Irritated Outburst': (a) => a.hit(a.defender, 60 * (6 - a.s.players[a.opp].prizes.length)),
  Psychic: (a) => a.hit(a.defender, 10 + 30 * (a.defender?.energy.length ?? 0)),
  'Myriad Leaf Shower': (a) => a.hit(a.defender, 30 + 30 * (a.user.energy.length + (a.defender?.energy.length ?? 0))),
  'Do the Wave': (a) => a.hit(a.defender, 20 * bench(a, 'me').length),
  'Tumbling Attack': (a) => a.hit(a.defender, a.base + (a.flip() ? 20 : 0)),
  'Rapid-Fire Combo': (a) => {
    let heads = 0;
    while (a.flip()) heads++;
    a.hit(a.defender, a.base + 50 * heads);
  },

  // ---- "can't attack" next turn ----
  'Eon Blade': (a) => {
    a.hit(a.defender, a.base);
    cantAttackNextTurn(a);
  },
  'Prism Edge': (a) => {
    a.hit(a.defender, a.base);
    cantAttackNextTurn(a);
  },
  'Blood Moon': (a) => {
    a.hit(a.defender, a.base);
    cantAttackNextTurn(a);
  },
  'Rampaging Thunder': (a) => {
    a.hit(a.defender, a.base);
    cantAttackNextTurn(a);
  },
  'Impact Blow': (a) => {
    a.hit(a.defender, a.base);
    a.user.marks.push({ kind: 'cant-use', attack: 'Impact Blow', turn: a.s.turn + 2 });
  },

  // ---- effects on the Defending Pokémon ----
  Clutch: (a) => {
    a.hit(a.defender, a.base);
    a.mark(a.defender, { kind: 'cant-retreat', turn: a.s.turn + 1 });
  },
  Sob: (a) => {
    a.hit(a.defender, a.base);
    a.mark(a.defender, { kind: 'cant-retreat', turn: a.s.turn + 1 });
  },
  'Mind Bend': (a) => {
    a.hit(a.defender, a.base);
    a.condition(a.defender, 'confused');
  },
  'Itchy Pollen': (a) => {
    a.hit(a.defender, a.base);
    a.s.players[a.opp].itemLockTurn = a.s.turn + 1;
    a.ctx.log(tx(`${a.ctx.who(a.opp)} ใช้ Item ไม่ได้ในเทิร์นหน้า`, `${a.ctx.who(a.opp)} can't play Items next turn`));
  },
  Dig: (a) => {
    a.hit(a.defender, a.base);
    if (a.flip()) a.user.marks.push({ kind: 'protected', turn: a.s.turn + 1 });
  },
  Whirlpool: (a) => {
    a.hit(a.defender, a.base);
    const d = a.defender;
    if (d && d.energy.length > 0 && a.flip() && !a.blocked(d)) {
      const [e] = a.ctx.pickCards(a.me, uniqueByKey(a.s, d.energy), {
        purpose: 'energy',
        prompt: tx('เลือกพลังงานของตัวหลักฝั่งตรงข้ามที่จะทิ้ง', "Choose an Energy on the opponent's Active Pokémon to discard"),
        source: 'goldeen',
      });
      a.discardEnergy(d, [e!]);
    }
  },
  'Bounce Back': (a) => {
    a.hit(a.defender, a.base);
    const d = a.s.players[a.opp].active;
    if (d && d.uid === a.defender?.uid && bench(a, 'opp').length > 0 && !a.blocked(d)) {
      const [to] = a.ctx.pickSlots(a.opp, bench(a, 'opp'), {
        purpose: 'promote',
        prompt: tx('เลือก Pokémon ขึ้นเป็นตัวหลักแทน', 'Choose the Pokémon to switch in'),
        source: 'metagross',
      });
      switchIn(a.ctx, a.opp, to!);
    }
  },
  'Slight Shift': (a) => {
    const sources = a.oppSlots().filter((sl) => sl.energy.length > 0 && !a.blocked(sl));
    const from = a.pickTarget(sources, tx('เลือก Pokémon ฝั่งตรงข้ามที่จะย้ายพลังงานออก', "Choose the opponent's Pokémon to move an Energy from"));
    if (!from) return;
    const dests = a.oppSlots().filter((sl) => sl.uid !== from.uid && !a.blocked(sl));
    const to = a.pickTarget(dests, tx('ย้ายพลังงานไปไว้ที่', 'Move the Energy to'));
    if (!to) return;
    const [e] = a.ctx.pickCards(a.me, uniqueByKey(a.s, from.energy), { purpose: 'energy', prompt: tx('เลือกพลังงาน', 'Choose an Energy') });
    from.energy = from.energy.filter((x) => x !== e);
    to.energy.push(e!);
  },
  'Thieving Swipe': (a) => {
    a.hit(a.defender, a.base);
    const hand = a.s.players[a.opp].hand;
    if (hand.length === 0) return;
    const [c] = a.ctx.pickCards(a.me, hand, {
      purpose: 'discard',
      prompt: tx('เลือกการ์ดในมืออีกฝั่งไปไว้ใต้เด็ค', "Choose a card from your opponent's hand to put on the bottom of their deck"),
      source: 'ns-purrloin',
    });
    hand.splice(hand.indexOf(c!), 1);
    a.s.players[a.opp].deck.push(c!);
    a.ctx.log(tx(`${nameOf(a.s, c!)} ถูกส่งไปใต้เด็ค`, `${nameOf(a.s, c!)} is put on the bottom of the deck`));
  },

  // ---- Bench damage and damage counters ----
  'Cruel Arrow': (a) => {
    const t = a.pickTarget(a.oppSlots(), tx('เลือกเป้าที่จะรับดาเมจ 100', 'Choose the target for 100 damage'));
    a.hit(t ?? null, 100);
  },
  'Twin Shotels': (a) => {
    const targets = a.ctx.pickSlots(a.me, a.oppSlots(), {
      purpose: 'target',
      prompt: tx('เลือกเป้า 2 ตัว (ตัวละ 50)', 'Choose 2 targets (50 each)'),
      min: Math.min(2, a.oppSlots().length),
      max: 2,
      source: 'iron-crown-ex',
    });
    for (const t of targets) a.hit(t, 50, { noWR: true, pierce: true });
  },
  Trifrost: (a) => {
    a.discardEnergy(a.user, a.user.energy.slice());
    const n = Math.min(3, a.oppSlots().length);
    const targets = a.ctx.pickSlots(a.me, a.oppSlots(), {
      purpose: 'target',
      prompt: tx('เลือกเป้า 3 ตัว (ตัวละ 110)', 'Choose 3 targets (110 each)'),
      min: n,
      max: n,
      source: 'kyurem',
    });
    for (const t of targets) a.hit(t, 110);
  },
  'Thunder Raid': (a) => {
    a.discardEnergy(a.user, a.user.energy.slice());
    const exs = bench(a, 'opp').filter((sl) => hasRuleBox(topKey(a.s, sl)));
    const t = a.pickTarget(exs, tx('เลือก Pokémon ex บน Bench ฝั่งตรงข้าม (210)', "Choose one of the opponent's Benched Pokémon ex (210)"));
    a.hit(t ?? null, 210);
  },
  'Torrential Pump': (a) => {
    a.hit(a.defender, a.base);
    const targets = bench(a, 'opp');
    if (a.user.energy.length < 3 || targets.length === 0) return;
    if (!a.ctx.yesNo(a.me, tx('จะสับพลังงาน 3 ใบเข้าเด็ค เพื่อทำดาเมจ 120 ใส่ Pokémon บน Bench ไหม?', 'Shuffle 3 Energy into your deck to do 120 to a Benched Pokémon?'), 'wellspring-mask-ogerpon-ex')) return;
    const picked = a.ctx.pickCards(a.me, a.user.energy, {
      purpose: 'energy',
      prompt: tx('เลือกพลังงาน 3 ใบที่จะสับเข้าเด็ค', 'Choose 3 Energy to shuffle into your deck'),
      min: 3,
      max: 3,
    });
    a.user.energy = a.user.energy.filter((e) => !picked.includes(e));
    a.s.players[a.me].deck.push(...picked);
    a.ctx.shuffle(a.me);
    const t = a.pickTarget(bench(a, 'opp'), tx('เลือกเป้าบน Bench (120)', 'Choose a Benched target (120)'));
    a.hit(t ?? null, 120);
  },
  'Phantom Dive': (a) => {
    a.hit(a.defender, a.base);
    placeCountersAnyWay(a, 6);
  },
  'Hex Hurl': (a) => {
    a.hit(a.defender, a.base);
    placeCountersAnyWay(a, 2);
  },
  'Powerful Hand': (a) => {
    if (a.defender) a.counters(a.defender, 2 * a.s.players[a.me].hand.length);
  },
  Shred: (a) => a.hit(a.defender, a.base, { pierce: true }),
  'Slight Intrusion': (a) => {
    a.hit(a.defender, a.base);
    a.hit(a.user, 10);
  },

  // ---- Energy on the user ----
  // Japanese Q&A: the 150 more is the choice and the discard follows as far as it can, so a user with no {M}
  // Energy (Slowking copying it) does 300 for nothing.
  // (Rules version 1 offered it only with 3 {M} Energy to discard.)
  'Metallic Hammer': (a) => {
    const metal = a.user.energy.filter((e) => provides(keyOf(a.s, e)) === 'Metal').slice(0, 3);
    const offered = rulesBefore(a.s, 2) ? metal.length === 3 : true;
    const more = offered && (metal.length === 0 || a.ctx.yesNo(a.me, tx(`จะทิ้งพลังงาน {M} ${metal.length} ใบ เพื่อเพิ่มดาเมจอีก 150 ไหม?`, `Discard ${metal.length} {M} Energy for 150 more damage?`), 'metagross'));
    if (more && metal.length > 0) a.discardEnergy(a.user, metal);
    a.hit(a.defender, a.base + (more ? 150 : 0));
  },
  'Icicle Loop': (a) => {
    a.hit(a.defender, a.base);
    if (a.user.energy.length === 0) return;
    const [e] = a.ctx.pickCards(a.me, uniqueByKey(a.s, a.user.energy), {
      purpose: 'energy',
      prompt: tx('เลือกพลังงานที่จะเก็บขึ้นมือ', 'Choose the Energy to put into your hand'),
      source: 'chien-pao',
    });
    a.user.energy = a.user.energy.filter((x) => x !== e);
    a.s.players[a.me].hand.push(e!);
    a.ctx.reveal(a.me, [e!]);
  },
  'Bellowing Thunder': (a) => {
    const mine = slotsOf(a.s.players[a.me]).flatMap((sl) =>
      sl.energy.filter((e) => isBasicEnergy(keyOf(a.s, e))).map((e) => ({ sl, e })),
    );
    const picked = a.ctx.pickCards(
      a.me,
      mine.map((x) => x.e),
      { purpose: 'discard-cost', prompt: tx('ทิ้งพลังงานพื้นฐานจาก Pokémon ของคุณกี่ใบก็ได้ (ใบละ 70)', 'Discard any number of Basic Energy from your Pokémon (70 each)'), min: 0, max: mine.length, source: 'raging-bolt-ex', hint: 'per-card-70' },
    );
    for (const e of picked) a.discardEnergy(mine.find((x) => x.e === e)!.sl, [e]);
    a.hit(a.defender, 70 * picked.length);
  },

  // ---- hand and deck ----
  'Burst Roar': (a) => {
    const ps = a.s.players[a.me];
    ps.discard.push(...ps.hand.splice(0));
    a.ctx.draw(a.me, 6);
  },
  'Rapid Draw': (a) => {
    a.hit(a.defender, a.base);
    a.ctx.draw(a.me, 2);
  },
  'Dangle Tail': (a) => {
    const ps = a.s.players[a.me];
    const mons = ps.discard.filter((c) => isPokemon(keyOf(a.s, c)));
    const picked = a.ctx.pickCards(a.me, uniqueByKey(a.s, mons), { prompt: tx('เลือก Pokémon จากกองทิ้งขึ้นมือ', 'Choose a Pokémon from your discard pile to put into your hand'), source: 'slowpoke' });
    a.ctx.toHand(a.me, picked);
  },
  'Find a Friend': (a) => {
    const picked = a.ctx.search(a.me, isPokemon, { prompt: tx('ค้นหา Pokémon 1 ใบ', 'Search for a Pokémon'), max: 1, source: 'applin-twm-126' });
    a.ctx.toHand(a.me, picked);
    a.ctx.shuffle(a.me);
  },
  'Tuck Tail': (a) => {
    a.hit(a.defender, a.base);
    const ps = a.s.players[a.me];
    const u = a.user;
    a.ctx.detachSlot(a.me, u);
    const back = [...u.stack, ...u.energy, ...(u.tool !== null ? [u.tool] : [])];
    ps.hand.push(...back);
    a.ctx.reveal(a.me, back);
    a.ctx.log(tx(`${topDef(a.s, u).name} กลับขึ้นมือ`, `${topDef(a.s, u).name} returns to the hand`));
  },

  // ---- copying ----
  'Night Joker': (a) => {
    const attacks = bench(a, 'me')
      .filter((sl) => isNsPokemon(topKey(a.s, sl)))
      .flatMap((sl) => topDef(a.s, sl).attacks);
    copyAttack(a, attacks, tx('Night Joker: เลือกท่าของ N\'s Pokémon บน Bench', "Night Joker: choose an attack of a Benched N's Pokémon"));
  },
  'Seek Inspiration': (a) => {
    const ps = a.s.players[a.me];
    const top = ps.deck.shift();
    if (top === undefined) return;
    ps.discard.push(top);
    const k = keyOf(a.s, top);
    a.ctx.log(tx(`ทิ้งการ์ดบนสุด: ${def(k).name}`, `Top card discarded: ${def(k).name}`));
    if (!isPokemon(k) || hasRuleBox(k)) return;
    copyAttack(a, topDefOfKey(k).attacks, tx(`Seek Inspiration: เลือกท่าของ ${def(k).name}`, `Seek Inspiration: choose an attack of ${def(k).name}`));
  },

  // ---- Annihilape (Surging Sparks, Pitch Black) ----
  Tantrum: (a) => {
    a.hit(a.defender, a.base);
    a.condition(a.user, 'confused');
  },
  // A Knock Out by effect, not damage: Durable Body and damage prevention don't apply; protection from
  // attack effects does.
  'Destined Fight': (a) => {
    const d = a.defender;
    if (d && !a.blocked(d)) d.damage = Math.max(d.damage, maxHp(a.s, d));
    a.user.damage = Math.max(a.user.damage, maxHp(a.s, a.user));
    a.ctx.log(tx('Destined Fight: ตัวหลักของทั้งสองฝั่งโดน KO', 'Destined Fight: both Active Pokémon are Knocked Out'));
  },
  'Ghostly Blow': (a) => {
    a.hit(a.defender, a.base);
    const t = a.pickTarget(a.s.players[a.opp].bench, tx('Ghostly Blow: วางตัวนับดาเมจ 5 ตัวบน Pokémon บน Bench ตัวไหน', 'Ghostly Blow: put 5 damage counters on which Benched Pokémon?'), 'counters');
    if (t) a.counters(t, 5);
  },
  // ---- Dudunsparce ex ----
  'Tenacious Tail': (a) => {
    const n = a.oppSlots().filter((sl) => topDef(a.s, sl).subtypes.includes('ex') || / ex$/.test(topDef(a.s, sl).name)).length;
    a.hit(a.defender, 60 * n);
  },
  'Destructive Drill': (a) => {
    a.hit(a.defender, a.base, { pierce: true });
  },
  // ---- N's Darmanitan ----
  'Back Draft': (a) => {
    const n = a.s.players[a.opp].discard.filter((c) => isBasicEnergy(keyOf(a.s, c))).length;
    a.hit(a.defender, 30 * n);
  },
  'Flamebody Cannon': (a) => {
    a.hit(a.defender, a.base);
    a.discardEnergy(a.user, a.user.energy.slice());
    const t = a.pickTarget(a.s.players[a.opp].bench, tx('Flamebody Cannon: ทำดาเมจ 90 ใส่ Pokémon บน Bench ตัวไหน', 'Flamebody Cannon: 90 damage to which Benched Pokémon?'));
    if (t) a.hit(t, 90, { noWR: true });
  },
  // ---- Talonflame ex ----
  'Talon Hunt': (a) => {
    a.hit(a.defender, a.base);
    const picked = a.ctx.search(a.me, () => true, { prompt: tx('Talon Hunt: ค้นหาการ์ดได้สูงสุด 2 ใบ', 'Talon Hunt: search for up to 2 cards'), max: 2, source: 'talonflame-ex', any: true });
    a.ctx.toHand(a.me, picked);
    a.ctx.shuffle(a.me);
  },
  // ---- Passimian, Enamorus ----
  'Coordinated Throwing': (a) => {
    const n = slotsOf(a.s.players[a.me]).filter((sl) => isBasicPokemon(topKey(a.s, sl))).length;
    a.hit(a.defender, 20 * n);
  },
  'Love Resonance': (a) => {
    const types = (p: typeof a.me) => new Set(slotsOf(a.s.players[p]).flatMap((sl) => topDef(a.s, sl).types));
    const theirs = types(a.opp);
    const match = [...types(a.me)].some((t) => theirs.has(t));
    a.hit(a.defender, a.base + (match ? 120 : 0));
  },
};

function topDefOfKey(key: string) {
  const d = def(key);
  if (d.category !== 'pokemon') throw new Error('not a Pokémon');
  return d;
}

/** "Put N damage counters on your opponent's Benched Pokémon in any way you like." */
function placeCountersAnyWay(a: AttackCtx, n: number): void {
  const targets = bench(a, 'opp');
  if (targets.length === 0) return;
  const picks = a.ctx.pickSlots(a.me, targets, {
    purpose: 'counters',
    prompt: tx(`วางตัวนับดาเมจ ${n} ตัวบน Bench ฝั่งตรงข้าม (เลือกทีละตัว)`, `Put ${n} damage counters on your opponent's Bench (one at a time)`),
    min: n,
    max: n,
    repeat: true,
    source: topKey(a.s, a.user),
  });
  const per = new Map<number, number>();
  for (const sl of picks) per.set(sl.uid, (per.get(sl.uid) ?? 0) + 1);
  for (const sl of targets) {
    const k = per.get(sl.uid);
    if (k) a.counters(sl, k);
  }
}
