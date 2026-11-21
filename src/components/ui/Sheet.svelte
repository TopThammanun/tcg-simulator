<script lang="ts">
  // A panel for a short task over the page: a sheet from the bottom edge on phones, a panel by the top left on wider
  // screens. A scrim behind it, a visible close button, Esc / a tap outside closes; never two at once (NN/g).
  import { tx } from '../../i18n';
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { motion } from '../../ui/anim/motion';
  import IconButton from './IconButton.svelte';

  let {
    title,
    onclose,
    side = 'left',
    children,
  }: { title: string; onclose: () => void; side?: 'left' | 'right'; children: Snippet } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), onclose())} />

<div class="scrim" role="presentation" onclick={onclose} transition:fade={{ duration: motion(160) }}></div>
<div class={['ui-sheet', side]} role="dialog" aria-modal="true" aria-label={title} transition:fly={{ y: 24, duration: motion(220) }}>
  <header>
    <strong>{title}</strong>
    <IconButton icon="close" label={tx('ปิด', 'Close')} onclick={onclose} />
  </header>
  <div class="body">{@render children()}</div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 55;
    background: #000000a6;
  }
  .ui-sheet {
    position: fixed;
    top: 12px;
    z-index: 56;
    display: flex;
    flex-direction: column;
    width: min(360px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
    box-shadow: var(--shadow-lg);
  }
  .left {
    left: 12px;
  }
  .right {
    right: 12px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 8px 8px 16px;
    border-bottom: 1px solid var(--rule);
  }
  header strong {
    color: var(--ink-strong);
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
  }
  .body {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px;
  }
  /* Phones: from the bottom edge, full width, where the thumb is. */
  @media (max-width: 700px) {
    .ui-sheet {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      max-height: 85dvh;
      border-bottom: 0;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
</style>
