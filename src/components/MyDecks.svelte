<script lang="ts">
  // เด็คของฉัน: your own lists, kept in this browser (ui/my-decks.ts). Paste a Limitless export; the check
  // names every card the engine can't play yet. A list plays with the plan of the meta deck nearest to it.
  import { slide } from 'svelte/transition';
  import { checkList, SUPPORTED } from '../ui/decklist';
  import { headline, nearestDeck, type MetaDeck } from '../ui/decks';
  import { deleteMyDeck, loadMyDecks, saveMyDeck, type MyDeck } from '../ui/my-decks';
  import { motion } from '../ui/anim/motion';
  import CardFace from './game/CardFace.svelte';

  let { decks }: { decks: (MetaDeck & { text: string })[] } = $props();

  let mine = $state<MyDeck[]>(loadMyDecks());
  /** The deck being edited: a new one (no id) or a saved one. */
  let editing = $state<{ id?: string; name: string; text: string } | null>(null);
  const result = $derived(editing ? checkList(editing.text) : null);
  const near = (cards: string[]) => nearestDeck(cards, decks);

  const CATEGORY = { pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energy' } as const;
  const supported = (['pokemon', 'trainer', 'energy'] as const).map((c) => ({
    label: CATEGORY[c],
    names: [...new Set(SUPPORTED.filter((d) => d.category === c).map((d) => d.name))],
  }));

  function start(from?: MetaDeck & { text: string }) {
    editing = { name: from ? `${from.name} (ของฉัน)` : '', text: from?.text ?? '' };
  }

  function save() {
    if (!editing || !result?.cards) return;
    saveMyDeck(editing);
    mine = loadMyDecks();
    editing = null;
  }

  function remove(d: MyDeck) {
    deleteMyDeck(d.id);
    mine = loadMyDecks();
  }
</script>

<section class="mine" id="mine" aria-labelledby="mine-title">
  <header>
    <div>
      <p class="eyebrow">เก็บไว้ในเบราว์เซอร์นี้</p>
      <h2 id="mine-title">เด็คของฉัน</h2>
    </div>
    {#if !editing}
      <button type="button" class="primary" onclick={() => start()}>+ วาง list ใหม่</button>
    {/if}
  </header>

  {#if editing}
    <div class="editor" transition:slide={{ duration: motion(220) }}>
      <label>
        ชื่อเด็ค
        <input type="text" bind:value={editing.name} placeholder="เช่น Dragapult ของฉัน" />
      </label>
      <label>
        decklist
        <textarea bind:value={editing.text} rows="14" spellcheck="false" aria-label="decklist" placeholder="วาง list ที่ export จาก Limitless หรือ Pokémon TCG Live"></textarea>
      </label>
      <p class="starts">
        หรือเริ่มจาก list ของ:
        {#each decks as d}<button type="button" class="link" onclick={() => (editing!.text = d.text)}>{d.name}</button>{/each}
      </p>
      {#if editing.text.trim() && result}
        {#if result.cards}
          <p class="ok">ใช้ได้ · 60 ใบ · บอทจะเล่น list นี้แบบ {near(result.cards).name}</p>
        {:else}
          <ul class="errors">
            {#each result.errors as e}<li>{e}</li>{/each}
          </ul>
          {#if result.unsupported.length}
            <p class="hint">
              เว็บนี้เล่นได้เฉพาะการ์ดที่เขียนกฎไว้แล้ว ({SUPPORTED.length} ใบจากเด็คใน meta) ลองแทนการ์ดที่ยังไม่รองรับด้วยใบที่ใช้ได้ด้านล่าง
            </p>
          {/if}
        {/if}
      {/if}
      <div class="actions">
        <button type="button" class="primary" onclick={save} disabled={!result?.cards}>บันทึก</button>
        <button type="button" onclick={() => (editing = null)}>ยกเลิก</button>
      </div>
    </div>
  {/if}

  {#if mine.length}
    <ul class="list">
      {#each mine as d (d.id)}
        {@const r = checkList(d.text)}
        <li>
          <span class="fan" aria-hidden="true">
            {#each r.cards ? headline(r.cards, d.name).reverse() : [] as k, j (k)}
              <span style:--j={j}><CardFace cardKey={k} /></span>
            {/each}
          </span>
          <span class="info">
            <strong>{d.name}</strong>
            {#if r.cards}
              <span class="muted">เล่นแบบ {near(r.cards).name}</span>
            {:else}
              <span class="bad">ใช้ไม่ได้: {r.errors[0]}{r.errors.length > 1 ? ` และอีก ${r.errors.length - 1} ข้อ` : ''}</span>
            {/if}
          </span>
          <span class="acts">
            {#if r.cards}<a class="button" href={`/play/?me=my:${d.id}`}>เล่น →</a>{/if}
            <button type="button" onclick={() => (editing = { id: d.id, name: d.name, text: d.text })}>แก้</button>
            <button type="button" class="link" onclick={() => remove(d)}>ลบ</button>
          </span>
        </li>
      {/each}
    </ul>
  {:else if !editing}
    <p class="empty">ยังไม่มี วาง list ของคุณเพื่อเล่นกับบอทด้วยเด็คที่คุณใช้จริง หรือเริ่มจาก list ของเด็คใน meta แล้วปรับการ์ด</p>
  {/if}

  <details class="cards">
    <summary>การ์ดที่ใช้ได้ ({SUPPORTED.length} ใบ)</summary>
    {#each supported as g}
      <h3>{g.label}</h3>
      <p class="names">{g.names.join(' · ')}</p>
    {/each}
  </details>
</section>

<style>
  .mine {
    margin-top: 40px;
    border-top: 2px solid var(--ink);
  }
  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 0 10px;
  }
  h2 {
    margin: 0;
    font-size: clamp(1.6rem, 4vw, 2.2rem);
  }
  .eyebrow {
    margin: 0 0 2px;
  }
  button,
  .button {
    padding: 6px 14px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary,
  .button {
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-display);
    font-weight: 600;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    text-decoration: underline;
    color: inherit;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    margin-bottom: 16px;
    border: 2px solid var(--ink);
    background: var(--card-bg);
    box-shadow: 6px 6px 0 var(--paper-deep);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
  }
  input,
  textarea {
    padding: 8px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  textarea {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .starts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .starts .link {
    color: var(--ink);
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    color: var(--stamp);
    font-size: 0.9rem;
  }
  .ok {
    margin: 0;
    color: var(--teal);
    font-weight: 600;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--rule);
  }
  .list li {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 12px 4px;
    border-bottom: 1px solid var(--rule);
  }
  .fan {
    position: relative;
    height: 4.6rem;
  }
  .fan span {
    position: absolute;
    top: 0;
    left: calc(var(--j) * 1.3rem);
    width: 3.3rem;
    transform: rotate(calc((var(--j) - 1) * 7deg));
    transform-origin: bottom center;
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .info strong {
    font-family: var(--font-display);
    font-size: 1.1rem;
  }
  .muted {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .bad {
    color: var(--stamp);
    font-size: 0.85rem;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .empty {
    margin: 0;
    padding: 18px;
    border: 1.5px dashed var(--rule);
    color: var(--ink-soft);
  }
  .cards {
    margin-top: 16px;
    font-size: 0.85rem;
  }
  .cards summary {
    cursor: pointer;
    font-weight: 600;
  }
  .cards h3 {
    margin: 10px 0 2px;
    font-size: 0.95rem;
  }
  .names {
    margin: 0;
    color: var(--ink-soft);
    line-height: 1.7;
  }
  @media (max-width: 640px) {
    .list li {
      grid-template-columns: 1fr auto;
    }
    .fan {
      display: none;
    }
  }
</style>
