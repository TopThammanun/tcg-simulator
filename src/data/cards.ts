// Shape of data/cards.manifest.json, written by scripts/build-card-manifest.ts.
// `cards` holds gameplay definitions keyed by card identity (same name + same text = one card);
// `prints` holds each set/number printing from the decklists, with its image.

export type EnergyType =
  | 'Grass'
  | 'Fire'
  | 'Water'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Dragon'
  | 'Fairy'
  | 'Colorless';

export interface Attack {
  name: string;
  cost: EnergyType[];
  /** As printed: "", "70", "200+", "30×". */
  damage: string;
  effect: string;
}

export interface Ability {
  name: string;
  effect: string;
}

export interface TypeValue {
  type: EnergyType;
  value: string;
}

interface CardCommon {
  key: string;
  name: string;
  /** pokemontcg.io subtypes such as ["Basic", "Tera", "ex"]; empty when only TCGdex had the card. */
  subtypes: string[];
  /** Rule-box and other printed rules that are not attacks or abilities. */
  rules: string[];
  regulationMark?: string;
  prints: string[];
}

export interface PokemonCard extends CardCommon {
  category: 'pokemon';
  hp: number;
  types: EnergyType[];
  stage: 'Basic' | 'Stage1' | 'Stage2';
  evolvesFrom?: string;
  abilities: Ability[];
  attacks: Attack[];
  weaknesses: TypeValue[];
  resistances: TypeValue[];
  retreat: number;
  /** Prize cards the opponent takes on Knock Out: 1, ex = 2, Mega ex = 3. */
  prizes: 1 | 2 | 3;
  tera: boolean;
}

export interface TrainerCard extends CardCommon {
  category: 'trainer';
  trainerType: 'Item' | 'Supporter' | 'Stadium' | 'Tool';
  aceSpec: boolean;
  effect: string;
}

export interface EnergyCard extends CardCommon {
  category: 'energy';
  energyType: 'Basic' | 'Special';
  /** Type a Basic Energy provides; Special Energy describes its own in `effect`. */
  provides?: EnergyType;
  aceSpec: boolean;
  effect: string;
}

export type CardDef = PokemonCard | TrainerCard | EnergyCard;

export type ImageSource = 'tcgdex' | 'pokemontcg.io' | 'alt-print' | 'none';

export interface CardImage {
  source: ImageSource;
  high?: string;
  low?: string;
  /** Set when the image shows another printing: its TCGdex id ('alt-print') or pokemontcg.io id. */
  altOf?: string;
}

export interface CardPrint {
  key: string;
  set: string;
  number: string;
  name: string;
  card: string;
  tcgdexId?: string;
  ptcgioId?: string;
  image: CardImage;
}

export interface CardManifest {
  version: 1;
  generatedAt: string;
  cards: Record<string, CardDef>;
  prints: Record<string, CardPrint>;
}
