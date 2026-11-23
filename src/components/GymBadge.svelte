<script lang="ts">
  // A gym badge: one original shape per Gym Leader (the meta decks, by rank: lib/decks.ts gymLeaders), in the type
  // colour of the deck's headline Pokémon. Earned (you beat that deck) it is a flat, layered medal; not yet, an outline.
  // Rendered static by Astro pages (DeckCard) and live in the game list's badge case.
  let { shape = 0, type = 'Colorless', earned = true, size = 40, label }: { shape?: number; type?: string; earned?: boolean; size?: number; label?: string } =
    $props();

  /** Hexagon, diamond, shield, octagon, star, pentagon, kite, triangle (viewBox 0 0 40 40, centred on 20,20). */
  const SHAPES = [
    'M20 3L34.72 11.5V28.5L20 37L5.28 28.5V11.5Z',
    'M20 2L37 20L20 38L3 20Z',
    'M20 3L34 8V19C34 28 28 34 20 37C12 34 6 28 6 19V8Z',
    'M26.51 4.29L35.71 13.49V26.51L26.51 35.71H13.49L4.29 26.51V13.49L13.49 4.29Z',
    'M20 2L24.7 13.53L37.12 14.44L27.61 22.47L30.58 34.56L20 28L9.42 34.56L12.39 22.47L2.88 14.44L15.3 13.53Z',
    'M20 3L36.17 14.75L29.99 33.75H10.01L3.83 14.75Z',
    'M20 2L34 14L20 38L6 14Z',
    'M20 3L37 35H3Z',
  ];
  const d = $derived(SHAPES[((shape % SHAPES.length) + SHAPES.length) % SHAPES.length]!);
  const colour = $derived(`var(--t-${type.toLowerCase()}, var(--gym))`);
</script>

<svg
  class="gym-badge"
  class:earned
  viewBox="0 0 40 40"
  width={size}
  height={size}
  style:--c={colour}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <path class="rim" {d} />
  <path class="face" {d} transform="translate(20 20) scale(0.66) translate(-20 -20)" />
  <path class="core" {d} transform="translate(20 20) scale(0.3) translate(-20 -20)" />
</svg>

<style>
  .gym-badge {
    display: block;
    flex: none;
    overflow: visible;
  }
  /* Not yet earned: the shape in outline, no colour. */
  .rim {
    fill: var(--raised);
    stroke: var(--line-strong);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .face {
    fill: none;
    stroke: var(--line);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .core {
    fill: var(--line);
  }
  /* Earned: a flat medal in the type's colour, a light rim and a dark face around a bright core. */
  .earned .rim {
    fill: var(--c);
    stroke: color-mix(in srgb, var(--c) 55%, #ffffff);
  }
  .earned .face {
    fill: color-mix(in srgb, var(--c) 62%, #000000);
    stroke: none;
  }
  .earned .core {
    fill: color-mix(in srgb, var(--c) 45%, #ffffff);
  }
</style>
