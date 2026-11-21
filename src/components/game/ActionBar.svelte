<script lang="ts">
  // The command bar under the table: one height whatever it says (the table above never moves), what is going on at
  // the left in two lines at most, its buttons at the right. What to show comes from ui/action-bar.ts.
  import type { Bar, BarAction } from '../../ui/action-bar';
  import Button from '../ui/Button.svelte';

  let { bar, onaction }: { bar: Bar; onaction: (id: BarAction) => void } = $props();
  const warn = $derived(bar.kind === 'warn');
</script>

<div
  class={['bar', bar.kind]}
  class:setup-bar={bar.kind === 'setup'}
  data-step={bar.step}
  role={warn ? 'alertdialog' : 'status'}
  aria-label={warn ? bar.title?.replace(/\?$/, '') : undefined}
  aria-live={warn ? undefined : 'polite'}
>
  <div class="say">
    {#if bar.chips}
      <span class="uses" aria-label="ใช้ไปแล้วเทิร์นนี้">
        {#each bar.chips as u (u.label)}
          <span class={`use ${u.state}`} title={u.title}>{u.state === 'used' ? '✓ ' : ''}{u.label}</span>
        {/each}
      </span>
    {/if}
    {#if bar.title}<strong>{bar.title}</strong>{/if}
    {#if bar.text}<span class="sub" class:why={bar.why} class:tip={bar.tip} role={bar.why ? 'note' : undefined}>{bar.text}</span>{/if}
  </div>
  {#if bar.buttons.length}
    <div class="acts">
      {#each bar.buttons as b (b.id)}
        <Button
          variant={b.kind}
          class={[b.id === 'end' && 'end', b.narrowOnly && 'narrow-only']}
          disabled={b.disabled}
          title={b.key ? `${b.label} (${b.key})` : undefined}
          aria-keyshortcuts={b.key}
          onclick={() => onaction(b.id)}>{b.label}</Button
        >
      {/each}
    </div>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    gap: 12px;
    align-items: center;
    height: 100%;
    min-width: 0;
    padding: 0 6px 0 12px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
  }
  .say {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    max-height: 100%;
    overflow: hidden;
    font-size: 14px;
    line-height: 20px;
  }
  .say strong {
    overflow: hidden;
    color: var(--ink-strong);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sub {
    display: -webkit-box;
    overflow: hidden;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .sub.why {
    color: var(--stamp);
    font-weight: 500;
  }
  .sub.tip {
    color: var(--ink);
  }
  .sub.tip::before {
    content: 'เคล็ดลับ · ';
    color: var(--accent);
    font-weight: 600;
  }
  .wait .say {
    display: -webkit-box;
    color: var(--ink-soft);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .acts {
    display: flex;
    flex: 0 0 auto;
    gap: 8px;
    align-items: center;
  }
  .acts :global(.end) {
    min-width: 112px;
  }
  .acts :global(.narrow-only) {
    display: none;
  }
  /* The once-a-turn plays: free ones outlined, used ones ticked and filled, a barred one struck through. */
  .uses {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .use {
    padding: 1px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--ink-strong);
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
    white-space: nowrap;
  }
  .use.used {
    border-color: var(--rule);
    background: var(--control);
    color: var(--ink-soft);
  }
  .use.barred {
    color: var(--ink-soft);
    text-decoration: line-through;
  }
  /* A question before something that can't be taken back. */
  .warn {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, var(--card-bg));
  }
  .warn .say strong {
    color: var(--accent);
  }
  @media (max-width: 700px) {
    .bar {
      gap: 8px;
      padding-left: 10px;
    }
    .acts {
      gap: 4px;
    }
    .acts :global(.ui-btn) {
      padding: 8px 12px;
    }
    .acts :global(.end) {
      min-width: 0;
    }
    .acts :global(.narrow-only) {
      display: inline-flex;
    }
    /* A question's three lines fit the bar. */
    .warn .say {
      font-size: 12px;
      line-height: 16px;
    }
    /* With a button for the bot's turn beside "จบเทิร์น", the chips wrap to two short lines. */
    .uses {
      max-width: 160px;
    }
  }
</style>
