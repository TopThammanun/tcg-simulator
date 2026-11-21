<script lang="ts">
  // The game's top line: the menu (new game, how to play, settings, back to the site), whose turn it is, the two decks,
  // and on a phone the log. At the end: the result and the links to the review and the bot's list.
  import { tx } from '../../i18n';
  import IconButton from '../ui/IconButton.svelte';

  let {
    title,
    result = false,
    sub = [],
    links = [],
    back = null,
    menuOpen = false,
    logOpen = false,
    narrow = false,
    onmenu,
    onlog,
  }: {
    title: string;
    /** The title is the game's result. */
    result?: boolean;
    /** Smaller notes after it (the decks, a game picked up again). */
    sub?: string[];
    links?: { href: string; label: string }[];
    /** Looking at an earlier position: the button back to the game. */
    back?: (() => void) | null;
    menuOpen?: boolean;
    logOpen?: boolean;
    narrow?: boolean;
    onmenu: () => void;
    onlog: () => void;
  } = $props();
</script>

<div class="status">
  <IconButton icon="menu" label={tx('เมนูเกม', 'Game menu')} aria-expanded={menuOpen} onclick={onmenu} />
  <strong class:result>{title}</strong>
  {#each sub as s}<span class="opp">{s}</span>{/each}
  {#if back}<button type="button" class="link" onclick={back}>{tx('กลับไปเกมปัจจุบัน', 'Back to the game')}</button>{/if}
  {#each links as l}<a href={l.href}>{l.label} →</a>{/each}
  {#if narrow}
    <span class="right"><IconButton icon="log" label={tx('บันทึกเกม', 'Game log')} aria-expanded={logOpen} onclick={onlog} /></span>
  {/if}
</div>

<style>
  .status {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: nowrap;
    gap: 4px 12px;
    align-items: center;
    min-width: 0;
    font-size: 14px;
    line-height: 20px;
  }
  .status :global(.ui-icon:first-child) {
    margin-left: -6px;
  }
  strong {
    flex: none;
    color: var(--ink-strong);
    font-weight: 600;
    white-space: nowrap;
  }
  strong.result {
    color: var(--stamp);
    font-size: 18px;
    line-height: 28px;
  }
  .opp {
    overflow: hidden;
    color: var(--ink-soft);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  a,
  .link {
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-soft);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  a:hover,
  .link:hover {
    color: var(--ink-strong);
  }
  .right {
    margin-left: auto;
  }
  @media (max-width: 700px) {
    .status {
      gap: 2px 8px;
    }
    .opp,
    a {
      display: none;
    }
  }
</style>
