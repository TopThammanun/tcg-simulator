<script lang="ts">
  // Taking Prize cards after a Knock Out (engine/rules.ts takePrizes): the whole screen, your six Prize spots as
  // large face-down cards in the order they lie on the mat, a taken one leaving its gap. One to take: a tap takes
  // it. More: tap to mark, then confirm.
  import { tx } from '../../i18n';
  import { fade, fly } from 'svelte/transition';
  import type { ChoiceRequest } from '../../engine/types';
  import { motion } from '../../ui/anim/motion';
  import CardBack from './CardBack.svelte';

  let {
    req,
    knockedOut,
    grid,
    picks,
    onpick,
    onsubmit,
    onclear,
  }: {
    req: ChoiceRequest;
    /** The names of the bot's Pokémon Knocked Out. */
    knockedOut: string[];
    /** Your Prize spots: the Prize pile's index at each, or null where one was taken. */
    grid: (number | null)[];
    picks: number[];
    onpick: (index: number) => void;
    onsubmit: () => void;
    onclear: () => void;
  } = $props();

  const take = $derived(req.min);
  const left = $derived(grid.filter((at) => at !== null).length);
  const single = $derived(req.min === 1 && req.max === 1);
  const ready = $derived(picks.length === take);
</script>

<div class="prize-pick dark" role="dialog" aria-modal="true" aria-label={tx('เลือก Prize', 'Choose Prize cards')} transition:fade={{ duration: motion(180) }}>
  <header>
    <p class="kicker">{knockedOut.length ? tx(`${knockedOut.join(', ')} ของบอทถูก Knock Out`, `The bot's ${knockedOut.join(', ')} Knocked Out`) : 'Knock Out'}</p>
    <h2>{tx(`เลือก Prize ${take} ใบ`, `Choose ${take} Prize ${take === 1 ? 'card' : 'cards'}`)}</h2>
    <p class="how">
      {tx('การ์ดคว่ำอยู่ทุกใบ เลือกใบไหนก็ได้ ใบที่เลือกจะเข้ามือ ·', 'Every card is face down: pick any, they go into your hand ·')}
      {tx('เหลือ', '')} <span class="mono">{left}</span> {tx('ใบ เก็บแล้วจะเหลือ', 'left, then')} <span class="mono">{left - take}</span>
    </p>
  </header>

  <div class="grid">
    {#each grid as at, i (i)}
      {#if at === null}
        <span class="gap" aria-hidden="true"></span>
      {:else}
        <button
          type="button"
          class="pz"
          class:on={picks.includes(at)}
          aria-label={tx(`เก็บ Prize ใบที่ ${i + 1}`, `Take Prize card ${i + 1}`)}
          aria-pressed={single ? undefined : picks.includes(at)}
          aria-keyshortcuts={String(i + 1)}
          onclick={() => onpick(at)}
          in:fly={{ y: 16, duration: motion(260), delay: motion(60 + i * 40) }}
        >
          <CardBack />
          <span class="no mono" aria-hidden="true">{i + 1}</span>
          {#if picks.includes(at)}<span class="tick" aria-hidden="true">✓</span>{/if}
        </button>
      {/if}
    {/each}
  </div>

  <footer>
    {#if single}
      <p class="hint">{tx('แตะการ์ดใบที่จะเก็บ', 'Tap the card to take')}<span class="keys">{tx(' (หรือกดเลข 1–6)', ' (or press 1–6)')}</span></p>
    {:else}
      <p class="hint">{tx('เลือกแล้ว', 'Chosen')} <span class="mono">{picks.length}/{take}</span></p>
      <button type="button" class="ghost" onclick={onclear} disabled={picks.length === 0}>{tx('ล้าง', 'Clear')}</button>
      <button type="button" class="go" onclick={onsubmit} disabled={!ready}>{tx(`เก็บ ${take} ใบ`, `Take ${take}`)}</button>
    {/if}
  </footer>
</div>

<style>
  .prize-pick {
    position: fixed;
    inset: 0;
    z-index: 44;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--paper) 94%, transparent);
    color: var(--ink);
    text-align: center;
    overflow-y: auto;
  }
  header {
    max-width: 40rem;
  }
  .kicker {
    margin: 0 0 4px;
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  h2 {
    margin: 0 0 6px;
    color: #fff;
    font-size: 30px;
  }
  .how {
    margin: 0;
    color: var(--ink-soft);
    font-size: 16px;
  }
  /* Three by two on a wide screen, two by three when it stands up; the card size fits both ways. */
  .grid {
    --cols: 3;
    --rows: 2;
    --gap: 16px;
    --w: min(
      190px,
      calc((100vw - 48px - (var(--cols) - 1) * var(--gap)) / var(--cols)),
      calc((100dvh - 250px - (var(--rows) - 1) * var(--gap)) / var(--rows) * 63 / 88)
    );
    display: grid;
    grid-template-columns: repeat(var(--cols), var(--w));
    gap: var(--gap);
  }
  @media (orientation: portrait) {
    .grid {
      --cols: 2;
      --rows: 3;
      --gap: 12px;
    }
  }
  .pz,
  .gap {
    position: relative;
    display: block;
    width: var(--w);
    aspect-ratio: 63 / 88;
    border-radius: 6% / 4.3%;
  }
  .pz {
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    box-shadow: 0 10px 24px -12px #000;
    transition:
      transform 0.14s ease,
      box-shadow 0.14s ease;
  }
  .pz:hover,
  .pz:focus-visible {
    transform: translateY(-6px);
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
  .pz.on {
    transform: translateY(-10px);
    outline: 3px solid var(--accent);
    outline-offset: 3px;
    box-shadow: 0 18px 30px -12px #000;
  }
  .no {
    position: absolute;
    left: 6px;
    top: 6px;
    min-width: 22px;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    background: #000b;
    color: #fff;
    font-size: 12px;
  }
  .tick {
    position: absolute;
    left: 50%;
    top: 50%;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    translate: -50% -50%;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 24px;
    font-weight: 700;
  }
  .gap {
    outline: 1px dashed #ffffff33;
    outline-offset: -1px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 10px 12px;
  }
  .hint {
    margin: 0;
    color: var(--ink-soft);
    font-size: 14px;
  }
  /* No keyboard on a touch screen. */
  @media (hover: none) {
    .keys {
      display: none;
    }
  }
  .go,
  .ghost {
    padding: 9px 22px;
    border-radius: var(--radius);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .go {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .ghost {
    border: 1px solid #ffffff40;
    background: transparent;
    color: var(--ink);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
