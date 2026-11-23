<svelte:options runes={true} />

<script lang="ts">
  // ประวัติเกม: the game list (GameList.svelte), or one game's review with ?id= (GameReview.svelte).
  import { langOfPath, setLang } from '../../i18n';
  import GameList, { type Gym } from './GameList.svelte';
  import GameReview from './GameReview.svelte';

  let { gyms = [] }: { gyms?: Gym[] } = $props();

  // The page's language (/en/review/ is English): the replays, the analysis and every label read it.
  setLang(langOfPath(location.pathname));

  const raw = new URLSearchParams(location.search).get('id');
  const id = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
</script>

{#if id === null}<GameList {gyms} />{:else}<GameReview {id} />{/if}
