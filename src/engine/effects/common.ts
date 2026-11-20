import type { Ctx } from '../ctx';
import { def, isBasicPokemon } from '../db';
import { benchLimit, stadiumIs, trimBenches } from '../rules';
import { keyOf, opp } from '../state';
import type { CardId, PlayerId, Slot } from '../types';

export const benchSpace = (ctx: Ctx, p: PlayerId) => Math.max(0, benchLimit(ctx.s, p) - ctx.ps(p).bench.length);

/** Put a Basic Pokémon card (from any zone) onto p's Bench. */
export function putOnBench(ctx: Ctx, p: PlayerId, card: CardId): Slot {
  ctx.take(p, card);
  const slot = ctx.newSlot(card);
  ctx.ps(p).bench.push(slot);
  ctx.log(`${ctx.who(p)} วาง ${ctx.cardName(card)} บน Bench`, p);
  const k = keyOf(ctx.s, card);
  const d = def(k);
  if (
    ctx.s.phase === 'main' &&
    stadiumIs(ctx.s, 'risky-ruins') &&
    isBasicPokemon(k) &&
    d.category === 'pokemon' &&
    !d.types.includes('Darkness')
  ) {
    slot.damage += 20;
    ctx.log(`Risky Ruins: วางตัวนับดาเมจ 2 ตัวบน ${d.name}`);
  }
  return slot;
}

/** Attach an Energy card from any of p's zones to a Pokémon in play. */
export function attachFrom(ctx: Ctx, p: PlayerId, card: CardId, slot: Slot): void {
  ctx.take(p, card);
  slot.energy.push(card);
  ctx.log(`ติด ${ctx.cardName(card)}`, p);
}

/** Discard the Stadium in play; Area Zero leaving play trims both Benches (its owner first). */
export function discardStadium(ctx: Ctx): void {
  const st = ctx.s.stadium;
  if (!st) return;
  const wasAreaZero = stadiumIs(ctx.s, 'area-zero-underdepths');
  ctx.s.stadium = null;
  ctx.ps(st.owner).discard.push(st.card);
  ctx.log(`${ctx.cardName(st.card)} ออกจากสนาม`);
  if (wasAreaZero) trimBenches(ctx, [st.owner, opp(st.owner)]);
}

/** Shuffle p's hand into their deck. The log line also tells the play screen to send every card to the deck, the ones
 * drawn straight back too (src/ui/anim/events.ts HAND_IN). */
export function shuffleHandIn(ctx: Ctx, p: PlayerId): void {
  const ps = ctx.ps(p);
  const n = ps.hand.length;
  ps.deck.push(...ps.hand.splice(0));
  ctx.shuffle(p);
  if (n > 0) ctx.log(`${ctx.who(p)} สับการ์ดในมือ ${n} ใบเข้าเด็ค`, p);
}
