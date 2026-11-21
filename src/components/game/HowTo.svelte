<script lang="ts">
  // วิธีเล่น: how the table works, shown before your first game and from the "วิธีเล่น" button.
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { motion } from '../../ui/anim/motion';

  let { onclose }: { onclose: () => void } = $props();

  const STEPS = [
    { title: 'วางตัวเริ่มเกม', text: 'ลาก Basic Pokémon จากมือไปช่องตัวหลัก (หรือแตะการ์ด) แล้วเลือกลง Bench กดยืนยัน' },
    {
      title: 'อ่านแล้วเล่นการ์ดจากมือ',
      text: 'แตะการ์ดในมือเพื่ออ่านเอฟเฟกต์ (ยังไม่ใช้) แล้วแตะซ้ำ กดปุ่มใช้ หรือแตะ Pokémon ที่สว่าง · ลากไปวางก็ได้: พลังงาน Tool ร่างวิวัฒนาการวางบน Pokémon, Basic ลง Bench, Item Supporter Stadium วางตรงไหนก็ได้',
    },
    { title: 'โจมตี ถอย ใช้ Ability', text: 'แตะ Pokémon ของคุณเพื่ออ่านท่า แล้วกดปุ่ม "โจมตี" ของท่านั้น · ถอย: แตะตัวที่จะขึ้นมาแทน แล้วกดยืนยัน' },
    {
      title: 'เลือกบนสนาม',
      text: 'การ์ดที่ให้เลือก Pokémon (ตัวขึ้นแทนตัวที่ถูก KO, Boss\'s Orders) หรือพลังงานบน Pokémon (Energy Switch) ให้แตะบนสนามได้เลย · Prize ก็เลือกใบเองได้',
    },
    { title: 'ดูการ์ดและย้อนดูสนาม', text: 'คลิกขวาหรือกดค้างที่การ์ดเพื่อดูใบใหญ่ · กดบรรทัดใน log เพื่อดูสนามตอนนั้น' },
    {
      title: 'คีย์ลัด (คอมพิวเตอร์)',
      text: 'E จบเทิร์น (ถ้ายังโจมตีได้ กด E อีกครั้งเพื่อยืนยัน) · A ท่าโจมตีของตัวหลัก · 1–9 หยิบการ์ดใบที่ N ในมือ · Enter ใช้การ์ดที่หยิบ / ยืนยันที่เลือก · Esc ปิด',
    },
    {
      title: 'ค้นการ์ดจากเด็ค',
      text: 'การ์ดที่ให้ค้นเด็คจะเปิดให้เห็นทั้งเด็คเหมือนเล่นจริง ใบที่เลือกได้สว่าง ใบอื่นจาง · ไม่อยากเอาก็กด "ไม่เอาการ์ด" ได้',
    },
  ];

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="backdrop" role="presentation" onclick={onclose} transition:fade={{ duration: motion(180) }}></div>
<div class="howto" role="dialog" aria-modal="true" aria-label="วิธีเล่น" in:scale={{ duration: motion(240), start: 0.97, easing: cubicOut }}>
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
    background: #0d1014b3;
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
    padding: 32px;
    background: var(--card-bg);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius-xl);
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
    grid-template-columns: 2rem 1fr;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }
  .n {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--ink-soft);
  }
  strong {
    font-weight: 600;
  }
  p {
    margin: 2px 0 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .primary {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    border-radius: var(--radius);
  }
  .primary:hover {
    border-color: var(--press);
    background: var(--press);
  }
  @media (prefers-reduced-motion: no-preference) {
    li {
      animation: rise 0.3s ease-out both;
      animation-delay: calc(60ms + var(--i) * 30ms);
    }
    @keyframes rise {
      from {
        opacity: 0;
      }
    }
  }
</style>
