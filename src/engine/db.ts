// Card definitions for the engine, read from data/cards.manifest.json.
import manifestJson from '../../data/cards.manifest.json';
import type { CardDef, CardManifest, EnergyCard, EnergyType, PokemonCard, TrainerCard } from '../data/cards';
import { printKey, type DeckEntry } from '../data/decklist';

const manifest = manifestJson as CardManifest;
export const CARDS: Readonly<Record<string, CardDef>> = manifest.cards;

export function def(key: string): CardDef {
  const d = CARDS[key];
  if (!d) throw new Error(`unknown card ${key}`);
  return d;
}

export function pokemon(key: string): PokemonCard {
  const d = def(key);
  if (d.category !== 'pokemon') throw new Error(`${key} is not a Pokémon`);
  return d;
}

export function trainer(key: string): TrainerCard | undefined {
  const d = def(key);
  return d.category === 'trainer' ? d : undefined;
}

export function energyCard(key: string): EnergyCard | undefined {
  const d = def(key);
  return d.category === 'energy' ? d : undefined;
}

export const isPokemon = (key: string) => def(key).category === 'pokemon';
export const isBasicPokemon = (key: string) => {
  const d = def(key);
  return d.category === 'pokemon' && d.stage === 'Basic';
};
export const isBasicEnergy = (key: string) => {
  const d = def(key);
  return d.category === 'energy' && d.energyType === 'Basic';
};
export const isEnergy = (key: string) => def(key).category === 'energy';
export const isTrainerType = (key: string, type: TrainerCard['trainerType']) => trainer(key)?.trainerType === type;
export const basicEnergyType = (key: string): EnergyType | undefined => energyCard(key)?.provides;

/** Pokémon ex (and Mega Pokémon ex) have a Rule Box; nothing else in the card pool does. */
export const hasRuleBox = (key: string) => {
  const d = def(key);
  return d.category === 'pokemon' && d.prizes > 1;
};
export const isEx = hasRuleBox;
export const isNsPokemon = (key: string) => isPokemon(key) && def(key).name.startsWith("N's ");
export const isLilliesPokemon = (key: string) => isPokemon(key) && def(key).name.startsWith("Lillie's ");

export function hasType(key: string, type: EnergyType): boolean {
  const d = def(key);
  return d.category === 'pokemon' && d.types.includes(type);
}

const evolvesFromByName = new Map<string, string>();
for (const d of Object.values(CARDS)) {
  if (d.category === 'pokemon' && d.evolvesFrom) evolvesFromByName.set(d.name, d.evolvesFrom);
}

/** For a Stage 2 card, the Basic name two steps down (Rare Candy), if the Stage 1 is in the card pool. */
export function basicBelow(stage2Key: string): string | undefined {
  const d = pokemon(stage2Key);
  if (d.stage !== 'Stage2' || !d.evolvesFrom) return undefined;
  return evolvesFromByName.get(d.evolvesFrom);
}

/** Expand decklist entries into one card key per card. */
export function deckKeys(entries: DeckEntry[]): string[] {
  const keys: string[] = [];
  for (const e of entries) {
    const print = manifest.prints[printKey(e)];
    if (!print) throw new Error(`${printKey(e)} (${e.name}) is not in the card manifest`);
    for (let i = 0; i < e.count; i++) keys.push(print.card);
  }
  return keys;
}

export function imageFor(key: string): { high?: string; low?: string } {
  const d = def(key);
  const print = manifest.prints[d.prints[0]!];
  return print && print.image.source !== 'none' ? { high: print.image.high, low: print.image.low } : {};
}
