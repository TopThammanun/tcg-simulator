import manifestJson from '../../data/cards.manifest.json';
import type { CardDef, CardManifest, CardPrint } from './cards';
import { printKey, type DeckEntry } from './decklist';

export const manifest = manifestJson as CardManifest;

export function lookup(entry: Pick<DeckEntry, 'set' | 'number'>): { print: CardPrint; card: CardDef } {
  const print = manifest.prints[printKey(entry)];
  const card = print && manifest.cards[print.card];
  if (!card) throw new Error(`${printKey(entry)} is not in data/cards.manifest.json — run npm run cards`);
  return { print, card };
}
