<script lang="ts">
  // วิธีเล่น: how the table works, from the match sheet's "วิธีเล่น" and the game menu (the first game isn't held up by
  // it: tips come up in the command bar when their moment comes, ui/tips.ts).
  import { tx } from '../../i18n';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { motion } from '../../ui/anim/motion';

  let { onclose }: { onclose: () => void } = $props();

  const STEPS = [
    { title: tx('เริ่มเกม: วาง Pokémon', 'Set up'), text: tx('ลาก Basic Pokémon จากมือไปวางที่ช่องตัวหลัก (หรือแตะการ์ด) แล้วเลือกตัวที่จะลง Bench จากนั้นกดยืนยัน', 'Drag a Basic Pokémon from your hand to the Active Spot (or tap the card), then pick your Bench and confirm') },
    {
      title: tx('อ่านการ์ดก่อน แล้วค่อยเล่น', 'Read, then play cards from your hand'),
      text: tx('แตะการ์ดในมือเพื่ออ่านก่อน (การ์ดยังไม่ถูกใช้) จะใช้ก็แตะซ้ำ กดปุ่มในแถบใต้สนาม หรือแตะ Pokémon ที่สว่าง · จะลากไปวางก็ได้: พลังงาน, Tool และร่างวิวัฒนาการวางบน Pokémon, Basic วางลง Bench ส่วน Item, Supporter และ Stadium วางตรงไหนของสนามก็ได้', 'Tap a card in your hand to read it (nothing is played yet), then tap it again, press the button in the bar under the table, or tap a lit Pokémon · or drag it: Energy, Tools and Evolutions onto a Pokémon, Basics to the Bench, Items, Supporters and Stadiums anywhere'),
    },
    { title: tx('โจมตี ถอย ใช้ Ability', 'Attack, retreat, use Abilities'), text: tx('แตะ Pokémon ของคุณเพื่อดูท่า แล้วกดปุ่ม "โจมตี" ของท่าที่ต้องการ · จะถอย ให้แตะตัวที่จะขึ้นมาแทน แล้วกดยืนยัน', 'Tap your Pokémon to read its attacks, then press that attack\'s "Attack" button · to retreat, tap the Pokémon to switch in, then confirm') },
    {
      title: tx('เลือกเป้าหมายบนสนาม', 'Choosing on the table'),
      text: tx('เมื่อการ์ดให้เลือก Pokémon (เช่น ตัวที่จะขึ้นแทนตัวที่โดน KO หรือเป้าของ Boss\'s Orders) หรือพลังงานบน Pokémon (เช่น Energy Switch) แตะบนสนามได้เลย · ตอนหยิบ Prize ก็เลือกใบเองได้', "When a card asks for a Pokémon (a new Active after a Knock Out, Boss's Orders) or an Energy on a Pokémon (Energy Switch), tap it on the table · you pick your own Prize cards too"),
    },
    {
      title: tx('อ่านการ์ดและย้อนดูสนาม', 'Reading cards and looking back'),
      text: tx('คอมพิวเตอร์: ชี้เมาส์ที่การ์ด ข้อความเต็มจะขึ้นในช่องทางขวา · มือถือ: กดค้างที่การ์ดเพื่อดูใบใหญ่ · แตะบรรทัดในบันทึกเกมเพื่อย้อนดูสนามตอนนั้น (มือถือ: ปุ่มบันทึกเกมมุมขวาบน)', 'Computer: point at a card and its full text shows in the panel on the right · phone: press and hold a card to see it large · tap a line in the log to see the table at that point (phone: the log button at the top right)'),
    },
    {
      title: tx('เมนูเกม', 'Game menu'),
      text: tx('ปุ่ม ☰ มุมซ้ายบน: เริ่มเกมใหม่ ปรับความเร็วบอท ภาพเคลื่อนไหว และเสียง · เกมที่ยังไม่จบจะเก็บไว้ในเบราว์เซอร์ ปิดหน้าไปแล้วกลับมาเล่นต่อได้', 'The ☰ button at the top left: new game, bot speed, animation, sound · an unfinished game is kept in the browser, so you can close the page and come back to it'),
    },
    {
      title: tx('คีย์ลัด (คอมพิวเตอร์)', 'Shortcuts (computer)'),
      text: tx('E จบเทิร์น (ถ้ายังโจมตีได้ ให้กด E อีกครั้งเพื่อยืนยัน) · A เปิดท่าโจมตีของตัวหลัก · 1–9 หยิบการ์ดใบนั้นในมือ · Enter ใช้การ์ดที่หยิบไว้หรือยืนยันที่เลือก · Esc ปิด', "E ends the turn (if you can still attack, press E again to confirm) · A your Active Pokémon's attacks · 1–9 pick up card N in your hand · Enter plays the card picked up / confirms a choice · Esc closes"),
    },
    {
      title: tx('ค้นการ์ดจากเด็ค', 'Searching your deck'),
      text: tx('เวลาค้นเด็ค คุณจะเห็นการ์ดทั้งกองเหมือนเล่นจริง ใบที่หยิบได้จะสว่าง ใบอื่นจะจาง · ถ้าไม่อยากหยิบใบไหนเลย กด "ไม่เอาการ์ด" ได้', 'A search shows your whole deck as at a real table: the cards you may take are lit, the rest dimmed · press "Take none" if you don\'t want any'),
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
