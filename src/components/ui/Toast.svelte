<script lang="ts">
  // A short message at the bottom of the screen with one action ("เลิกทำ"); it goes by itself (the caller decides when).
  import { fly } from 'svelte/transition';
  import { motion } from '../../ui/anim/motion';
  import Button from './Button.svelte';

  let { message, action, onaction }: { message: string; action?: string; onaction?: () => void } = $props();
</script>

<div class="ui-toast" role="status" transition:fly={{ y: 16, duration: motion(200) }}>
  <span>{message}</span>
  {#if action}<Button variant="primary" size="sm" onclick={onaction}>{action}</Button>{/if}
</div>

<style>
  .ui-toast {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom));
    z-index: 50;
    display: flex;
    gap: 16px;
    align-items: center;
    width: max-content;
    max-width: calc(100vw - 32px);
    padding: 8px 8px 8px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--raised);
    box-shadow: var(--shadow-lg);
    font-size: 14px;
    line-height: 20px;
    translate: -50% 0;
  }
</style>
