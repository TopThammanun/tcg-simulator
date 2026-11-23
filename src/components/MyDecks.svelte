<script lang="ts">
  // เด็คของฉัน: your own lists, kept in this browser (ui/my-decks.ts). They are built and changed in the deck builder
  // (/builder/, like Limitless's): a new one, one of these, or a meta list to start from. A list plays with the plan
  // of the meta deck nearest to it; one that isn't a legal 60 yet (a saved draft) says what is missing.
  import { href, langOfPath, setLang, tx } from '../i18n';
  import { checkList } from '../ui/decklist';
  import { headline, nearestDeck, type MetaDeck } from '../ui/decks';
  import { deleteMyDeck, loadMyDecks, type MyDeck } from '../ui/my-decks';
  import CardFace from './game/CardFace.svelte';

  setLang(langOfPath(location.pathname));

  let { decks }: { decks: (MetaDeck & { text: string })[] } = $props();

  let mine = $state<MyDeck[]>(loadMyDecks());
  const near = (cards: string[]) => nearestDeck(cards, decks);

  function remove(d: MyDeck) {
    deleteMyDeck(d.id);
    mine = loadMyDecks();
  }
</script>

<section class="mine" id="mine" aria-labelledby="mine-title">
  <header>
    <div>
      <p class="eyebrow">{tx('เก็บไว้ในเบราว์เซอร์นี้', 'Kept in this browser')}</p>
      <h2 id="mine-title">{tx('เด็คของฉัน', 'My decks')}</h2>
    </div>
    <a class="button" href={href('/builder/')}>{tx('+ จัดเด็คใหม่', '+ Build a new deck')}</a>
  </header>

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
              <span class="muted">{tx('เล่นแบบ', 'Plays like')} {near(r.cards).name}</span>
            {:else}
              <span class="bad"
                >{tx('ยังเล่นไม่ได้', 'Not playable yet')}: {r.errors[0]}{r.errors.length > 1 ? tx(` และอีก ${r.errors.length - 1} ข้อ`, ` and ${r.errors.length - 1} more`) : ''}</span
              >
            {/if}
          </span>
          <span class="acts">
            {#if r.cards}<a class="button" href={href(`/play/?me=my:${d.id}`)}>{tx('เล่น', 'Play')}</a>{/if}
            <a class="button quiet" href={href(`/builder/?id=${d.id}`)}>{tx('แก้', 'Edit')}</a>
            <button type="button" class="link" onclick={() => remove(d)}>{tx('ลบ', 'Delete')}</button>
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">
      {tx(
        'ยังไม่มี จัดเด็คของคุณในตัวจัดเด็ค (ใช้แบบเดียวกับ Limitless: ค้นการ์ดแล้วกด +) หรือนำเข้า list ที่ export มา แล้วเล่นกับบอทด้วยเด็คที่คุณใช้จริง',
        "None yet. Build yours in the deck builder (it works like Limitless's: search for a card and press +) or import an exported list, then play the bot with the deck you really play.",
      )}
    </p>
  {/if}
  <p class="starts">
    {tx('หรือเริ่มจาก list ของ:', 'Or start from the list of:')}
    {#each decks as d (d.slug)}<a href={href(`/builder/?from=${d.slug}`)}>{d.name}</a>{/each}
  </p>
</section>

<style>
  .mine {
    margin-top: 80px;
  }
  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 0 0 24px;
  }
  h2 {
    margin: 0;
    font-size: 30px;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .eyebrow {
    margin: 0 0 4px;
  }
  button,
  .button {
    display: inline-flex;
    align-items: center;
    padding: 8px 12px;
    border: 1px solid var(--line);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    border-radius: var(--radius);
    transition:
      background-color 0.3s var(--ease),
      transform 0.3s var(--ease);
  }
  button:hover:not(:disabled) {
    background: var(--control-hover);
  }
  button:active:not(:disabled) {
    transform: scale(0.98);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .button {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
  }
  .button:hover {
    border-color: var(--press);
    background: var(--press);
  }
  .button.quiet {
    border-color: var(--line);
    background: var(--control);
    color: var(--ink-strong);
    font-weight: 500;
  }
  .button.quiet:hover {
    background: var(--control-hover);
  }
  .link,
  .link:hover:not(:disabled) {
    padding: 0;
    border: 0;
    background: none;
    text-decoration: underline;
    text-underline-offset: 4px;
    color: inherit;
  }
  .starts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 16px 0 0;
    font-size: 14px;
    line-height: 20px;
    color: var(--ink-soft);
  }
  .starts a {
    color: var(--ink);
    text-underline-offset: 4px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--rule);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
  }
  .list li {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 16px;
  }
  .list li + li {
    border-top: 1px solid var(--rule);
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
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .info strong {
    color: var(--ink-strong);
    font-size: 18px;
    line-height: 28px;
    font-weight: 500;
  }
  .muted {
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
  }
  .bad {
    color: var(--stamp);
    font-size: 14px;
    line-height: 20px;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .empty {
    margin: 0;
    padding: 32px 24px;
    border: 1px dashed var(--line);
    border-radius: var(--radius-xl);
    color: var(--ink-soft);
    text-align: center;
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
