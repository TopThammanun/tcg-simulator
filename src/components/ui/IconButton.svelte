<script lang="ts">
  // A square button with a drawn icon and no text (its name is the aria-label): close, the game menu, the log.
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    icon,
    label,
    ...rest
  }: HTMLButtonAttributes & { icon: 'close' | 'menu' | 'log'; label: string } = $props();

  const PATHS = {
    close: 'M6 6l12 12M18 6L6 18',
    menu: 'M4 7h16M4 12h16M4 17h16',
    log: 'M5 6h14M5 10h14M5 14h10M5 18h7',
  } as const;
</script>

<button type="button" aria-label={label} title={rest.title ?? label} {...rest} class={['ui-icon', rest.class]}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[icon]} /></svg>
</button>

<style>
  .ui-icon {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    transition:
      color 0.3s var(--ease),
      background-color 0.3s var(--ease);
  }
  .ui-icon:hover {
    background: var(--control);
    color: var(--ink-strong);
  }
  .ui-icon[aria-expanded='true'] {
    background: var(--control);
    color: var(--ink-strong);
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  @media (pointer: coarse) {
    .ui-icon {
      width: 44px;
      height: 44px;
    }
  }
</style>
