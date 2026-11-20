<script lang="ts">
  // A pending choice for you: pick cards, Pokémon on the board (highlighted there too), or an option. The card
  // whose effect asks is shown while it resolves. When the effect looks at a pile (req.view: a deck search shows
  // the whole deck, "look at the top N" those cards), all of it is laid out as at a real table: the cards you may
  // take lit, the rest dimmed, and any copy of a card you may take works (a search offers one card per name).
  import { fly } from 'svelte/transition';
  import { motion } from '../../ui/anim/motion';
  import { CARDS, def } from '../../engine/db';
  import { keyOf } from '../../engine/state';
  import type { CardId, ChoiceRequest, GameState } from '../../engine/types';
  import CardFace from './CardFace.svelte';

  let {
    s,
    req,
    picks,
    onpick,
    onsubmit,
    onclear,
    onzoom,
  }: {
    s: GameState;
    req: ChoiceRequest;
    picks: number[];
    onpick: (v: number) => void;
    onsubmit: () => void;
    onclear: () => void;
    onzoom: (key: string) => void;
  } = $props();

  const kind = $derived(req.options[0]?.slot !== undefined ? 'slot' : req.options[0]?.card !== undefined || req.view?.length ? 'card' : 'label');
  const ready = $derived(picks.length >= req.min && picks.length <= req.max);
  const counts = $derived(picks.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>()));
  const needs = $derived(
    req.min === req.max ? `เลือก ${req.max}` : req.min === 0 ? `เลือกได้ไม่เกิน ${req.max}` : `เลือก ${req.min}–${req.max}`,
  );

  // The pile looked at; a whole-deck search is sorted (Pokémon, Trainers, Energy, then by name), the top of the
  // deck stays in its order.
  const RANK = { pokemon: 0, trainer: 1, energy: 2 } as const;
  const pile = $derived.by(() => {
    const v = req.view;
    if (!v?.length) return null;
    if (req.purpose !== 'search') return v;
    return [...v].sort((a, b) => {
      const da = def(keyOf(s, a));
      const db = def(keyOf(s, b));
      return RANK[da.category] - RANK[db.category] || da.name.localeCompare(db.name) || a - b;
    });
  });
  const optionOf = (c: CardId): number | undefined =>
    req.options.find((o) => o.card === c)?.value ?? req.options.find((o) => o.card !== undefined && keyOf(s, o.card) === keyOf(s, c))?.value;
  const takeable = $derived(pile ? pile.filter((c) => optionOf(c) !== undefined).length : 0);
  // Which copy shows a picked option (the one you tapped; else the option's own card).
  let shownAs = $state(new Map<number, CardId>());
  $effect(() => {
    void req;
    shownAs = new Map();
  });
  const shownCopy = (v: number) => shownAs.get(v) ?? req.options.find((o) => o.value === v)?.card;
  const pickedHere = (c: CardId, v: number | undefined) => v !== undefined && counts.has(v) && shownCopy(v) === c;
  function tap(c: CardId) {
    const v = optionOf(c);
    if (v === undefined) return;
    // Another copy of a card already picked: the pick moves to it.
    if (counts.has(v) && !req.repeat && shownCopy(v) !== c) {
      shownAs = new Map(shownAs).set(v, c);
      return;
    }
    shownAs = new Map(shownAs).set(v, c);
    onpick(v);
  }

  const source = $derived(req.source && CARDS[req.source] ? req.source : null);
</script>

<div class="choice" class:zone={!!pile} role="dialog" aria-label={req.prompt} in:fly={{ y: 14, duration: motion(240) }}>
  <div class="head">
    {#if source}
      <button type="button" class="source" title="การ์ดที่กำลังใช้" onclick={() => onzoom(source)}>
        <CardFace cardKey={source} />
      </button>
    {/if}
    <div class="title">
      <strong>{req.prompt}</strong>
      {#if pile}
        <span class="pile">
          {req.purpose === 'search' ? `เด็คของคุณ ${pile.length} ใบ` : `การ์ดบนสุดของเด็ค ${pile.length} ใบ`} · เลือกได้ {takeable} ใบ
        </span>
      {/if}
      {#if kind !== 'label'}<span class="need">{needs} · เลือกแล้ว {picks.length}</span>{/if}
    </div>
  </div>

  {#if pile}
    <div class="cards grid">
      {#each pile as c (c)}
        {@const k = keyOf(s, c)}
        {@const v = optionOf(c)}
        {@const on = pickedHere(c, v)}
        <button
          type="button"
          class="opt"
          class:on
          class:off={v === undefined}
          aria-disabled={v === undefined}
          onclick={() => tap(c)}
          oncontextmenu={(e) => {
            e.preventDefault();
            onzoom(k);
          }}
        >
          <CardFace cardKey={k} />
          {#if on}
            <span class="badge">{req.ordered ? picks.indexOf(v!) + 1 : '✓'}</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else if kind === 'card'}
    <div class="cards">
      {#each req.options as o (o.value)}
        {@const k = keyOf(s, o.card!)}
        <button
          type="button"
          class="opt"
          class:on={counts.has(o.value)}
          onclick={() => onpick(o.value)}
          oncontextmenu={(e) => {
            e.preventDefault();
            onzoom(k);
          }}
        >
          <CardFace cardKey={k} />
          {#if counts.has(o.value)}
            <span class="badge">{req.ordered ? picks.indexOf(o.value) + 1 : '✓'}</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else if kind === 'slot'}
    <p class="hint">กดเลือก Pokémon ที่ไฮไลต์บนสนาม{req.repeat ? ' (กดซ้ำได้)' : ''}</p>
    <div class="labels">
      {#each req.options as o (o.value)}
        <button type="button" class="lbl" class:on={counts.has(o.value)} onclick={() => onpick(o.value)}>
          {o.label}{counts.get(o.value) ? ` ×${counts.get(o.value)}` : ''}
        </button>
      {/each}
    </div>
  {:else}
    <div class="labels">
      {#each req.options as o (o.value)}
        <button type="button" class="lbl big" class:on={counts.has(o.value)} onclick={() => onpick(o.value)}>{o.label}</button>
      {/each}
    </div>
  {/if}

  <!-- A card is marked first and confirmed (it can be looked at); a word is the answer at once. -->
  {#if kind === 'card' || !(req.max === 1 && req.min === 1)}
    <div class="actions">
      {#if pile}<span class="tip">กดค้าง / คลิกขวาที่การ์ดเพื่อดูใหญ่</span>{/if}
      <button type="button" class="ghost" onclick={onclear} disabled={picks.length === 0}>ล้าง</button>
      <button type="button" class="go" onclick={onsubmit} disabled={!ready}>
        {picks.length === 0 && req.min === 0 && kind === 'card' ? 'ไม่เอาการ์ด' : 'ยืนยัน'}
      </button>
    </div>
  {/if}
</div>

<style>
  .choice {
    padding: 12px;
    border: 2px solid var(--line);
    background: var(--card-bg);
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius);
  }
  .head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 8px;
  }
  .source {
    flex: none;
    width: 58px;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
    transform: rotate(-3deg);
    filter: drop-shadow(2px 3px 0 color-mix(in srgb, var(--ink) 30%, transparent));
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    align-items: baseline;
  }
  .title strong {
    flex-basis: 100%;
  }
  .pile,
  .need {
    font-size: 0.8rem;
    color: var(--ink-soft);
    font-family: var(--font-mono);
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 340px;
    overflow-y: auto;
  }
  .cards.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    max-height: none;
    overflow: visible;
  }
  .opt {
    position: relative;
    width: 86px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: 7px;
    transition:
      transform 0.12s ease,
      opacity 0.12s ease;
  }
  .grid .opt {
    width: 100%;
  }
  /* A phone fits more of the deck on screen with smaller cards. */
  @media (max-width: 600px) {
    .cards.grid {
      grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
      gap: 5px;
    }
  }
  .grid .opt:not(.off):hover {
    transform: translateY(-3px);
  }
  .opt.off {
    opacity: 0.32;
    filter: grayscale(0.75);
    cursor: default;
  }
  .opt.on {
    outline: 3px solid var(--stamp);
    outline-offset: 2px;
  }
  .badge {
    position: absolute;
    top: 4px;
    left: 4px;
    min-width: 20px;
    padding: 0 5px;
    background: var(--stamp);
    color: #fff;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .hint {
    margin: 0 0 6px;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .lbl {
    padding: 6px 12px;
    border: 1.5px solid var(--primary);
    background: var(--paper);
    color: var(--primary);
    font: inherit;
    cursor: pointer;
    border-radius: 999px;
  }
  .lbl.big {
    padding: 8px 16px;
    font-family: var(--font-display);
    font-weight: 600;
  }
  .lbl.on {
    background: var(--primary);
    color: var(--primary-ink);
    border-radius: 999px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .zone .actions {
    position: sticky;
    bottom: -12px;
    margin: 10px -12px -12px;
    padding: 10px 12px;
    background: var(--card-bg);
    border-top: 1.5px solid color-mix(in srgb, var(--ink) 20%, transparent);
  }
  .tip {
    margin-right: auto;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .go,
  .ghost {
    padding: 6px 16px;
    border: 1.5px solid var(--primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border-radius: 999px;
  }
  .go {
    background: var(--primary);
    color: var(--primary-ink);
    border-radius: 999px;
  }
  .ghost {
    background: transparent;
    color: var(--primary);
    border-radius: 999px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
