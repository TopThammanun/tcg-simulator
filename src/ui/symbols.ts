// The Energy symbols and the coin as on real cards and coins: PokéWiki's pictures ("<Typ>Symbol TCG.png", the gold
// Pikachu coin "TCG-Münze Pikachu Gold Non-Holo.jpg" and the standard back "TCG-Münze Rückseite Pokémon Nintendo TM.png"),
// cut to circles as webp in public/energy/ (96px) and public/coin/ (192px).
import type { EnergyType } from '../data/cards';

export const energyIcon = (type: string) => `/energy/${type.toLowerCase()}.webp`;

export const COIN = { heads: '/coin/heads.webp', tails: '/coin/tails.webp' };

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
