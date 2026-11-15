// Special Energy that does something when attached from hand.
import type { Ctx } from '../ctx';
import { isBasicPokemon, pokemon } from '../db';
import { topDef } from '../state';
import type { CardId, PlayerId, Slot } from '../types';
import { benchSpace, putOnBench } from './common';

export const ON_ATTACH: Record<string, (ctx: Ctx, p: PlayerId, card: CardId, slot: Slot) => void> = {
  'telepathic-psychic-energy': (ctx, p, _card, slot) => {
    if (!topDef(ctx.s, slot).types.includes('Psychic')) return;
    const room = benchSpace(ctx, p);
    if (room <= 0) return;
    const picked = ctx.search(p, (k) => isBasicPokemon(k) && pokemon(k).types.includes('Psychic'), {
      prompt: 'Telepathic Psychic Energy: ค้น Basic Pokémon {P} ลง Bench (สูงสุด 2)',
      max: Math.min(2, room),
      source: 'telepathic-psychic-energy',
    });
    for (const c of picked) putOnBench(ctx, p, c);
    ctx.shuffle(p);
  },
  'enriching-energy': (ctx, p) => {
    ctx.draw(p, 4);
  },
};
