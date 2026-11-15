// Checked after every action in tests, fuzzing and (optionally) simulations.
import { def, isBasicPokemon, isEnergy, isTrainerType } from './db';
import { benchLimit, maxHp } from './rules';
import { keyOf, slotsOf } from './state';
import type { CardId, GameState, PlayerId } from './types';

export function checkInvariants(s: GameState): string[] {
  const problems: string[] = [];
  const seen = new Map<CardId, string>();
  const note = (card: CardId, where: string, p: PlayerId | null) => {
    if (seen.has(card)) problems.push(`card ${card} (${keyOf(s, card)}) is in ${seen.get(card)} and ${where}`);
    seen.set(card, where);
    if (p !== null && s.cards[card]!.owner !== p) problems.push(`card ${card} in ${where} belongs to the other player`);
  };

  for (const p of [0, 1] as const) {
    const ps = s.players[p];
    for (const [zone, cards] of [['deck', ps.deck], ['hand', ps.hand], ['discard', ps.discard], ['prizes', ps.prizes]] as const) {
      for (const c of cards) note(c, `p${p} ${zone}`, p);
    }
    for (const sl of slotsOf(ps)) {
      const where = `p${p} slot ${sl.uid}`;
      sl.stack.forEach((c) => note(c, where, p));
      sl.energy.forEach((c) => note(c, `${where} energy`, p));
      if (sl.tool !== null) note(sl.tool, `${where} tool`, p);
      if (!isBasicPokemon(keyOf(s, sl.stack[0]!))) problems.push(`${where} has no Basic at the bottom`);
      for (const e of sl.energy) if (!isEnergy(keyOf(s, e))) problems.push(`${where} has non-Energy ${keyOf(s, e)} attached`);
      if (sl.tool !== null && !isTrainerType(keyOf(s, sl.tool), 'Tool')) problems.push(`${where} tool is not a Tool`);
      if (sl.damage < 0 || sl.damage % 10 !== 0) problems.push(`${where} damage ${sl.damage}`);
      if (sl.conditions.length > 0 && ps.active?.uid !== sl.uid) problems.push(`${where} is Benched but has conditions`);
      if (!s.pending && s.winner === null && s.phase === 'main' && sl.damage >= maxHp(s, sl)) {
        problems.push(`${where} (${def(keyOf(s, sl.stack[sl.stack.length - 1]!)).name}) should be Knocked Out`);
      }
    }
    if (!s.pending && s.winner === null && s.phase === 'main') {
      if (!ps.active) problems.push(`p${p} has no Active Pokémon`);
      if (ps.bench.length > benchLimit(s, p)) problems.push(`p${p} bench ${ps.bench.length} > ${benchLimit(s, p)}`);
    }
  }
  if (s.stadium) note(s.stadium.card, 'stadium', null);
  if (seen.size !== s.cards.length) problems.push(`${s.cards.length - seen.size} cards are missing`);
  for (const p of [0, 1] as const) {
    const n = [...seen.keys()].filter((c) => s.cards[c]!.owner === p).length;
    if (n !== 60) problems.push(`p${p} has ${n} cards, expected 60`);
  }
  return problems;
}
