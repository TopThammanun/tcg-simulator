<script lang="ts">
  // ปุ่มแนะนำ: 3 options for your deck, each with why. What the opponent can do next turn is the
  // threat panel's job (ThreatPanel.svelte). `compact` is the phone layout (inside the bottom dock, scrolls on its own).
  import { fly, slide } from 'svelte/transition';
  import { suggest, type Suggestion } from '../../bots/coach';
  import { motion } from '../../ui/anim/motion';
  import { planFor, DEFAULT_POLICY, type PlayerPolicy } from '../../bots/plans';
  import type { Action, GameState } from '../../engine/types';

  let {
    s,
    onapply,
    compact = false,
  }: { s: GameState; onapply: (a: Action, picks?: number[][]) => void; compact?: boolean } = $props();

  const POLICY_KEY = 'tcg-sim:policy';
  let policy: PlayerPolicy = DEFAULT_POLICY;
  try {
    policy = { ...DEFAULT_POLICY, ...JSON.parse(localStorage.getItem(POLICY_KEY) ?? '{}') };
  } catch {
    /* default policy */
  }

  let open = $state(false);
  let tips = $state<Suggestion[]>([]);

  function ask() {
    tips = suggest(s, 0, planFor('player', policy), s.turn);
    open = true;
  }
  $effect(() => {
    // A new position makes old hints stale.
    void s;
    open = false;
  });
</script>

<section class="coach" class:compact aria-label="คำแนะนำ">
  <button type="button" class="ask" onclick={() => (open ? (open = false) : ask())} aria-expanded={open}>
    {open ? 'ซ่อนคำแนะนำ' : 'แนะนำ 3 ทางเลือก'}
  </button>
  {#if open}
    <div class="body" transition:slide={{ duration: motion(220) }}>
      <ol class="tips">
        {#each tips as t, i}
          <li in:fly={{ y: 10, delay: motion(80 + i * 70), duration: motion(240) }}>
            <div class="title"><span class="rank mono">{i + 1}</span><strong>{t.title}</strong></div>
            <p class="why"><span class="tag">เพราะ</span>{t.why}</p>
            {#if t.facts.length}
              <ul class="facts">
                {#each t.facts as f}<li>{f}</li>{/each}
              </ul>
            {/if}
            <button type="button" class="go" onclick={() => onapply(t.action, t.picks)}>ทำตามนี้</button>
          </li>
        {/each}
      </ol>
      <p class="note">คิดจากข้อมูลที่คุณเห็นเท่านั้น ผลที่จำลองเป็นค่าประมาณ (การจั่วและโยนเหรียญจริงอาจต่าง)</p>
    </div>
  {/if}
</section>

<style>
  .coach {
    padding: 10px 12px;
    border: 1.5px solid var(--teal);
    background: var(--card-bg);
    font-size: 0.85rem;
  }
  .ask {
    width: 100%;
    padding: 6px;
    border: 1.5px solid var(--teal);
    background: var(--teal);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .ask[aria-expanded='true'] {
    background: transparent;
    color: var(--teal);
  }
  .tips {
    margin: 10px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tips > li {
    padding-bottom: 10px;
    border-bottom: 1px dashed var(--rule);
  }
  .title {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .rank {
    flex: 0 0 auto;
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--teal);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .why {
    margin: 4px 0 0 28px;
    line-height: 1.45;
  }
  .tag {
    margin-right: 6px;
    padding: 0 5px;
    border: 1px solid var(--teal);
    color: var(--teal);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .facts {
    margin: 4px 0 0 28px;
    padding-left: 14px;
    color: var(--ink-soft);
    font-size: 0.8rem;
    line-height: 1.45;
  }
  .go {
    margin: 6px 0 0 28px;
    padding: 3px 12px;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .go:hover {
    background: var(--ink);
    color: var(--paper);
  }
  .note {
    margin: 8px 0 0;
    color: var(--ink-soft);
    font-size: 0.72rem;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .compact {
    position: relative;
    padding: 0;
    border: 0;
    background: none;
  }
  .compact .ask {
    padding: 4px;
  }
  /* In the dock the hints open upwards over the table, so the table keeps its size. */
  .compact .body {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    z-index: 25;
    max-height: 55dvh;
    overflow-y: auto;
    padding: 4px 10px 8px;
    border: 1.5px solid var(--teal);
    background: var(--card-bg);
    box-shadow: 0 -12px 30px -12px #000b;
    overscroll-behavior: contain;
  }
</style>
