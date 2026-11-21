<script lang="ts">
  // A card image (low or high), or a text frame when there is no image or it fails to load. The frame also
  // shows under the image until it loads (a slow connection), and a large image has the small one between.
  import { def, imageFor } from '../../engine/db';
  import { isLoaded, markLoaded } from '../../ui/images';

  let { cardKey, size = 'low', dim = false }: { cardKey: string; size?: 'low' | 'high'; dim?: boolean } = $props();

  const d = $derived(def(cardKey));
  const src = $derived(imageFor(cardKey)[size]);
  /** The small image, shown while the large one loads (usually loaded already: the card was on the table). */
  const under = $derived(size === 'high' ? imageFor(cardKey).low : undefined);
  let failed = $state(false);
  let loaded = $derived(isLoaded(src));
  $effect(() => {
    // A new card resets the error state.
    void cardKey;
    failed = false;
  });

  function onload() {
    markLoaded(src!);
    loaded = true;
  }
</script>

<div class="face" class:dim title={d.name}>
  {#if !src || failed || !loaded}
    <div class="frame">
      <strong>{d.name}</strong>
      {#if d.category === 'pokemon'}
        <span class="hp">{d.hp} HP</span>
        {#each d.attacks as a}
          <span class="atk">{a.name} {a.damage}</span>
        {/each}
      {:else}
        <span class="kind">{d.category === 'trainer' ? d.trainerType : 'Energy'}</span>
      {/if}
    </div>
  {/if}
  {#if src && !failed}
    {#if under && under !== src && !loaded}
      <img src={under} alt="" decoding="async" draggable="false" />
    {/if}
    <img {src} alt={d.name} loading="lazy" decoding="async" draggable="false" {onload} onerror={() => (failed = true)} />
  {/if}
</div>

<style>
  .face {
    position: relative;
    width: 100%;
    aspect-ratio: 63 / 88;
    border-radius: 6% / 4.3%;
    overflow: hidden;
    background: var(--card-bg);
    box-shadow: 0 1px 3px #0005;
  }
  .face.dim {
    filter: grayscale(0.85) brightness(0.75);
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    /* No alt text over the frame while it loads. */
    color: transparent;
    -webkit-user-drag: none;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .frame {
    height: 100%;
    padding: 8% 7%;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 2px solid var(--ink);
    border-radius: inherit;
    font-size: clamp(8px, 0.62em, 12px);
    line-height: 1.2;
    background: var(--card-bg);
    color: var(--ink);
  }
  strong {
    font-family: var(--font-display);
    font-size: 1.15em;
  }
  .hp {
    color: var(--stamp);
    font-family: var(--font-mono);
  }
  .atk,
  .kind {
    color: var(--ink-soft);
  }
</style>
