<script lang="ts">
  // วิธีเล่น: how the table works, from the match sheet's "วิธีเล่น" and the game menu (the first game isn't held up by
  // it: tips come up in the command bar when their moment comes, ui/tips.ts).
  import { tx } from '../../i18n';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { motion } from '../../ui/anim/motion';

  let { onclose }: { onclose: () => void } = $props();

  const STEPS = [
    { title: tx('วางตัวเริ่มเกม', 'Set up'), text: tx('ลาก Basic Pokémon จากมือไปช่องตัวหลัก (หรือแตะการ์ด) แล้วเลือกลง Bench กดยืนยัน', 'Drag a Basic Pokémon from your hand to the Active Spot (or tap the card), then pick your Bench and confirm') },
    {
      title: tx('อ่านแล้วเล่นการ์ดจากมือ', 'Read, then play cards from your hand'),
      text: tx('แตะการ์ดในมือเพื่ออ่านเอฟเฟกต์ (ยังไม่ใช้) แล้วแตะซ้ำ กดปุ่มใช้ในแถบใต้สนาม หรือแตะ Pokémon ที่สว่าง · ลากไปวางก็ได้: พลังงาน Tool ร่างวิวัฒนาการวางบน Pokémon, Basic ลง Bench, Item Supporter Stadium วางตรงไหนก็ได้', 'Tap a card in your hand to read it (nothing is played yet), then tap it again, press the button in the bar under the table, or tap a lit Pokémon · or drag it: Energy, Tools and Evolutions onto a Pokémon, Basics to the Bench, Items, Supporters and Stadiums anywhere'),
    },
    { title: tx('โจมตี ถอย ใช้ Ability', 'Attack, retreat, use Abilities'), text: tx('แตะ Pokémon ของคุณเพื่ออ่านท่า แล้วกดปุ่ม "โจมตี" ของท่านั้น · ถอย: แตะตัวที่จะขึ้นมาแทน แล้วกดยืนยัน', 'Tap your Pokémon to read its attacks, then press that attack\'s "Attack" button · to retreat, tap the Pokémon to switch in, then confirm') },
    {
      title: tx('เลือกบนสนาม', 'Choosing on the table'),
      text: tx('การ์ดที่ให้เลือก Pokémon (ตัวขึ้นแทนตัวที่ถูก KO, Boss\'s Orders) หรือพลังงานบน Pokémon (Energy Switch) ให้แตะบนสนามได้เลย · Prize ก็เลือกใบเองได้', "When a card asks for a Pokémon (a new Active after a Knock Out, Boss's Orders) or an Energy on a Pokémon (Energy Switch), tap it on the table · you pick your own Prize cards too"),
    },
    {
      title: tx('อ่านการ์ดและย้อนดูสนาม', 'Reading cards and looking back'),
      text: tx('คอมพิวเตอร์: ชี้เมาส์ที่การ์ด ข้อความเต็มขึ้นในช่องด้านขวา · มือถือ: กดค้างที่การ์ดเพื่อดูใบใหญ่ · กดบรรทัดใน log เพื่อดูสนามตอนนั้น (มือถือ: ปุ่ม log มุมขวาบน)', 'Computer: point at a card and its full text shows in the panel on the right · phone: press and hold a card to see it large · tap a line in the log to see the table at that point (phone: the log button at the top right)'),
    },
    {
      title: tx('เมนูเกม', 'Game menu'),
      text: tx('ปุ่ม ☰ มุมซ้ายบน: เกมใหม่ ความเร็วบอท Animation เสียง · เกมที่ยังไม่จบเก็บไว้ในเบราว์เซอร์ ปิดหน้าแล้วกลับมาเล่นต่อได้', 'The ☰ button at the top left: new game, bot speed, animation, sound · an unfinished game is kept in the browser, so you can close the page and come back to it'),
    },
    {
      title: tx('คีย์ลัด (คอมพิวเตอร์)', 'Shortcuts (computer)'),
      text: tx('E จบเทิร์น (ถ้ายังโจมตีได้ กด E อีกครั้งเพื่อยืนยัน) · A ท่าโจมตีของตัวหลัก · 1–9 หยิบการ์ดใบที่ N ในมือ · Enter ใช้การ์ดที่หยิบ / ยืนยันที่เลือก · Esc ปิด', "E ends the turn (if you can still attack, press E again to confirm) · A your Active Pokémon's attacks · 1–9 pick up card N in your hand · Enter plays the card picked up / confirms a choice · Esc closes"),
    },
    {
      title: tx('ค้นการ์ดจากเด็ค', 'Searching your deck'),
      text: tx('การ์ดที่ให้ค้นเด็คจะเปิดให้เห็นทั้งเด็คเหมือนเล่นจริง ใบที่เลือกได้สว่าง ใบอื่นจาง · ไม่อยากเอาก็กด "ไม่เอาการ์ด" ได้', 'A search shows your whole deck as at a real table: the cards you may take are lit, the rest dimmed · press "Take none" if you don\'t want any'),
    },
  ];

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="backdrop" role="presentation" onclick={onclose} transition:fade={{ duration: motion(180) }}></div>
<div class="howto" role="dialog" aria-modal="true" aria-label={tx('วิธีเล่น', 'How to play')} in:scale={{ duration: motion(240), start: 0.97, easing: cubicOut }}>
  <p class="eyebrow">{tx('คู่มือ', 'Guide')}</p>
  <h2>{tx('วิธีเล่น', 'How to play')}</h2>
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
  <button type="button" class="primary" onclick={onclose}>{tx('เข้าใจแล้ว', 'Got it')}</button>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: color-mix(in srgb, var(--paper) 70%, transparent);
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
    font-size: 30px;
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
    font-size: 14px;
    line-height: 1.6;
    color: var(--ink-soft);
  }
  strong {
    font-weight: 600;
  }
  p {
    margin: 2px 0 0;
    color: var(--ink-soft);
    font-size: 14px;
  }
  .primary {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
    font-size: 16px;
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
