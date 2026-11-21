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
    border-radius: 3px;
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
    padding: 8px 30px 8px 22px;
    border-left: 10px solid var(--c);
    background: linear-gradient(90deg, color-mix(in srgb, var(--c) 55%, #15181d), #15181df0 45%, #15181dd0);
    color: #fff;
    font-family: var(--font-heading);
    font-size: clamp(1.1rem, 3.2vw, 1.7rem);
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
    text-shadow: 0 2px 0 #0008;
    box-shadow:
      0 0 0 1px #ffffff22,
      0 14px 30px -10px #000d;
  }
  .fx-layer :global(.fx-banner.theirs) {
    border-left: 0;
    border-right: 10px solid var(--c);
    padding: 8px 22px 8px 30px;
    background: linear-gradient(270deg, color-mix(in srgb, var(--c) 55%, #15181d), #15181df0 45%, #15181dd0);
  }

  .fx-layer :global(.fx-ring) {
    border: 3px solid var(--accent);
    border-radius: 12px;
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
    border-radius: 3px;
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
    box-shadow: 0 4px 12px -4px #000c;
  }
  .fx-layer :global(.fx-tag.gold) {
    background: var(--accent);
    color: #15181d;
  }
  .fx-layer :global(.fx-tag.cond) {
    background: #6b2f8a;
    color: #fff;
  }

  /* Coins: heads gold, tails silver. */
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
    display: grid;
    place-items: center;
    border-radius: 50%;
    backface-visibility: hidden;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 700;
    box-shadow:
      inset 0 0 0 4px #0002,
      inset 0 -6px 10px #0003,
      0 8px 18px -6px #000c;
  }
  .fx-layer :global(.fx-coin-spin .heads) {
    background: radial-gradient(circle at 35% 30%, #fff3c2, var(--accent) 45%, #b8861d);
    color: #5a3d06;
  }
  .fx-layer :global(.fx-coin-spin .tails) {
    transform: rotateY(180deg);
    background: radial-gradient(circle at 35% 30%, #ffffff, #c9cdd2 45%, #7d848c);
    color: #2c3238;
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
    border-radius: 3px;
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
    border-radius: 8px;
    background: radial-gradient(circle, #ff8a7a, #e2574b 55%, #c3352b00 80%);
    mix-blend-mode: hard-light;
  }
  /* "KO" stamped in red ink. */
  .fx-layer :global(.fx-stamp) {
    padding: 0 12px;
    border: 5px solid #e2574b;
    border-radius: 8px;
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
    border-radius: 12px;
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
    background: linear-gradient(90deg, transparent, #15181de8 18%, #15181de8 82%, transparent);
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
    border-color: #e2574b66;
  }
  .fx-layer :global(.fx-turn.theirs strong) {
    color: #ffb3aa;
  }
</style>
