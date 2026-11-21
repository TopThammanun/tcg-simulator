<svelte:options runes={true} />

<script lang="ts">
  // ประวัติเกม: the game list (GameList.svelte), or one game's review with ?id= (GameReview.svelte).
  import GameList from './GameList.svelte';
  import GameReview from './GameReview.svelte';

  const raw = new URLSearchParams(location.search).get('id');
  const id = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
</script>

{#if id === null}<GameList />{:else}<GameReview {id} />{/if}
