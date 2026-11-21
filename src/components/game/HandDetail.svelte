<script lang="ts">
  // The card picked up from your hand, as at a real table: its text to read, and what you can do with it (play it, or
  // tap the Pokémon it goes on). Cards you can't play now can be read too, with the reason (engine whyNotPlayable).
  import { fly } from 'svelte/transition';
  import { whyNotPlayable } from '../../engine/actions';
  import { keyOf } from '../../engine/state';
  import type { Action, CardId, GameState } from '../../engine/types';
  import { actionLabel, type CardActions } from '../../ui/play';
  import { motion } from '../../ui/anim/motion';
  import CardFace from './CardFace.svelte';
  import CardText from './CardText.svelte';

  let {
    s,
    card,
    actions,
    myTurn,
    onplay,
    onclose,
    onzoom,
  }: {
    s: GameState;
    card: CardId;
    actions: CardActions | undefined;
    myTurn: boolean;
    onplay: (a: Action) => void;
    onclose: () => void;
    onzoom: (key: string) => void;
  } = $props();
  const k = $derived(keyOf(s, card));
  const why = $derived(myTurn && !actions ? whyNotPlayable(s, card) : null);
</script>

<aside class="detail" aria-label="การ์ดที่หยิบจากมือ" in:fly={{ y: 18, duration: motion(200) }}>
  <button type="button" class="img" onclick={() => onzoom(k)} title="ดูใบใหญ่"><CardFace cardKey={k} /></button>
  <div class="body">
    <div class="scroll"><CardText cardKey={k} compact /></div>
    <div class="acts">
      {#if actions?.kind === 'now'}
        <button type="button" class="play" onclick={() => onplay(actions.action)}>{actionLabel(s, actions.action)}</button>
      {:else if actions?.kind === 'target'}
        <span class="hint">แตะ Pokémon ที่ไฮไลต์ หรือลากการ์ดไปวาง</span>
      {:else}
        <span class="hint why" role="note">
          {#if myTurn}<strong>ใช้ตอนนี้ไม่ได้</strong>{#if why}<span>{why}</span>{/if}{:else}ยังไม่ใช่ตาคุณ{/if}
        </span>
      {/if}
      <button type="button" class="close" onclick={onclose}>ปิด</button>
    </div>
  </div>
</aside>

<style>
  .detail {
    display: grid;
    grid-template-columns: 116px 1fr;
    gap: 12px;
    width: min(420px, 100%);
    max-height: 100%;
    padding: 12px;
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--ink);
    box-shadow: 0 10px 30px #0006;
    border: 1px solid var(--line);
  }
  .img {
    align-self: start;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 8px;
  }
  .scroll {
    overflow-y: auto;
    max-height: 210px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: auto;
  }
  .hint {
    flex: 1;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  /* Can't be played now: what stops it, on a soft red. */
  .hint.why {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 10px;
    border-left: 3px solid var(--stamp);
    border-radius: 2px;
    background: color-mix(in srgb, var(--stamp) 8%, transparent);
    color: var(--ink);
    line-height: 1.35;
  }
  .hint.why strong {
    color: var(--stamp);
    font-size: 0.78rem;
  }
  .play,
  .close {
    padding: 7px 14px;
    border-radius: var(--radius);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .play {
    flex: 1;
    border: 1px solid var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .play:hover {
    border-color: var(--press);
    background: var(--press);
  }
  .close {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
  }
  @media (max-width: 600px) {
    .detail {
      grid-template-columns: 84px 1fr;
      width: 100%;
    }
    .scroll {
      max-height: 150px;
    }
  }
</style>
