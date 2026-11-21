<script lang="ts">
  // The card text panel at the top of the side column (computers): the card under the mouse (a moment's hover over any
  // face-up card: the table, your hand, a discard pile, a choice), or the card picked up from your hand, large enough
  // to read, with its state in play for a Pokémon on the table (ui/slot-info.ts). It keeps the last card shown.
  import { tx } from '../../i18n';
  import type { SlotInfo } from '../../ui/slot-info';
  import CardFace from './CardFace.svelte';
  import CardText from './CardText.svelte';
  import SlotState from './SlotState.svelte';

  let {
    cardKey,
    info = null,
    held = false,
    onzoom,
  }: {
    cardKey: string | null;
    info?: SlotInfo | null;
    /** The card is the one picked up from your hand. */
    held?: boolean;
    onzoom: (key: string) => void;
  } = $props();
</script>

<section class="inspector" aria-label={tx('อ่านการ์ด', 'Card text')}>
  {#if cardKey}
    {#if held}<p class="tag">{tx('การ์ดที่หยิบจากมือ', 'Picked up from your hand')}</p>{/if}
    {#if info}<SlotState {info} />{/if}
    <div class="body">
      <button type="button" class="img" onclick={() => onzoom(cardKey)} title={tx('ดูใบใหญ่', 'See it large')}><CardFace {cardKey} /></button>
      <CardText {cardKey} compact />
    </div>
  {:else}
    <p class="empty">{tx('ชี้เมาส์ที่การ์ดใบไหนก็ได้เพื่ออ่านข้อความเต็มตรงนี้', 'Point at any card to read its full text here')}</p>
  {/if}
</section>

<style>
  .inspector {
    flex: 0 1 auto;
    min-height: 120px;
    max-height: 62%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
  }
  .tag {
    margin: 0 0 8px;
    color: var(--accent);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
  }
  .body {
    display: flow-root;
  }
  .img {
    float: left;
    width: 112px;
    margin: 0 12px 8px 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .inspector :global(.state) {
    margin-bottom: 12px;
    padding: 8px 10px;
  }
  .body :global(p:last-child) {
    margin-bottom: 0;
  }
  .empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
  }
</style>
