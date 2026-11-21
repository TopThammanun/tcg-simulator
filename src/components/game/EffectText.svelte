<script lang="ts">
  // Card text with its {G}, {C}… drawn as Energy symbols.
  import { energyParts } from '../../ui/symbols';
  import Energy from './Energy.svelte';

  let { text }: { text: string } = $props();
</script>

{#each energyParts(text) as p}{#if 'type' in p}<Energy type={p.type} />{:else}{p.text}{/if}{/each}
