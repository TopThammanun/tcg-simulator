<script lang="ts">
  // The back of a card: Prize cards, the deck, the bot's hand. The real card back (src/ui/card-back.ts),
  // or a drawn one if it can't load.
  import { CARD_BACK } from '../../ui/card-back';

  let failed = $state(false);
</script>

<span class="back" class:drawn={failed} aria-hidden="true">
  {#if failed}
    <span class="mark">◆</span>
  {:else}
    <img src={CARD_BACK} alt="" draggable="false" onerror={() => (failed = true)} />
  {/if}
</span>

<style>
  .back {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 63 / 88;
    border-radius: 5% / 3.6%;
    background: #1d2a52;
    box-shadow: 0 1px 2px #0007;
    overflow: hidden;
    container-type: inline-size;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    -webkit-user-drag: none;
    user-select: none;
  }
  .back.drawn {
    border: max(2px, 4%) solid #e9dfc6;
    background:
      radial-gradient(circle at 50% 50%, #ffffff1c 0 22%, transparent 23%),
      repeating-linear-gradient(45deg, #ffffff0d 0 1px, transparent 1px 5px),
      repeating-linear-gradient(-45deg, #ffffff0d 0 1px, transparent 1px 5px),
      linear-gradient(155deg, #2f3d5c, #1b2338 70%);
  }
  .mark {
    color: #c3352b;
    font-size: max(8px, 34cqi);
    line-height: 1;
    text-shadow: 0 1px 0 #0006;
  }
</style>
