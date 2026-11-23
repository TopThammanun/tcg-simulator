<script lang="ts">
  // The deck builder (/builder/), laid out and used like Limitless's (my.limitlesstcg.com/builder): the deck on the
  // left as card pictures with their counts, grouped Pokémon / Trainer / Energy and kept sorted; the card search on the
  // right with Limitless's filter chips. A card is added with its + (or a right-click, Ctrl+right-click for four, or
  // dragged into the deck) and taken out with its − (or a right-click in the deck); a click opens it to read. Keys
  // while the mouse is on a card: + / a, − / r, 0–9 sets the count; Space searches, H the help, Ctrl+Z undoes.
  // Phones get the two halves as tabs and the −/+ always shown. The list is saved as text with your decks
  // (ui/my-decks.ts), imported from and copied as the text Limitless and Pokémon TCG Live export (ui/builder.ts).
  import { untrack } from 'svelte';
  import type { EnergyType } from '../../data/cards';
  import { href, langOfPath, setLang, tx } from '../../i18n';
  import {
    addCard,
    cardOf,
    CHIPS,
    countOf,
    deckKeys,
    DECK_SIZE,
    fromText,
    hints,
    POKEMON_TYPES,
    problems,
    removeCard,
    searchCards,
    sections,
    setCount,
    toText,
    total,
    type BuildLine,
    type Chip,
    type Imported,
  } from '../../ui/builder';
  import { SUPPORTED } from '../../ui/decklist';
  import { nearestDeck, type MetaDeck } from '../../ui/decks';
  import { loadMyDecks, saveMyDeck } from '../../ui/my-decks';
  import CardFace from '../game/CardFace.svelte';
  import CardText from '../game/CardText.svelte';
  import Energy from '../game/Energy.svelte';
  import Toast from '../ui/Toast.svelte';

  setLang(langOfPath(location.pathname));

  let { decks }: { decks: (MetaDeck & { text: string })[] } = $props();

  // The deck to open: one of yours (?id=), a meta deck's list to start from (?from=), or a new one.
  const params = new URLSearchParams(location.search);
  const opened = params.get('id') ? loadMyDecks().find((d) => d.id === params.get('id')) : undefined;
  const from = untrack(() => decks.find((d) => d.slug === params.get('from')));
  const mine = (d: { name: string }) => tx(`${d.name} (ของฉัน)`, `${d.name} (mine)`);

  let id = $state(opened?.id);
  let name = $state(opened?.name ?? (from ? mine(from) : ''));
  let deck = $state<BuildLine[]>(fromText(opened?.text ?? from?.text ?? '').deck);
  /** What was last saved: the page warns before leaving unsaved changes. */
  let savedText = $state(opened ? toText(fromText(opened.text).deck) : '');
  let savedName = $state(opened?.name ?? '');
  const dirty = $derived(deck.length > 0 && (toText(deck) !== savedText || name !== savedName));
  /** Earlier versions of the deck, for undo. */
  let past = $state<BuildLine[][]>([]);

  let query = $state('');
  let chips = $state<Chip[]>([]);
  let types = $state<EnergyType[]>([]);
  const results = $derived(searchCards(query, chips, types));

  const VIEW_KEY = 'tcg-sim:builder-view';
  let view = $state<'grid' | 'list'>(readView());
  /** Phones: one half at a time. */
  let tab = $state<'deck' | 'search'>(opened || from ? 'deck' : 'search');
  /** The card open to read, and the cards ← / → go through. */
  let detail = $state<{ key: string; list: string[] } | null>(null);
  let help = $state(false);
  let importing = $state<string | null>(null);
  /** What an import left out, shown over the deck until closed. */
  let report = $state<Imported | null>(null);
  let toast = $state<{ message: string; action?: string; onaction?: () => void } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** The card under the mouse: the keys act on it. */
  let hovered: string | null = null;
  let searchBox = $state<HTMLInputElement>();

  const count = $derived(total(deck));
  const parts = $derived(sections(deck));
  const wrong = $derived(problems(deck));
  const notes = $derived(hints(deck));
  const near = $derived(wrong.length ? null : nearestDeck(deckKeys(deck), decks));
  const deckOrder = $derived(parts.flatMap((s) => s.lines.map((l) => l.key)));

  function readView(): 'grid' | 'list' {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  }

  function setView(v: 'grid' | 'list') {
    view = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage blocked: the view lasts this visit */
    }
  }

  function say(message: string, action?: string, onaction?: () => void) {
    toast = { message, action, onaction };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), action ? 5000 : 2600);
  }

  /** A new version of the deck (undoable). */
  function commit(next: BuildLine[]) {
    past = [...past.slice(-99), deck];
    deck = next;
  }

  function undo() {
    const prev = past.at(-1);
    if (!prev) return;
    past = past.slice(0, -1);
    deck = prev;
  }

  function apply(r: { deck: BuildLine[]; refused?: string }) {
    if (toText(r.deck) !== toText(deck)) commit(r.deck);
    if (r.refused) say(r.refused);
  }

  const change = (key: string, n: number) => apply(n > 0 ? addCard(deck, key, n) : removeCard(deck, key, -n));
  const set = (key: string, n: number) => apply(setCount(deck, key, n));

  /** Replace the whole deck (a meta list, an import, clearing it), with undo in the message. */
  function replace(next: BuildLine[], message: string) {
    const before = deck;
    commit(next);
    say(message, before.length ? tx('เลิกทำ', 'Undo') : undefined, () => {
      undo();
      toast = null;
    });
  }

  function startFrom(slug: string) {
    const d = decks.find((x) => x.slug === slug);
    if (!d) return;
    replace(fromText(d.text).deck, tx(`ใส่ list ของ ${d.name} แล้ว`, `${d.name}'s list is in`));
    if (!name.trim()) name = mine(d);
    tab = 'deck';
  }

  function runImport() {
    const r = fromText(importing ?? '');
    importing = null;
    replace(r.deck, tx(`นำเข้าแล้ว ${total(r.deck)} ใบ`, `${total(r.deck)} cards imported`));
    report = r.unsupported.length || r.ambiguous.length || r.unreadable.length || r.refused.length ? r : null;
    tab = 'deck';
  }

  async function copyList() {
    const text = toText(deck);
    try {
      await navigator.clipboard.writeText(text);
      say(tx('คัดลอก list แล้ว วางใน Limitless หรือ Pokémon TCG Live ได้เลย', 'List copied: paste it into Limitless or Pokémon TCG Live'));
    } catch {
      importing = text; // no clipboard: the list in the import box, to copy by hand
    }
  }

  function save(): string {
    const d = saveMyDeck({ id, name, text: toText(deck) });
    id = d.id;
    name = d.name;
    savedText = toText(deck);
    savedName = d.name;
    history.replaceState(null, '', `${location.pathname}?id=${d.id}`);
    say(wrong.length ? tx('บันทึกแล้ว (ยังเล่นไม่ได้จนกว่าเด็คจะครบ)', 'Saved (not playable until the deck is complete)') : tx('บันทึกแล้ว', 'Saved'));
    return d.id;
  }

  function play() {
    const i = dirty || !id ? save() : id;
    location.href = href(`/play/?me=my:${i}`);
  }

  // ---------- mouse and keys, as on Limitless ----------

  type Where = 'deck' | 'search';
  const DRAG = 'application/x-tcg-card';
  let dragging: { key: string; from: Where } | null = null;

  function context(e: MouseEvent, key: string, where: Where) {
    e.preventDefault();
    const many = e.ctrlKey || e.metaKey;
    if (where === 'search') change(key, many ? 4 : 1);
    else if (e.altKey) change(key, 1);
    else change(key, many ? -countOf(deck, key) : -1);
  }

  function dragStart(e: DragEvent, key: string, from: Where) {
    dragging = { key, from };
    e.dataTransfer?.setData(DRAG, key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
  }

  function dragOver(e: DragEvent, to: Where) {
    if (dragging && dragging.from !== to) e.preventDefault();
  }

  function drop(e: DragEvent, to: Where) {
    const d = dragging;
    dragging = null;
    if (!d || d.from === to) return;
    e.preventDefault();
    const many = e.ctrlKey || e.metaKey;
    // Into the deck: one copy (four with Ctrl). Back onto the search: every copy (one with Ctrl).
    if (to === 'deck') change(d.key, many ? 4 : 1);
    else change(d.key, many ? -1 : -countOf(deck, d.key));
  }

  function step(by: number) {
    if (!detail || !detail.list.length) return;
    const i = detail.list.indexOf(detail.key);
    const n = detail.list.length;
    detail = { ...detail, key: detail.list[(((i < 0 ? 0 : i) + by) % n + n) % n]! };
  }

  function onkey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (e.key === 'Escape') {
      if (detail || help || importing !== null) e.preventDefault();
      detail = null;
      help = false;
      importing = null;
      return;
    }
    if (t?.closest('input, textarea, select, [contenteditable]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (detail && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    // Space searches, unless it is pressing a focused button.
    if (e.key === ' ' && !t?.closest('button, a, summary')) {
      e.preventDefault();
      query = '';
      tab = 'search';
      searchBox?.focus();
      return;
    }
    if (e.key === 'h' || e.key === 'H' || e.key === '?') {
      help = !help;
      return;
    }
    const key = detail?.key ?? hovered;
    if (!key) return;
    if (e.key === '+' || e.key === '=' || e.key === 'a') change(key, 1);
    else if (e.key === '-' || e.key === 'r') change(key, -1);
    else if (/^[0-9]$/.test(e.key)) set(key, Number(e.key));
    else return;
    e.preventDefault();
  }

  function toggle<T>(list: T[], x: T): T[] {
    return list.includes(x) ? list.filter((y) => y !== x) : [...list, x];
  }

  // Leaving with unsaved changes asks first.
  $effect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  });
</script>

<svelte:window onkeydown={onkey} />

{#snippet tile(key: string, where: Where, list: string[])}
  {@const n = countOf(deck, key)}
  {@const c = cardOf(key)}
  <div
    class="tile"
    class:has={n > 0}
    role="listitem"
    draggable="true"
    ondragstart={(e) => dragStart(e, key, where)}
    ondragend={() => (dragging = null)}
    onmouseenter={() => (hovered = key)}
    onmouseleave={() => hovered === key && (hovered = null)}
    oncontextmenu={(e) => context(e, key, where)}
  >
    <button type="button" class="face" onclick={() => (detail = { key, list })} aria-label={tx(`ดู ${c.name}`, `Read ${c.name}`)}>
      <CardFace cardKey={key} />
    </button>
    <span class="controls">
      <button type="button" class="step" onclick={() => change(key, -1)} disabled={n === 0} aria-label={tx(`เอา ${c.name} ออก 1 ใบ`, `Remove one ${c.name}`)}>−</button>
      {#if n > 0}<span class="count mono" aria-label={tx(`ในเด็ค ${n} ใบ`, `${n} in the deck`)}>{n}</span>{/if}
      <button type="button" class="step" onclick={() => change(key, 1)} aria-label={tx(`เพิ่ม ${c.name} 1 ใบ`, `Add one ${c.name}`)}>+</button>
    </span>
  </div>
{/snippet}

<div class="builder">
  <div class="tabs" role="tablist" aria-label={tx('ตัวจัดเด็ค', 'Deck builder')}>
    <button type="button" role="tab" aria-selected={tab === 'deck'} class:on={tab === 'deck'} onclick={() => (tab = 'deck')}>
      {tx('เด็ค', 'Deck')} <span class="mono" class:full={count === DECK_SIZE}>{count}/{DECK_SIZE}</span>
    </button>
    <button type="button" role="tab" aria-selected={tab === 'search'} class:on={tab === 'search'} onclick={() => (tab = 'search')}>
      {tx('ค้นการ์ด', 'Card search')}
    </button>
  </div>

  <section
    class="pane deck-pane"
    class:off={tab !== 'deck'}
    aria-label={tx('เด็ค', 'Deck')}
    ondragover={(e) => dragOver(e, 'deck')}
    ondrop={(e) => drop(e, 'deck')}
  >
    <header class="deck-head">
      <input class="name" type="text" bind:value={name} placeholder={tx('ชื่อเด็ค', 'Deck name')} aria-label={tx('ชื่อเด็ค', 'Deck name')} maxlength="60" />
      <div class="actions">
        <button type="button" class="primary" onclick={save} disabled={!deck.length}>{tx('บันทึก', 'Save')}</button>
        <button type="button" class="square" onclick={undo} disabled={!past.length} aria-label={tx('เลิกทำ', 'Undo')} title={tx('เลิกทำ (Ctrl+Z)', 'Undo (Ctrl+Z)')}>↶</button>
        <button type="button" onclick={() => (importing = '')}>{tx('นำเข้า list', 'Import')}</button>
        <button type="button" onclick={copyList} disabled={!deck.length}>{tx('คัดลอก list', 'Copy list')}</button>
        <button type="button" class="play" onclick={play} disabled={!!wrong.length}>{tx('เล่นกับบอท ▶', 'Play the bot ▶')}</button>
      </div>
    </header>

    <div class="deck-bar">
      <strong class="total mono" class:full={count === DECK_SIZE} class:over={count > DECK_SIZE}>{count}/{DECK_SIZE}</strong>
      <span class="state" class:ok={!wrong.length} aria-live="polite">
        {#if !deck.length}
          {tx('ยังไม่มีการ์ด', 'No cards yet')}
        {:else if wrong.length}
          {wrong[0]}
        {:else}
          {tx(`เล่นได้ · บอทจะเล่น list นี้แบบ ${near?.name ?? ''}`, `Playable · the bot plays it like ${near?.name ?? ''}`)}
        {/if}
      </span>
      <span class="bar-tools">
        <label class="from">
          <span class="visually-hidden">{tx('เริ่มจาก list ของ', 'Start from the list of')}</span>
          <select
            onchange={(e) => {
              startFrom(e.currentTarget.value);
              e.currentTarget.value = '';
            }}
          >
            <option value="">{tx('เริ่มจาก list ของ…', 'Start from…')}</option>
            {#each decks as d (d.slug)}<option value={d.slug}>{d.name}</option>{/each}
          </select>
        </label>
        <button type="button" class="square" class:on={view === 'grid'} onclick={() => setView('grid')} aria-label={tx('แสดงเป็นรูปการ์ด', 'Card view')} aria-pressed={view === 'grid'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
        </button>
        <button type="button" class="square" class:on={view === 'list'} onclick={() => setView('list')} aria-label={tx('แสดงเป็นรายการ', 'List view')} aria-pressed={view === 'list'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <button type="button" class="square" onclick={() => (help = true)} aria-label={tx('วิธีใช้และปุ่มลัด', 'Help and shortcuts')} title={tx('วิธีใช้ (H)', 'Help (H)')}>?</button>
        <button type="button" class="link" onclick={() => replace([], tx('ล้างเด็คแล้ว', 'Deck cleared'))} disabled={!deck.length}>{tx('ล้าง', 'Clear')}</button>
      </span>
    </div>

    {#if report}
      <div class="report" role="status">
        <p>
          {#if report.unsupported.length}{tx(`ยังไม่รองรับ (ไม่ได้ใส่): ${report.unsupported.join(', ')}`, `Not supported yet (left out): ${report.unsupported.join(', ')}`)}<br />{/if}
          {#if report.ambiguous.length}{tx(`มีหลายแบบ ต้องระบุชุดและเลข: ${report.ambiguous.join(', ')}`, `Several versions, give the set and number: ${report.ambiguous.join(', ')}`)}<br />{/if}
          {#if report.refused.length}{report.refused.join(' · ')}<br />{/if}
          {#if report.unreadable.length}{tx(`อ่านไม่ออก: ${report.unreadable.join(' · ')}`, `Couldn't read: ${report.unreadable.join(' · ')}`)}{/if}
        </p>
        <button type="button" class="link" onclick={() => (report = null)}>{tx('ปิด', 'Close')}</button>
      </div>
    {/if}
    {#if notes.length && !report}<p class="note">{notes[0]}{notes.length > 1 ? tx(` (และอีก ${notes.length - 1})`, ` (and ${notes.length - 1} more)`) : ''}</p>{/if}

    <div class="deck-scroll">
      {#if !deck.length}
        <div class="empty">
          <p>
            {tx(
              'กด + ที่การ์ดในช่องค้นหาเพื่อใส่ลงเด็ค (คลิกขวา = ใส่ 1 ใบ, Ctrl+คลิกขวา = 4 ใบ หรือลากมาวาง) หรือเริ่มจาก list ของเด็คใน meta',
              'Press + on a card in the search to put it in the deck (right-click adds one, Ctrl+right-click four, or drag it here), or start from a meta list',
            )}
          </p>
          <p class="starts">
            {#each decks as d (d.slug)}<button type="button" onclick={() => startFrom(d.slug)}>{d.name}</button>{/each}
          </p>
        </div>
      {:else if view === 'grid'}
        {#each parts as s (s.section)}
          <h3 class="section">{s.label} <span class="mono">{s.count}</span></h3>
          <div class="grid deck-grid" role="list">
            {#each s.lines as l (l.key)}{@render tile(l.key, 'deck', deckOrder)}{/each}
          </div>
        {/each}
      {:else}
        {#each parts as s (s.section)}
          <h3 class="section">{s.label} <span class="mono">{s.count}</span></h3>
          <ul class="rows">
            {#each s.lines as l (l.key)}
              {@const c = cardOf(l.key)}
              <li
                onmouseenter={() => (hovered = l.key)}
                onmouseleave={() => hovered === l.key && (hovered = null)}
                oncontextmenu={(e) => context(e, l.key, 'deck')}
              >
                <button type="button" class="step" onclick={() => change(l.key, -1)} aria-label={tx(`เอา ${c.name} ออก 1 ใบ`, `Remove one ${c.name}`)}>−</button>
                <span class="mono n">{l.count}</span>
                <button type="button" class="step" onclick={() => change(l.key, 1)} aria-label={tx(`เพิ่ม ${c.name} 1 ใบ`, `Add one ${c.name}`)}>+</button>
                <button type="button" class="row-name" onclick={() => (detail = { key: l.key, list: deckOrder })}>{c.name}</button>
                <span class="mono setno">{l.print.replace('-', ' ')}</span>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </div>
  </section>

  <section class="pane search-pane" class:off={tab !== 'search'} aria-label={tx('ค้นการ์ด', 'Card search')} ondragover={(e) => dragOver(e, 'search')} ondrop={(e) => drop(e, 'search')}>
    <div class="search-head">
      <input
        bind:this={searchBox}
        bind:value={query}
        type="search"
        placeholder={tx('ค้นชื่อการ์ด ท่า หรือข้อความ', 'Search a name, attack or text')}
        aria-label={tx('ค้นการ์ด', 'Search cards')}
        autocomplete="off"
        spellcheck="false"
      />
      <div class="chips" role="group" aria-label={tx('กรองตามชนิด', 'Filter by kind')}>
        {#each CHIPS as ch (ch.id)}
          <button type="button" class="chip" class:on={chips.includes(ch.id)} aria-pressed={chips.includes(ch.id)} onclick={() => (chips = toggle(chips, ch.id))}>{ch.label}</button>
        {/each}
      </div>
      <div class="chips types" role="group" aria-label={tx('กรองตามธาตุของ Pokémon', 'Filter Pokémon by type')}>
        {#each POKEMON_TYPES as ty (ty)}
          <button type="button" class="chip type" class:on={types.includes(ty)} aria-pressed={types.includes(ty)} title={ty} onclick={() => (types = toggle(types, ty))}>
            <Energy type={ty} />
          </button>
        {/each}
        {#if chips.length || types.length || query}
          <button type="button" class="link" onclick={() => ((chips = []), (types = []), (query = ''))}>{tx('ล้างตัวกรอง', 'Clear filters')}</button>
        {/if}
      </div>
      <p class="found">
        {tx(`พบ ${results.length} ใบ`, `${results.length} cards found`)}
        <span class="muted">· {tx(`เฉพาะการ์ดที่เว็บนี้เล่นได้ (${SUPPORTED.length} ใบ)`, `only cards this site plays (${SUPPORTED.length})`)}</span>
      </p>
    </div>
    <div class="results-scroll">
      <div class="grid results" role="list">
        {#each results as c (c.key)}{@render tile(c.key, 'search', results.map((r) => r.key))}{/each}
      </div>
      {#if !results.length}<p class="none">{tx('ไม่พบการ์ด ลองคำอื่นหรือล้างตัวกรอง', 'No cards found: try other words or clear the filters')}</p>{/if}
    </div>
  </section>
</div>

{#if detail}
  {@const n = countOf(deck, detail.key)}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) detail = null;
    }}
  >
    <div class="detail" role="dialog" aria-modal="true" aria-label={cardOf(detail.key).name}>
      <button type="button" class="close square" onclick={() => (detail = null)} aria-label={tx('ปิด', 'Close')}>×</button>
      <div class="detail-img"><CardFace cardKey={detail.key} size="high" /></div>
      <div class="detail-text">
        <CardText cardKey={detail.key} />
        <div class="detail-count">
          <span>{tx('ในเด็ค', 'In the deck')}</span>
          <button type="button" class="step big" onclick={() => change(detail!.key, -1)} disabled={n === 0} aria-label={tx('เอาออก 1 ใบ', 'Remove one')}>−</button>
          <strong class="mono">{n}</strong>
          <button type="button" class="step big" onclick={() => change(detail!.key, 1)} aria-label={tx('เพิ่ม 1 ใบ', 'Add one')}>+</button>
        </div>
        {#if detail.list.length > 1}
          <div class="detail-nav">
            <button type="button" onclick={() => step(-1)}>← {tx('ใบก่อน', 'Previous')}</button>
            <button type="button" onclick={() => step(1)}>{tx('ใบถัดไป', 'Next')} →</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if importing !== null}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) importing = null;
    }}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <h2 id="import-title">{tx('นำเข้า list', 'Import a list')}</h2>
      <p class="muted">
        {tx(
          'วาง list ที่ export จาก Limitless หรือ Pokémon TCG Live (เช่น 4 Dreepy TWM 128) list นี้จะแทนการ์ดในเด็คตอนนี้ (กดเลิกทำได้)',
          'Paste a list exported from Limitless or Pokémon TCG Live (e.g. 4 Dreepy TWM 128). It replaces the cards in the deck now (you can undo).',
        )}
      </p>
      <textarea bind:value={importing} rows="14" spellcheck="false" aria-label="decklist"></textarea>
      <div class="dialog-actions">
        <button type="button" class="primary" onclick={runImport} disabled={!importing.trim()}>{tx('นำเข้า', 'Import')}</button>
        <button type="button" onclick={() => (importing = null)}>{tx('ยกเลิก', 'Cancel')}</button>
      </div>
    </div>
  </div>
{/if}

{#if help}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) help = false;
    }}
  >
    <div class="dialog help" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <h2 id="help-title">{tx('วิธีใช้ตัวจัดเด็ค', 'Using the deck builder')}</h2>
      <p class="muted">{tx('ใช้แบบเดียวกับตัวจัดเด็คของ Limitless: ค้นการ์ดทางขวา แล้วใส่ลงเด็คทางซ้าย', "It works like Limitless's deck builder: search for cards on the right and add them to the deck on the left.")}</p>
      <h3>{tx('เมาส์', 'Mouse')}</h3>
      <ul>
        <li>{tx('ชี้ที่การ์ดแล้วกด + / − เพื่อเพิ่มหรือเอาออกทีละใบ', 'Point at a card and press its + / − to add or remove one')}</li>
        <li>{tx('คลิกขวาที่การ์ดในช่องค้นหา = ใส่ 1 ใบ · Ctrl+คลิกขวา = ใส่ 4 ใบ', 'Right-click a search result: add one · Ctrl+right-click: add four')}</li>
        <li>{tx('คลิกขวาที่การ์ดในเด็ค = เอาออก 1 ใบ · Ctrl+คลิกขวา = เอาออกทั้งหมด · Alt+คลิกขวา = เพิ่ม 1 ใบ', 'Right-click a card in the deck: remove one · Ctrl+right-click: remove all · Alt+right-click: add one')}</li>
        <li>{tx('ลากการ์ดจากช่องค้นหามาวางในเด็ค = ใส่ 1 ใบ (กด Ctrl ค้างไว้ = 4 ใบ) · ลากจากเด็คกลับไป = เอาออกทั้งหมด', 'Drag a search result into the deck: add one (hold Ctrl: four) · drag a deck card back: remove all')}</li>
        <li>{tx('คลิกที่การ์ด = เปิดอ่านข้อความเต็ม', 'Click a card: read its full text')}</li>
      </ul>
      <h3>{tx('ปุ่มลัด (ชี้ที่การ์ดค้างไว้)', 'Keys (with the mouse on a card)')}</h3>
      <ul>
        <li><kbd>+</kbd> / <kbd>A</kbd> {tx('เพิ่ม 1 ใบ', 'add one')} · <kbd>−</kbd> / <kbd>R</kbd> {tx('เอาออก 1 ใบ', 'remove one')} · <kbd>0</kbd>–<kbd>9</kbd> {tx('ตั้งจำนวน', 'set the count')}</li>
        <li><kbd>Space</kbd> {tx('ไปที่ช่องค้นหา', 'go to the search')} · <kbd>H</kbd> {tx('เปิดหน้านี้', 'this help')} · <kbd>Ctrl</kbd>+<kbd>Z</kbd> {tx('เลิกทำ', 'undo')} · <kbd>Esc</kbd> {tx('ปิด', 'close')}</li>
        <li><kbd>←</kbd> / <kbd>→</kbd> {tx('การ์ดใบก่อน/ถัดไปตอนเปิดอ่าน', 'previous / next card while reading one')}</li>
      </ul>
      <h3>{tx('กติกาเด็ค', 'Deck rules')}</h3>
      <ul>
        <li>{tx('60 ใบพอดี · การ์ดชื่อเดียวกันไม่เกิน 4 ใบ (ยกเว้น Basic Energy) · ACE SPEC ได้ใบเดียว · มี Basic Pokémon อย่างน้อย 1 ใบ', 'Exactly 60 cards · 4 at most with the same name (Basic Energy aside) · 1 ACE SPEC · at least 1 Basic Pokémon')}</li>
        <li>{tx('เด็คถูกเก็บไว้ในเบราว์เซอร์นี้ คัดลอก list ไปวางใน Limitless หรือ Pokémon TCG Live ได้', 'Decks are kept in this browser; copy the list into Limitless or Pokémon TCG Live')}</li>
      </ul>
      <div class="dialog-actions"><button type="button" class="primary" onclick={() => (help = false)}>{tx('เข้าใจแล้ว', 'Got it')}</button></div>
    </div>
  </div>
{/if}

{#if toast}<Toast message={toast.message} action={toast.action} onaction={toast.onaction} />{/if}

<style>
  /* Two panes filling the screen under the header, each scrolling on its own, like Limitless's builder. */
  .builder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(340px, 38%);
    gap: 12px;
    height: calc(100dvh - 96px);
    min-height: 560px;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--rule);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
    overflow: hidden;
  }
  .tabs {
    display: none;
  }
  button {
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.2s var(--ease),
      border-color 0.2s var(--ease);
  }
  button:hover:not(:disabled) {
    background: var(--control-hover);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    border-color: var(--press);
    background: var(--press);
  }
  .square {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
  }
  .square svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .square.on {
    border-color: var(--line-strong);
    background: var(--control-hover);
  }
  .link,
  .link:hover:not(:disabled) {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-soft);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .link:hover:not(:disabled) {
    color: var(--ink-strong);
  }
  input,
  select,
  textarea {
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink-strong);
    font: inherit;
  }
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    border-color: var(--line-strong);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* ---------- the deck ---------- */
  .deck-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .name {
    flex: 1 1 200px;
    min-width: 0;
    font-size: 18px;
    line-height: 24px;
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .play:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .deck-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rule);
    font-size: 14px;
    line-height: 20px;
  }
  .total {
    color: var(--accent);
    font-size: 18px;
    line-height: 24px;
  }
  .total.full {
    color: var(--teal);
  }
  .total.over {
    color: var(--stamp);
  }
  .state {
    flex: 1 1 160px;
    min-width: 0;
    color: var(--ink-soft);
  }
  .state.ok {
    color: var(--teal);
    font-weight: 500;
  }
  .bar-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .from select {
    max-width: 180px;
    padding: 6px 8px;
    font-size: 14px;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .report,
  .note {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    margin: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rule);
    font-size: 14px;
    line-height: 20px;
  }
  .report {
    background: color-mix(in srgb, var(--stamp) 10%, transparent);
    color: var(--ink);
  }
  .report p {
    margin: 0;
  }
  .note {
    color: var(--accent);
  }
  .deck-scroll,
  .results-scroll {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    overscroll-behavior: contain;
  }
  .section {
    margin: 4px 0 8px;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
  }
  .section:not(:first-child) {
    margin-top: 16px;
  }
  .grid {
    display: grid;
    gap: 10px 8px;
  }
  .deck-grid {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  }
  .results {
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  }
  .empty {
    display: grid;
    gap: 12px;
    place-content: center;
    min-height: 100%;
    padding: 24px;
    border: 1px dashed var(--line);
    border-radius: var(--radius-lg);
    color: var(--ink-soft);
    text-align: center;
  }
  .empty p {
    margin: 0;
    max-width: 520px;
  }
  .starts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rows li {
    display: grid;
    grid-template-columns: 28px 28px 28px minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }
  .rows li:hover {
    background: var(--raised);
  }
  .rows .n {
    text-align: center;
    color: var(--ink-strong);
    font-weight: 600;
  }
  .row-name {
    overflow: hidden;
    padding: 2px 0;
    border: 0;
    background: none;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-name:hover:not(:disabled) {
    background: none;
    text-decoration: underline;
  }
  .setno {
    color: var(--ink-faint);
    font-size: 12px;
  }

  /* ---------- a card: its picture, its count, and − / + on hover (always on touch screens) ---------- */
  .tile {
    position: relative;
    border-radius: var(--radius);
  }
  .face {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    transition: transform 0.2s var(--ease);
  }
  .face:hover:not(:disabled) {
    background: none;
    transform: translateY(-2px);
  }
  .results .tile:not(.has) .face {
    opacity: 0.85;
  }
  .controls {
    position: absolute;
    left: 50%;
    bottom: 6%;
    display: flex;
    gap: 4px;
    align-items: center;
    transform: translateX(-50%);
  }
  .count {
    min-width: 26px;
    padding: 2px 6px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--paper);
    color: var(--ink-strong);
    text-align: center;
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    box-shadow: var(--shadow);
  }
  .results .count {
    border-color: var(--accent);
    color: var(--accent);
  }
  .step {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-color: var(--line-strong);
    background: var(--paper);
    font-size: 16px;
    line-height: 16px;
    font-weight: 600;
  }
  .tile .step {
    opacity: 0;
    box-shadow: var(--shadow);
    transition: opacity 0.15s var(--ease);
  }
  .tile:hover .step,
  .tile:focus-within .step {
    opacity: 1;
  }
  .tile .step:disabled {
    visibility: hidden;
  }

  /* ---------- the search ---------- */
  .search-head {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chip {
    padding: 4px 10px;
    font-size: 12px;
    line-height: 16px;
  }
  .chip.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--ink-strong);
  }
  .chip.type {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 28px;
    padding: 0;
    font-size: 16px;
  }
  .found {
    margin: 0;
    color: var(--ink);
    font-size: 12px;
    line-height: 16px;
  }
  .muted {
    color: var(--ink-soft);
  }
  .none {
    color: var(--ink-soft);
    text-align: center;
  }

  /* ---------- dialogs ---------- */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 16px;
    background: #000000b3;
  }
  .detail {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 300px) minmax(0, 360px);
    gap: 20px;
    max-height: calc(100dvh - 32px);
    overflow: auto;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
    box-shadow: var(--shadow-lg);
  }
  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    font-size: 18px;
  }
  .detail-text {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 32px;
  }
  .detail-count {
    display: flex;
    gap: 10px;
    align-items: center;
    color: var(--ink-soft);
  }
  .detail-count strong {
    min-width: 24px;
    color: var(--ink-strong);
    text-align: center;
    font-size: 20px;
    line-height: 28px;
  }
  .step.big {
    width: 36px;
    height: 36px;
    font-size: 18px;
  }
  .detail-nav {
    display: flex;
    gap: 8px;
  }
  .dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(560px, 100%);
    max-height: calc(100dvh - 32px);
    overflow: auto;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
    box-shadow: var(--shadow-lg);
  }
  .dialog h2 {
    margin: 0;
    font-size: 20px;
    line-height: 28px;
  }
  .dialog h3 {
    margin: 4px 0 0;
    font-size: 14px;
    line-height: 20px;
  }
  .dialog p {
    margin: 0;
    font-size: 14px;
    line-height: 20px;
  }
  .dialog ul {
    margin: 0;
    padding-left: 18px;
    color: var(--ink);
    font-size: 14px;
    line-height: 22px;
  }
  .dialog textarea {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 16px;
  }
  kbd {
    padding: 0 4px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--control);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .dialog-actions {
    display: flex;
    gap: 8px;
  }

  /* Touch screens: no hover, so − / + are always there, and 44px to tap. */
  @media (pointer: coarse) {
    .tile .step {
      opacity: 1;
    }
    .step {
      width: 32px;
      height: 32px;
    }
    .square {
      width: 44px;
      height: 44px;
    }
  }

  /* Narrow screens: the deck and the search as two tabs, one at a time. */
  @media (max-width: 900px) {
    .builder {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      gap: 8px;
      height: calc(100dvh - 88px);
      min-height: 480px;
    }
    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--rule);
      border-radius: var(--radius-lg);
      background: var(--card-bg);
    }
    .tabs button {
      border-color: transparent;
      background: none;
      color: var(--ink-soft);
    }
    .tabs button.on {
      border-color: var(--line);
      background: var(--control);
      color: var(--ink-strong);
    }
    .tabs .full {
      color: var(--teal);
    }
    .pane.off {
      display: none;
    }
    .bar-tools {
      width: 100%;
    }
    .from {
      flex: 1 1 0;
      min-width: 0;
    }
    .from select {
      width: 100%;
      max-width: none;
    }
    .deck-grid,
    .results {
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    }
    .detail {
      grid-template-columns: minmax(0, 1fr);
      justify-items: center;
    }
    .detail-img {
      width: min(260px, 70vw);
    }
    .detail-text {
      padding-right: 0;
    }
  }
</style>
