// The animation setting for Svelte transitions and CSS: <html data-anim="full|fast|off">.
import type { AnimLevel } from './fx';

export function setAnimLevel(level: AnimLevel): void {
  document.documentElement.dataset.anim = level;
}

/** A transition duration under the current setting (0 when animations are off). */
export function motion(ms: number): number {
  const level = document.documentElement.dataset.anim;
  return level === 'off' ? 0 : level === 'fast' ? ms * 0.5 : ms;
}
