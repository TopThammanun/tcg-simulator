// When the analyser applies, apart from threat.ts so the play page can ask without loading the bots.
import type { GameState, PlayerId } from '../engine/types';

/** Can the threat be read in this position (your main phase, nothing pending, game on)? */
export function canAnalyse(s: GameState, me: PlayerId): boolean {
  return s.winner === null && !s.pending && s.phase === 'main' && s.current === me;
}
