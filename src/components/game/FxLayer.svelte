<script lang="ts">
  // The overlay the play-screen animations draw on (src/ui/anim/fx.ts). Clicks pass through it.
  let { layer = $bindable() }: { layer?: HTMLDivElement } = $props();
</script>

<div class="fx-layer" bind:this={layer} aria-hidden="true"></div>

<style>
  /* Animations off: CSS animations and transitions end at once too (looping pulses stop on their end frame). */
  :global(html[data-anim='off'] *),
  :global(html[data-anim='off'] *::before),
  :global(html[data-anim='off'] *::after) {
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
  }
  .fx-layer {
    position: fixed;
    inset: 0;
    z-index: 55;
    pointer-events: none;
    overflow: hidden;
  }
  .fx-layer :global(> *) {
    position: absolute;
    will-change: transform, opacity;
  }

  /* A flying card: front and back, flipped with rotateY on the inner box. */
  .fx-layer :global(.fx-card) {
    perspective: 900px;
  }
  .fx-layer :global(.fx-inner) {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
  }
  .fx-layer :global(.fx-front),
  .fx-layer :global(.fx-back) {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 6% / 4.3%;
    backface-visibility: hidden;
    box-shadow: 0 10px 22px -8px #000c;
  }
  .fx-layer :global(.fx-front) {
    display: grid;
    place-items: center;
    padding: 6%;
    background: var(--card-bg);
    color: var(--ink);
    font-size: 0.7rem;
    text-align: center;
  }
  .fx-layer :global(.fx-front img),
  .fx-layer :global(.fx-back img) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .fx-layer :global(.fx-back) {
    display: grid;
    place-items: center;
    transform: rotateY(180deg);
    border-radius: 5% / 3.6%;
    background: #1d2a52;
    color: #c3352b;
    font-size: 1.2rem;
  }
  /* The drawn back, when the real one can't load. */
  .fx-layer :global(.fx-back:has(> span)) {
    border: max(2px, 4%) solid #e9dfc6;
    background:
      radial-gradient(circle at 50% 50%, #ffffff1c 0 22%, transparent 23%),
      repeating-linear-gradient(45deg, #ffffff0d 0 1px, transparent 1px 5px),
      repeating-linear-gradient(-45deg, #ffffff0d 0 1px, transparent 1px 5px),
      linear-gradient(155deg, #2f3d5c, #1b2338 70%);
    color: #c3352b;
    font-size: 1.2rem;
  }

  .fx-layer :global(.fx-stage-label) {
    transform: translateX(-50%);
    padding: 4px 14px;
    border-radius: var(--radius-sm);
    background: #15181de6;
    color: #fff;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
    box-shadow: 0 6px 16px -6px #000c;
  }

  /* Attack name: a slanted strip with the attacker's type colour. */
  .fx-layer :global(.fx-banner) {
    padding: 8px 24px;
    border: 1px solid color-mix(in srgb, var(--c) 70%, #fff);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--c) 30%, #000000f0);
    color: #fff;
    font-size: 24px;
    line-height: 32px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: var(--shadow-lg);
  }

  .fx-layer :global(.fx-ring) {
    border: 3px solid var(--accent);
    border-radius: var(--radius-lg);
    box-shadow:
      0 0 18px var(--accent),
      inset 0 0 12px color-mix(in srgb, var(--accent) 53%, transparent);
  }
  .fx-layer :global(.fx-ring.red) {
    border-color: #ff5a4a;
    box-shadow:
      0 0 22px #ff5a4a,
      inset 0 0 16px #ff5a4a88;
  }
  .fx-layer :global(.fx-tag) {
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
    box-shadow: 0 4px 12px -4px #000c;
  }
  .fx-layer :global(.fx-tag.gold) {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .fx-layer :global(.fx-tag.cond) {
    background: #6b2f8a;
    color: #fff;
  }

  /* Coins (src/ui/symbols.ts): gold heads, silver tails. */
  .fx-layer :global(.fx-coin) {
    perspective: 500px;
  }
  .fx-layer :global(.fx-coin-spin) {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
  }
  .fx-layer :global(.fx-coin-spin span) {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: center / cover no-repeat;
    backface-visibility: hidden;
    box-shadow: 0 8px 18px -6px #000c;
  }
  .fx-layer :global(.fx-coin-spin .tails) {
    transform: rotateY(180deg);
  }
  .fx-layer :global(.fx-coin-label) {
    position: absolute;
    left: 50%;
    top: calc(100% + 8px);
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    background: #15181de6;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 4px 12px -4px #000c;
  }

  /* A hit: a burst in the attacker's type colour with shards. */
  .fx-layer :global(.fx-burst) {
    background: radial-gradient(circle, #fff 0 8%, color-mix(in srgb, var(--c) 60%, #fff) 16%, var(--c) 30%, transparent 62%);
    mix-blend-mode: screen;
  }
  .fx-layer :global(.fx-burst i) {
    position: absolute;
    left: calc(50% - 3px);
    top: 50%;
    width: 6px;
    height: 34%;
    border-radius: var(--radius-sm);
    background: linear-gradient(#fff, var(--c));
    transform-origin: 50% 0;
    transform: rotate(var(--a)) translateY(18%);
  }
  .fx-layer :global(.fx-num) {
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 4.5vw, 2.4rem);
    font-weight: 700;
    line-height: 1;
    color: #fff;
    -webkit-text-stroke: 2px #8f1d15;
    paint-order: stroke fill;
    text-shadow: 0 3px 0 #8f1d15, 0 6px 14px #000a;
    white-space: nowrap;
  }
  .fx-layer :global(.fx-num.heal) {
    -webkit-text-stroke-color: #1f6b34;
    text-shadow: 0 3px 0 #1f6b34, 0 6px 14px #000a;
  }

  .fx-layer :global(.fx-ko-flash) {
    border-radius: var(--radius);
    background: radial-gradient(circle, #ff8a7a, #e2574b 55%, #c3352b00 80%);
    mix-blend-mode: hard-light;
  }
  /* "KO" stamped in red ink. */
  .fx-layer :global(.fx-stamp) {
    padding: 0 12px;
    border: 5px solid #e2574b;
    border-radius: var(--radius);
    color: #e2574b;
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 5vw, 2.8rem);
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 1.2;
    background: #15181d55;
    text-shadow: 0 2px 0 #0006;
    box-shadow: 0 0 0 2px #0004;
  }
  .fx-layer :global(.fx-evolve) {
    border-radius: var(--radius-lg);
    background: radial-gradient(circle, #fff 0 25%, #fffbe8cc 45%, color-mix(in srgb, var(--accent) 0%, transparent) 72%);
    box-shadow: 0 0 40px 10px #fff8;
  }

  /* Turn banner across the table. */
  .fx-layer :global(.fx-turn) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 10px 0;
    background: #000000e0;
    border-top: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    color: #fff;
  }
  .fx-layer :global(.fx-turn small) {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    opacity: 0.8;
  }
  .fx-layer :global(.fx-turn strong) {
    font-family: var(--font-heading);
    font-size: clamp(1.5rem, 5vw, 2.3rem);
    line-height: 1.1;
  }
  .fx-layer :global(.fx-turn.mine strong) {
    color: var(--accent);
  }
  .fx-layer :global(.fx-turn.theirs) {
    border-color: #5b9bff66;
  }
  .fx-layer :global(.fx-turn.theirs strong) {
    color: #a9c9ff;
  }
</style>
