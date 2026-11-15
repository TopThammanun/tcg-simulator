import type { Action, ChoiceRequest, GameState, PlayerId, Slot } from '../engine/types';

export interface Bot {
  /** Next action for the player who must act in `s` (answers a pending choice when there is one). */
  act(s: GameState): Action;
}

export type Level = 'easy' | 'normal' | 'hard' | 'pro';

/**
 * Deck-specific knowledge layered on the shared bot core. Every hook is optional; the core has
 * generic defaults. Scores are on the scale used by core.ts (roughly 0–100).
 */
export interface DeckPlan {
  name: string;
  /** Pokémon this deck wants to attack with, best first (card keys). */
  attackers: string[];
  /** Preferred starting Active, best first. */
  starters?: string[];
  /** How many Benched Pokémon to aim for. */
  benchTarget?: (s: GameState, me: PlayerId) => number;
  /** Value of having/fetching this card now; undefined = generic. */
  cardValue?: (s: GameState, me: PlayerId, key: string) => number | undefined;
  /** Extra score for an action (added to the generic score); may veto with -Infinity. */
  adjust?: (s: GameState, me: PlayerId, a: Action, base: number) => number;
  /** Extra preference for a Pokémon as the Active attacker. */
  attackerBias?: (s: GameState, me: PlayerId, slot: Slot) => number;
  /** Answer a yes/no or option prompt; undefined = generic. */
  decide?: (s: GameState, me: PlayerId, source: string | undefined, prompt: string) => number | undefined;
  /** Answer any choice this deck cares about (search order, cards put on the deck…); undefined = generic. */
  choose?: (s: GameState, me: PlayerId, req: ChoiceRequest) => number[] | undefined;
}
