// Drag and drop on the play screen. Drop zones are named strings set as data-drop on the board:
// `slot:<uid>` for a Pokémon in play, `active` / `bench` for your spots, `play` for the whole board.
import type { Action, CardId, ChoiceRequest, GameState, SlotId } from '../engine/types';
import { targetOf, type CardActions } from './play';

/** Where a card from your hand can be dropped, and the action each drop does. */
export function handDrops(ca: CardActions | undefined): Map<string, Action> {
  const out = new Map<string, Action>();
  if (!ca) return out;
  if (ca.kind === 'target') {
    for (const a of ca.actions) out.set(`slot:${targetOf(a)}`, a);
  } else {
    // A Basic goes to the Bench; dropped anywhere else on the board it goes there too.
    if (ca.action.t === 'bench') out.set('bench', ca.action);
    out.set('play', ca.action);
  }
  return out;
}

/** Dragging one of your Pokémon: the Active onto a Benched one, or a Benched one onto the Active, retreats. */
export function slotDrops(s: GameState, legal: Action[], uid: SlotId): Map<string, Action> {
  const out = new Map<string, Action>();
  const active = s.players[s.current].active;
  if (!active) return out;
  for (const a of legal) {
    if (a.t !== 'retreat') continue;
    if (uid === active.uid) out.set(`slot:${a.to}`, a);
    else if (a.to === uid) {
      out.set(`slot:${active.uid}`, a);
      out.set('active', a);
    }
  }
  return out;
}

/** During setup, Basics in your hand can be dropped on the Active Spot or the Bench (the option value). */
export function setupDrops(req: ChoiceRequest | null, card: CardId): Map<string, number> {
  const out = new Map<string, number>();
  const zone = req?.purpose === 'setup-active' ? 'active' : req?.purpose === 'setup-bench' ? 'bench' : null;
  const option = req?.options.find((o) => o.card === card);
  if (zone && option) out.set(zone, option.value);
  return out;
}

/** The innermost zone under the pointer (chain is innermost first) that accepts this drop. */
export function pickDrop(chain: string[], drops: Map<string, unknown>): string | null {
  return chain.find((z) => drops.has(z)) ?? null;
}

/** Zones under a screen point, innermost first. */
export function zonesAt(x: number, y: number): string[] {
  const out: string[] = [];
  let el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  while (el) {
    out.push(el.dataset.drop!);
    el = el.parentElement?.closest<HTMLElement>('[data-drop]') ?? null;
  }
  return out;
}
