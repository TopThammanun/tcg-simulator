<script lang="ts">
  // The one button: white for the main action of the moment, dark for the rest, red only for what can't be taken
  // back (leaving a game). 44px tall on touch screens.
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    variant = 'default',
    size = 'md',
    wide = false,
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: 'primary' | 'default' | 'danger' | 'ghost';
    size?: 'sm' | 'md';
    /** Fill the row. */
    wide?: boolean;
    children: Snippet;
  } = $props();
</script>

<button type="button" {...rest} class={['ui-btn', variant, size, wide && 'wide', rest.class]}>{@render children()}</button>

<style>
  .ui-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    padding: 8px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
    transition:
      background-color 0.3s var(--ease),
      border-color 0.3s var(--ease),
      transform 0.3s var(--ease);
  }
  .ui-btn:hover:not(:disabled) {
    background: var(--control-hover);
  }
  .ui-btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  .ui-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .primary:hover:not(:disabled) {
    border-color: var(--press);
    background: var(--press);
  }
  .danger {
    border-color: var(--stamp);
    background: var(--stamp);
    color: #fff;
  }
  .danger:hover:not(:disabled) {
    border-color: var(--stamp-press);
    background: var(--stamp-press);
  }
  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--ink-soft);
  }
  .ghost:hover:not(:disabled) {
    background: var(--control);
    color: var(--ink-strong);
  }
  .sm {
    min-height: 32px;
    padding: 4px 12px;
  }
  .wide {
    width: 100%;
  }
  @media (pointer: coarse) {
    .ui-btn,
    .sm {
      min-height: 44px;
    }
  }
</style>
