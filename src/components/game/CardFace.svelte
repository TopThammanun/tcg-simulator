<script lang="ts">
  // A card image (low or high), or a text frame when there is no image or it fails to load.
  import { def, imageFor } from '../../engine/db';

  let { cardKey, size = 'low', dim = false }: { cardKey: string; size?: 'low' | 'high'; dim?: boolean } = $props();

  const d = $derived(def(cardKey));
  const src = $derived(imageFor(cardKey)[size]);
  let failed = $state(false);
  $effect(() => {
    // A new card resets the error state.
    void cardKey;
    failed = false;
  });
</script>

<div class="face" class:dim title={d.name}>
  {#if src && !failed}
    <img {src} alt={d.name} loading="lazy" decoding="async" draggable="false" onerror={() => (failed = true)} />
  {:else}
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
</div>

<style>
  .face {
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
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
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
