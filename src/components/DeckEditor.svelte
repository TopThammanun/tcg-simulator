<script lang="ts">
  // แก้ decklist ของคุณ (Limitless format). Saved in this browser; used by the play and sim pages.
  import { untrack } from 'svelte';
  import { checkList } from '../ui/decklist';
  import { saveListText, savedListText } from '../ui/my-list';

  let { defaultList, onchange }: { defaultList: string; onchange?: () => void } = $props();

  const initial = savedListText();
  let custom = $state(initial !== null);
  // Own state for the disclosure: a plain open={…} attribute is re-applied on every edit and closes it.
  let opened = $state(initial !== null);
  // The textarea starts from the saved list (or the default) and is then edited freely.
  let text = $state(initial ?? untrack(() => defaultList));
  let saved = $state(false);
  const result = $derived(checkList(text));

  function use() {
    if (!result.cards) return;
    saveListText(text);
    custom = true;
    saved = true;
    setTimeout(() => (saved = false), 1500);
    onchange?.();
  }

  function reset() {
    saveListText(null);
    text = defaultList;
    custom = false;
    onchange?.();
  }
</script>

<details class="editor" bind:open={opened}>
  <summary>แก้ list ของคุณ {custom ? '(ใช้ list ที่แก้อยู่)' : '(list เดิมจาก PLAN.md)'}</summary>
  <p class="hint">วาง list แบบที่ Limitless export · การ์ดชุดอื่นที่ชื่อเดียวกันใช้ได้ · v1 รองรับเฉพาะการ์ดในเด็คที่มีอยู่</p>
  <textarea bind:value={text} rows="14" spellcheck="false" aria-label="decklist"></textarea>
  {#if result.errors.length}
    <ul class="errors">
      {#each result.errors as e}<li>{e}</li>{/each}
    </ul>
  {:else}
    <p class="ok">ใช้ได้ · 60 ใบ</p>
  {/if}
  <div class="actions">
    <button type="button" class="primary" onclick={use} disabled={!result.cards}>{saved ? 'บันทึกแล้ว' : 'ใช้ list นี้'}</button>
    <button type="button" onclick={reset}>กลับเป็น list เดิม</button>
  </div>
</details>

<style>
  .editor {
    padding: 8px 12px;
    border: 1.5px solid var(--rule);
    background: var(--card-bg);
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  .hint {
    margin: 6px 0;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  textarea {
    width: 100%;
    padding: 8px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .errors {
    margin: 6px 0;
    padding-left: 18px;
    color: var(--stamp);
    font-size: 0.85rem;
  }
  .ok {
    margin: 6px 0;
    color: var(--teal);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  button {
    padding: 5px 14px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    background: var(--ink);
    color: var(--paper);
  }
  button:disabled {
    opacity: 0.4;
  }
</style>
