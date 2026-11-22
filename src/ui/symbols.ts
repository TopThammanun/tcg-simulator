// The Energy symbols and the coin, drawn flat as SVG (sharp at any size): each type a circle in its colour with a white
// glyph (public/energy/), the coin gold with a star for heads and silver with rings for tails (public/coin/).
import type { EnergyType } from '../data/cards';

export const energyIcon = (type: string) => `/energy/${type.toLowerCase()}.svg`;

export const COIN = { heads: '/coin/heads.svg', tails: '/coin/tails.svg' };

const BY_LETTER: Record<string, EnergyType> = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting',
  D: 'Darkness', M: 'Metal', N: 'Dragon', Y: 'Fairy', C: 'Colorless',
};

/** Card text split at its {G}, {C}…: plain text, and the Energy types to draw as symbols. */
export function energyParts(text: string): ({ text: string } | { type: EnergyType })[] {
  return text
    .split(/(\{[A-Z]\})/)
    .filter(Boolean)
    .map((p) => {
      const type = /^\{[A-Z]\}$/.test(p) ? BY_LETTER[p[1]!] : undefined;
      return type ? { type } : { text: p };
    });
}
