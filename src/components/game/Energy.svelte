<script lang="ts">
  // One Energy symbol as printed on the cards (src/ui/symbols.ts), sized by the text around it.
  import { energyIcon } from '../../ui/symbols';

  let { type }: { type: string } = $props();
</script>

<i class="energy" role="img" aria-label={type} title={type} style:background-image={`url(${energyIcon(type)})`}></i>

<style>
  .energy {
    display: inline-block;
    flex: 0 0 auto;
    width: 1.2em;
    height: 1.2em;
    border-radius: 50%;
    background: center / cover no-repeat;
    box-shadow: 0 0 0 1px #0008;
    vertical-align: -0.22em;
  }
</style>
