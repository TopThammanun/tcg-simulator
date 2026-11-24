<script lang="ts">
  // A pending choice for you: pick cards, Pokémon on the board (highlighted there too), or an option. The card
  // whose effect asks is shown while it resolves. When the effect looks at a pile (req.view: a deck search shows
  // the whole deck, "look at the top N" those cards), all of it is laid out as at a real table: the cards you may
  // take lit, the rest dimmed, and any copy of a card you may take works (a search offers one card per name). Cards are
  // as big as the box allows, named underneath; confirming is done in the command bar under the table.
  import { tx } from '../../i18n';
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
    onzoom,
  }: {
    s: GameState;
    req: ChoiceRequest;
    picks: number[];
    onpick: (v: number) => void;
    onzoom: (key: string) => void;
  } = $props();

  const kind = $derived(req.options[0]?.slot !== undefined ? 'slot' : req.options[0]?.card !== undefined || req.view?.length ? 'card' : 'label');
  const counts = $derived(picks.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>()));
  const needs = $derived(
    req.min === req.max
      ? tx(`เลือก ${req.max}`, `Choose ${req.max}`)
      : req.min === 0
        ? tx(`เลือกได้ไม่เกิน ${req.max}`, `Choose up to ${req.max}`)
        : tx(`เลือก ${req.min}–${req.max}`, `Choose ${req.min}–${req.max}`),
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
      <button type="button" class="source" title={tx('การ์ดที่กำลังใช้', 'The card being played')} onclick={() => onzoom(source)}>
        <CardFace cardKey={source} />
      </button>
    {/if}
    <div class="title">
      <strong>{req.prompt}</strong>
      {#if pile}
        <span class="pile">
          {req.purpose === 'search' ? tx(`เด็คของคุณ ${pile.length} ใบ`, `Your deck: ${pile.length} cards`) : tx(`การ์ด ${pile.length} ใบบนสุดของเด็ค`, `Top ${pile.length} cards of your deck`)} · {tx(`หยิบได้ ${takeable} ใบ`, `${takeable} can be taken`)}
        </span>
      {/if}
      {#if kind !== 'label'}<span class="need">{needs} · {tx('เลือกแล้ว', 'chosen')} {picks.length}</span>{/if}
      {#if kind === 'card'}<span class="tip">{tx('กดค้างหรือคลิกขวาที่การ์ดเพื่อดูใบใหญ่ · กดยืนยันที่แถบด้านล่าง', 'Press and hold / right-click a card to see it large · confirm in the bar below')}</span>{/if}
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
          data-inspect={k}
          onclick={() => tap(c)}
          oncontextmenu={(e) => {
            e.preventDefault();
            onzoom(k);
          }}
        >
          <CardFace cardKey={k} />
          <span class="name">{def(k).name}</span>
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
          data-inspect={k}
          onclick={() => onpick(o.value)}
          oncontextmenu={(e) => {
            e.preventDefault();
            onzoom(k);
          }}
        >
          <CardFace cardKey={k} />
          <span class="name">{def(k).name}</span>
          {#if counts.has(o.value)}
            <span class="badge">{req.ordered ? picks.indexOf(o.value) + 1 : '✓'}</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else if kind === 'slot'}
    <p class="hint">{tx('แตะเลือก Pokémon ที่สว่างบนสนาม', 'Choose a lit Pokémon on the table')}{req.repeat ? tx(' (แตะตัวเดิมซ้ำได้)', ' (again for more)') : ''}</p>
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

</div>

<style>
  .choice {
    padding: 16px;
    border: 1px solid var(--line);
    background: var(--card-bg);
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius-xl);
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
    filter: drop-shadow(0 2px 4px color-mix(in srgb, var(--ink) 30%, transparent));
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
    font-size: 12px;
    color: var(--ink-soft);
    font-family: var(--font-mono);
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  /* A whole pile (a deck search): as many to a row as fit at a readable size. */
  .cards.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 10px;
  }
  .opt {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 120px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--radius);
    transition:
      transform 0.12s ease,
      opacity 0.12s ease;
  }
  .grid .opt {
    width: 100%;
  }
  .name {
    overflow: hidden;
    color: var(--ink);
    font-size: 12px;
    line-height: 16px;
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* A phone: smaller cards, so more of a deck shows at once. */
  @media (max-width: 600px) {
    .opt {
      width: 88px;
    }
    .cards.grid {
      grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
      gap: 6px;
    }
    .grid .name {
      display: none;
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
  .opt.on :global(.face) {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .badge {
    position: absolute;
    top: 4px;
    left: 4px;
    min-width: 20px;
    padding: 0 5px;
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
    font-weight: 600;
  }
  .hint {
    margin: 0 0 6px;
    font-size: 14px;
    color: var(--ink-soft);
  }
  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .lbl {
    padding: 8px 12px;
    border: 1px solid var(--line);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius);
    transition: background-color 0.3s var(--ease);
  }
  .lbl:hover {
    background: var(--control-hover);
  }
  .lbl.big {
    padding: 8px 16px;
    font-weight: 600;
  }
  .lbl.on {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .tip {
    flex-basis: 100%;
    font-size: 12px;
    line-height: 16px;
    color: var(--ink-soft);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
