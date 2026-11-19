<script lang="ts">
  // วิธีเล่น: how the table works, shown before your first game and from the "วิธีเล่น" button.
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { motion } from '../../ui/anim/motion';

  let { onclose }: { onclose: () => void } = $props();

  const STEPS = [
    { title: 'วางตัวเริ่มเกม', text: 'ลาก Basic Pokémon จากมือไปช่องตัวหลัก (หรือแตะการ์ด) แล้วเลือกลง Bench กดยืนยัน' },
    {
      title: 'เล่นการ์ดจากมือ',
      text: 'ลากการ์ดไปวาง: พลังงาน Tool และร่างวิวัฒนาการวางบน Pokémon, Basic ลง Bench, Item Supporter Stadium วางตรงไหนก็ได้บนสนาม หรือแตะการ์ดแล้วแตะเป้าหมาย',
    },
    { title: 'โจมตี ถอย ใช้ Ability', text: 'แตะ Pokémon ของคุณ เมนูจะบอกท่าที่ใช้ได้ และเหตุผลถ้ายังใช้ไม่ได้' },
    { title: 'ดูการ์ดและย้อนดูสนาม', text: 'คลิกขวาหรือกดค้างที่การ์ดเพื่อดูใบใหญ่ · กดบรรทัดใน log เพื่อดูสนามตอนนั้น' },
    {
      title: 'โหมดฝึก',
      text: 'ป้าย KO% บนการ์ดคือโอกาสโดน KO เทิร์นหน้าถ้าจบเทิร์นตอนนี้ · ปุ่มแนะนำให้ 3 ทางเลือกพร้อมเหตุผล · ย้อนได้ และการ์ดที่มองไม่เห็นจะถูกสับใหม่',
    },
  ];

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="backdrop" role="presentation" onclick={onclose} transition:fade={{ duration: motion(180) }}></div>
<div class="howto" role="dialog" aria-modal="true" aria-label="วิธีเล่น" in:scale={{ duration: motion(320), start: 0.92, easing: backOut }}>
  <p class="eyebrow">ก่อนเริ่ม</p>
  <h2>วิธีเล่น</h2>
  <ol>
    {#each STEPS as s, i}
      <li style:--i={i}>
        <span class="n" aria-hidden="true">{i + 1}</span>
        <div>
          <strong>{s.title}</strong>
          <p>{s.text}</p>
        </div>
      </li>
    {/each}
  </ol>
  <button type="button" class="primary" onclick={onclose}>เข้าใจแล้ว เริ่มเล่น</button>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: #0b0a07b3;
  }
  .howto {
    position: fixed;
    z-index: 61;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 24px 24px 20px;
    background: var(--card-bg);
    border: 2px solid var(--ink);
    box-shadow: 8px 8px 0 var(--stamp);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 1.8rem;
  }
  ol {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 2.4rem 1fr;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }
  .n {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.9rem;
    line-height: 1;
    color: var(--stamp);
  }
  strong {
    font-family: var(--font-display);
  }
  p {
    margin: 2px 0 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .primary {
    width: 100%;
    padding: 10px 14px;
    border: 2px solid var(--ink);
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
  }
  @media (prefers-reduced-motion: no-preference) {
    li {
      animation: rise 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
      animation-delay: calc(80ms + var(--i) * 50ms);
    }
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
  }
</style>
