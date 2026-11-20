// PLAN.md: play a seeded game to the end in a real browser and check the screen matches the engine state.
import { expect, test, type Page } from '@playwright/test';

interface Snapshot {
  winner: number | 'draw' | null;
  turn: number;
  prizes: [number, number];
  hand: number;
  active: [string | null, string | null];
}

async function engineState(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = (window as unknown as { __tcg: { state: () => any } }).__tcg.state();
    const name = (p: 0 | 1) => {
      const a = s.players[p].active;
      return a ? s.cards[a.stack[a.stack.length - 1]].key : null;
    };
    return {
      winner: s.winner,
      turn: s.turn,
      prizes: [s.players[0].prizes.length, s.players[1].prizes.length],
      hand: s.players[0].hand.length,
      active: [name(0), name(1)],
    };
  });
}

// Every meta deck plays a game to the end, as yours and as the bot's (each deck meets the next one).
const DECKS = ['dragapult-ex', 'basic-box', 'slowking', 'ns-zoroark-ex', 'alakazam', 'festival-lead-seaking', 'festival-lead-dipplin'];
for (const [i, me] of DECKS.entries()) {
  const opp = DECKS[(i + 1) % DECKS.length]!;
  test(`a seeded game, ${me} vs ${opp}, plays to the end and the board matches the engine`, async ({ page }) => {
    await page.goto(`/play/?watch=1&test=1&speed=0&seed=${7 + i}&me=${me}&opp=${opp}`);
    await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
    const s = await engineState(page);
    expect(s.winner).not.toBeNull();
    // Prize piles on screen: bot first (top), then you.
    const shown = await page.locator('.prizes .n').allInnerTexts();
    expect(shown.map(Number)).toEqual([s.prizes[1], s.prizes[0]]);
    // The playmat draws the Prize cards left as face-down cards.
    expect(await page.locator('.side.theirs .prize-slot .back').count()).toBe(s.prizes[1]);
    expect(await page.locator('.side.mine .prize-slot .back').count()).toBe(s.prizes[0]);
    expect(await page.locator('.hcard').count()).toBe(s.hand);
    await expect(page.locator('.log .line').first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'จบเกม' })).toBeVisible();
  });
}

test('your own list: unsupported cards are named, a good list is saved and can be played', async ({ page }) => {
  await page.goto('/decks/');
  await page.getByRole('button', { name: '+ วาง list ใหม่' }).click();
  await page.locator('.starts').getByRole('button', { name: 'Basic Box' }).click();
  const area = page.getByRole('textbox', { name: 'decklist' });
  const original = await area.inputValue();
  await area.fill(original.replace(/^(\d+) Boss's Orders .*$/m, '$1 Iono PAL 185'));
  await expect(page.locator('.errors')).toContainText('Iono');
  await expect(page.locator('.editor button.primary')).toBeDisabled();
  await area.fill(original);
  await expect(page.locator('.ok')).toContainText('Basic Box');
  await page.getByLabel('ชื่อเด็ค').fill('Box ของฉัน');
  await page.getByRole('button', { name: 'บันทึก' }).click();
  await expect(page.locator('.list li')).toContainText('Box ของฉัน');

  await page.locator('.list li').getByRole('link', { name: /เล่น/ }).click();
  await expect(page.getByLabel('เด็คของคุณ')).toHaveValue(/^my:/);
  await page.getByRole('combobox', { name: /^คู่แข่ง/ }).selectOption('basic-box');
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await expect(page.locator('.status')).toContainText('Box ของฉัน vs Basic Box');
});

test('you can set up, attach Energy and end the turn; the bot then plays', async ({ page }) => {
  await page.goto('/play/?test=1&seed=101');
  await page.getByLabel('เด็คของคุณ').selectOption('basic-box');
  await page.getByRole('combobox', { name: /^คู่แข่ง/ }).selectOption('basic-box');
  await page.getByLabel('ความเร็วบอท').selectOption('150');
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();

  await setUp(page);
  const before = await engineState(page);

  // Attach an Energy card if one is playable.
  const energy = page.locator('.hcard.grab img[alt$="Energy"]').first();
  if (await energy.count()) {
    await energy.click();
    await page.locator('.side.mine .slot.target .card').first().click();
  }
  await endTurn(page);
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 30_000 });
  const after = await engineState(page);
  expect(after.turn).toBe(before.turn + 2);
  const shownActive = await page.locator('.side.mine .slot.active img').getAttribute('alt');
  expect(shownActive).toBeTruthy();
});

/**
 * Set up on the table like a player: answer the coin toss / mulligan boxes with their first option, tap
 * the first Basic in the hand for the Active Spot, then confirm the Bench without adding any.
 */
async function setUp(page: Page) {
  // The engine's phase, not the status line: "ตาคุณ" shows during setup too, so a stuck setup would only show up
  // later as a timeout somewhere else.
  const phase = () => page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state()?.phase as string | undefined);
  for (let i = 0; i < 30 && (await phase()) !== 'main'; i++) {
    const choice = page.locator('.choice');
    const setup = page.locator('.setup-bar');
    if (await choice.isVisible()) await choice.locator('button').first().click();
    else if (await setup.isVisible()) {
      if ((await setup.getAttribute('data-step')) === 'active') await page.locator('.hcard.grab').first().click();
      else await setup.getByRole('button', { name: /ยืนยัน/ }).click();
    }
    await page.waitForTimeout(300);
  }
  expect(await phase(), 'setup did not finish').toBe('main');
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 20_000 });
}

/** End the turn; when an attack is still usable the dock asks first, and the answer is to end it. */
async function endTurn(page: Page) {
  const end = page.getByRole('button', { name: 'จบเทิร์น', exact: true });
  const warn = page.getByRole('alertdialog', { name: 'ยังโจมตีได้' });
  await end.click();
  // Either the turn ended (the button goes with it) or the dock asks.
  await expect.poll(async () => (await warn.isVisible()) || !(await end.isVisible())).toBe(true);
  if (await warn.isVisible()) await warn.getByRole('button', { name: 'จบเทิร์นเลย' }).click();
}

/** Start a seeded game, Basic Box vs Basic Box, and set up (Active = first Basic, no Bench). */
async function startGame(page: Page, seed: number) {
  await page.goto(`/play/?test=1&seed=${seed}&me=basic-box&opp=basic-box`);
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await setUp(page);
}

/** A card on the table once it has turned face up (setup ends with both sides flipping their Pokémon). */
async function faceUp(page: Page, selector: string) {
  const card = page.locator(selector);
  await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeGreaterThan(20);
  return (await card.boundingBox())!;
}

const energyOnActive = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __tcg: { state: () => any } }).__tcg.state();
    return s.players[0].active.energy.length as number;
  });

test('drag an Energy from your hand onto your Active Pokémon (mouse)', async ({ page }) => {
  await startGame(page, 101);
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  const a = (await card.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 30, { steps: 4 });
  const b = await faceUp(page, '.side.mine .slot.active .card');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await expect(page.locator('.ghost-label')).toContainText(/ติด \w+ Energy ให้/);
  await page.mouse.up();
  await expect.poll(() => energyOnActive(page)).toBe(1);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
});

test('a drop outside any target does nothing', async ({ page }) => {
  await startGame(page, 101);
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  const a = (await card.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 60, { steps: 6 });
  await page.mouse.up();
  expect(await energyOnActive(page)).toBe(0);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
});

test('a played card flies to its place, and acting meanwhile skips the animation', async ({ page }) => {
  await startGame(page, 101);
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  await card.click();
  await page.locator('.side.mine .slot.target .card').first().click();
  // The state changes at once; a copy of the card flies over the board.
  expect(await energyOnActive(page)).toBe(1);
  await expect(page.locator('.fx-layer .fx-card')).not.toHaveCount(0);
  await endTurn(page);
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 30_000 });
});

test('animations can be turned off', async ({ page }) => {
  await startGame(page, 101);
  await page.locator('.anim-pick select').selectOption('off');
  await expect(page.locator('html')).toHaveAttribute('data-anim', 'off');
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  // Beside "จบเทิร์น": nothing used yet (you went first: no Supporter on turn 1).
  await expect(page.locator('.uses .use.used')).toHaveCount(0);
  await expect(page.locator('.uses .use.barred')).toHaveText('Supporter');
  await card.click();
  await page.locator('.side.mine .slot.target .card').first().click();
  expect(await energyOnActive(page)).toBe(1);
  await expect(page.locator('.fx-layer > *')).toHaveCount(0);
  await expect(page.locator('.uses .use.used')).toHaveText('✓ ติดพลังงาน');
});

test('tapping your Active opens a pop-up with its attacks and retreating', async ({ page }) => {
  await startGame(page, 101);
  await faceUp(page, '.side.mine .slot.active .card');
  await page.locator('.side.mine .slot.active .card').click();
  const menu = page.getByRole('dialog').filter({ has: page.locator('.attacks') });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.attack').first()).toBeVisible();
  // Nothing attached yet: the attack's button is greyed out with the reason; no Bench, so no retreat.
  await expect(menu.locator('.attack .go').first()).toBeDisabled();
  await expect(menu.locator('.attack .why').first()).not.toBeEmpty();
  // Reading an attack never uses it: only its button does.
  await menu.locator('.attack .aname').first().click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.retreat')).toContainText('ไม่มี Pokémon บน Bench');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('a game is played as at a real table: no hints, threat panel or undo', async ({ page }) => {
  await startGame(page, 101);
  await expect(page.getByRole('button', { name: 'แนะนำ 3 ทางเลือก' })).toHaveCount(0);
  await expect(page.locator('.threat')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ย้อน' })).toHaveCount(0);
});

test('a deck search shows your whole deck, the cards you may take lit; a tap picks a card up, a second tap plays it', async ({ page }) => {
  // Dragapult ex, seed 2024: Buddy-Buddy Poffin in hand on your first turn.
  await page.goto('/play/?test=1&seed=2024&me=dragapult-ex&opp=basic-box');
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await setUp(page);
  const poffin = page.locator('.hcard.grab').filter({ has: page.locator('img[alt="Buddy-Buddy Poffin"]') }).first();
  await poffin.click();
  // Picked up, not played: the dock offers to play it.
  await expect(page.getByRole('button', { name: 'ใช้ Buddy-Buddy Poffin' })).toBeVisible();
  await expect(page.locator('.choice')).toHaveCount(0);
  await poffin.click();

  const choice = page.locator('.choice.zone');
  await expect(choice).toBeVisible();
  const deck = await page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state().players[0].deck.length as number);
  await expect(choice.locator('.opt')).toHaveCount(deck);
  const lit = choice.locator('.opt:not(.off)');
  expect(await lit.count()).toBeGreaterThan(0);
  expect(await choice.locator('.opt.off').count()).toBeGreaterThan(0);
  // A dimmed card can't be picked; two lit ones can.
  await choice.locator('.opt.off').first().dispatchEvent('click');
  await expect(choice.locator('.opt.on')).toHaveCount(0);
  const bench = await page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state().players[0].bench.length as number);
  await lit.nth(0).click();
  await lit.nth(1).click();
  await expect(choice.locator('.opt.on')).toHaveCount(2);
  await choice.getByRole('button', { name: 'ยืนยัน' }).click();
  await expect(choice).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state().players[0].bench.length as number)).toBe(bench + 2);
  // The picks went in as plain data (a $state proxy could not be posted to the bot's worker or saved).
  const cloned = await page.evaluate(() => {
    const t = (window as unknown as { __tcg: { state: () => unknown; history: () => unknown[] } }).__tcg;
    try {
      structuredClone(t.history());
      structuredClone(t.state());
      return 'ok';
    } catch (e) {
      return String(e);
    }
  });
  expect(cloned).toBe('ok');
});

/** Play from a position built here: Dragapult ex (Fire + Psychic) Active, Dreepy (Psychic) and Drakloak on the Bench,
 * Energy Switch in hand; the bot's Budew (30 HP) Active; you pick your Prize cards. */
async function loadPosition(page: Page) {
  await page.goto('/play/?test=1&seed=5&me=dragapult-ex&opp=basic-box');
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await expect(page.locator('.board')).toBeVisible();
  await page.evaluate(() => {
    const cards: { id: number; key: string; owner: 0 | 1 }[] = [];
    const make = (key: string, owner: 0 | 1) => (cards.push({ id: cards.length, key, owner }), cards.length - 1);
    let uid = 1;
    const slot = (key: string, owner: 0 | 1, energy: string[] = []) => ({
      uid: uid++, stack: [make(key, owner)], energy: energy.map((k) => make(k, owner)), tool: null, damage: 0,
      enteredTurn: 0, evolvedTurn: -1, conditions: [], marks: [], usedAbility: {},
    });
    const side = (p: 0 | 1, active: ReturnType<typeof slot>, bench: ReturnType<typeof slot>[], hand: string[]) => ({
      active, bench, hand: hand.map((k) => make(k, p)), deck: Array.from({ length: 20 }, () => make('psychic-energy', p)), discard: [],
      prizes: ['fire-energy', 'budew', 'judge', 'dreepy', 'psychic-energy', 'meowth-ex'].map((k) => make(k, p)),
      supporterPlayed: false, energyAttached: false, retreated: false, stadiumPlayed: false, namedUsed: [], buffs: [],
      itemLockTurn: -1, koLastTurn: false, koByAttackLastTurn: false, koThisTurn: false, koByAttackThisTurn: false,
      mulligans: 0, knownTop: [],
    });
    const players = [
      side(0, slot('dragapult-ex', 0, ['fire-energy', 'psychic-energy']), [slot('dreepy', 0, ['psychic-energy']), slot('drakloak', 0)], ['energy-switch', 'judge', 'unfair-stamp']),
      side(1, slot('budew', 1), [slot('dreepy', 1)], []),
    ];
    const s = {
      seed: 1, turn: 5, current: 0, first: 0, phase: 'main', players, stadium: null, cards, rng: { shuffle: [11, 22], coin: 33 },
      nextUid: uid, pending: null, winner: null, winReason: '', log: [], quiet: false, steps: 0,
      rules: { twinShotelsPiercesBenchShields: false, pickPrizes: true }, names: ['คุณ', 'บอท'],
    };
    (window as unknown as { __tcg: { load: (s: unknown) => void } }).__tcg.load(s);
  });
  await page.locator('.anim-pick select').selectOption('off');
}

const state = (page: Page) => page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state());

test('a hand card is read before it is played; Energy Switch is answered on the table; you pick your Prize card', async ({ page }) => {
  await loadPosition(page);
  // The hand is shown sorted: the Supporter first, then the Items by name.
  await expect
    .poll(() => page.locator('.hcard img').evaluateAll((els) => els.map((e) => e.getAttribute('alt'))))
    .toEqual(['Judge', 'Energy Switch', 'Unfair Stamp']);
  // The bot's Pokémon, tapped: the card large with its state in play.
  await page.locator('.side.theirs .slot.active .card').click();
  const zoomed = page.getByRole('dialog', { name: 'Budew' });
  await expect(zoomed.getByLabel('สถานะในสนาม')).toContainText('ของบอท · ตัวหลัก');
  await expect(zoomed.getByLabel('สถานะในสนาม')).toContainText('HP 30/30');
  await zoomed.getByRole('button', { name: 'ปิด' }).click();
  // A card that can't be played says why.
  await page.locator('.hcard').filter({ has: page.locator('img[alt="Unfair Stamp"]') }).click();
  await expect(page.locator('.detail-layer .why')).toContainText('ถูก KO');
  await page.locator('.detail-layer').getByRole('button', { name: 'ปิด' }).click();
  // A tap shows the card's text and a button; nothing is played yet.
  await page.locator('.hcard').filter({ has: page.locator('img[alt="Energy Switch"]') }).click();
  const detail = page.locator('.detail-layer');
  await expect(detail).toContainText('Move a Basic Energy');
  expect((await state(page)).pending).toBeNull();
  await detail.getByRole('button', { name: 'ใช้ Energy Switch' }).click();

  // From which Pokémon: tapped on the table (no box over it); the others step back.
  await expect(page.locator('.choice-layer')).toHaveCount(0);
  await expect(page.locator('.side.theirs .slot.dim').first()).toBeVisible();
  await page.locator('.side.mine .slot.active .card').click();
  // Which Energy: its pip on that Pokémon; what was picked so far stays in the bar.
  await expect(page.locator('.dock')).toContainText('จาก Dragapult ex');
  await page.getByRole('button', { name: 'เลือก Psychic Energy' }).click();
  // Where to: Drakloak.
  await expect(page.locator('.dock')).toContainText('Psychic Energy');
  const drakloak = (await state(page)).players[0].bench[1].uid;
  await page.locator(`[data-slot="${drakloak}"] .card`).click();
  await expect.poll(async () => (await state(page)).players[0].bench[1].energy.length).toBe(1);

  // Attack: its own button in the pop-up. Budew is Knocked Out and you pick the 4th Prize card (a Dreepy here).
  // Ending the turn with an attack still there asks first; going back opens the attacks.
  await page.getByRole('button', { name: 'จบเทิร์น', exact: true }).click();
  const warn = page.getByRole('alertdialog', { name: 'ยังโจมตีได้' });
  await expect(warn).toContainText('Jet Headbutt');
  await warn.getByRole('button', { name: 'กลับไปโจมตี' }).click();
  await expect(warn).toHaveCount(0);
  expect((await state(page)).turn).toBe(5);
  // The attack says what it would do: Budew has 30 HP left.
  const headbutt = page.locator('.pmenu .attack').filter({ hasText: 'Jet Headbutt' });
  await expect(headbutt.locator('.pv')).toHaveText('KO ตัวหลักได้แน่นอน');
  await headbutt.getByRole('button').click();
  const prizes = page.locator('.side.mine .prize-slot.pick');
  await expect(prizes).toHaveCount(6);
  await prizes.nth(3).click();
  await expect.poll(async () => (await state(page)).players[0].prizes.length).toBe(5);
  const s = await state(page);
  expect(s.players[0].hand.map((c: number) => s.cards[c].key)).toContain('dreepy');
  // The taken Prize leaves its gap where it was.
  await expect(page.locator('.side.mine .prize-grid > :nth-child(4) > *')).toHaveCount(0);
  await expect(page.locator('.side.mine .prize-grid > :nth-child(5) > *')).toHaveCount(1);

  // The bot plays turn 6; when yours starts, what it did is listed over its side.
  await expect.poll(async () => { const t = await state(page); return t.turn === 7 && t.current === 0 && !t.pending; }, { timeout: 30_000 }).toBe(true);
  const recap = page.getByLabel('เทิร์นที่แล้วของบอท');
  await expect(recap).toContainText('บอท');
  await recap.getByRole('button', { name: 'ปิด' }).click();
  await expect(recap).toHaveCount(0);
});

test('a finished game is saved, reviewed turn by turn in under 30 s, and can be played on from a turn', async ({ page }) => {
  // A seeded game (your deck played by the bot) saved like one of yours.
  await page.goto('/play/?watch=1&test=1&speed=0&seed=7&me=basic-box&opp=dragapult-ex&save=1');
  await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
  // The game-over dialog covers the table; its link opens the review.
  const link = page.getByRole('dialog', { name: 'จบเกม' }).getByRole('link', { name: /วิจารณ์เกมนี้/ });
  await expect(link).toBeVisible();
  const started = Date.now();
  await link.click();

  // Every turn of yours reviewed on the workers.
  await expect(page.locator('.summary')).toContainText('เทิร์นของคุณ', { timeout: 30_000 });
  const seconds = (Date.now() - started) / 1000;
  console.log(`review of a ${await page.locator('.turns > li').count()}-turn game: ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(30);
  const turns = page.locator('.turns > li');
  expect(await turns.count()).toBeGreaterThan(2);
  await expect(page.locator('figure.chart svg path.line')).toBeVisible();
  await expect(turns.first().locator('.badge')).toBeVisible();

  // The board of a turn with every hidden card shown.
  await turns.first().getByRole('button', { name: 'ดูสนาม' }).click();
  const viewer = page.locator('.viewer');
  await expect(viewer.locator('.board')).toBeVisible();
  await expect(viewer.locator('h4', { hasText: 'Prize ของบอท' })).toBeVisible();
  expect(await viewer.locator('.cards').nth(1).locator('button').count()).toBeGreaterThan(0);

  // Reopening the review is instant (stored with the game).
  await page.reload();
  await expect(page.locator('.summary')).toContainText('เทิร์นของคุณ', { timeout: 3_000 });

  // Play on from the second turn of yours: the same position, and it is your move.
  const second = page.locator('.turns > li').nth(1);
  const turnNo = Number((await second.locator('strong').first().innerText()).replace(/\D/g, ''));
  const href = await second.getByRole('link', { name: /ลองเล่นใหม่จากตรงนี้/ }).getAttribute('href');
  await page.goto(`${href}&test=1`);
  await expect(page.locator('.status')).toContainText('เล่นต่อจากเกมที่บันทึกไว้');
  await expect(page.locator('.status')).toContainText('ตาคุณ');
  const s = await engineState(page);
  expect(s.turn).toBe(turnNo);
  expect(s.winner).toBeNull();

  // The game list has it.
  await page.goto('/review/');
  await expect(page.locator('.games li').first()).toContainText('Basic Box vs Dragapult ex');
  await expect(page.locator('.record')).toContainText('1');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the game fits the screen with every card in hand showing; swipe one up onto a Pokémon', async ({ page }) => {
    await startGame(page, 101);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

    // Nothing scrolls: the table, the buttons and the whole hand are on screen.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    const dock = (await page.locator('.dock').boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(844 + 1);
    expect(await page.locator('.hand').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    const cards = await page.locator('.hcard .cardbox').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(cards.length).toBeGreaterThan(5);
    for (const c of cards) {
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.right).toBeLessThanOrEqual(390);
      expect(c.bottom).toBeLessThanOrEqual(844);
    }

    const a = (await page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first().boundingBox())!;
    const b = await faceUp(page, '.side.mine .slot.active .card');
    const [sx, sy, tx, ty] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2 + 10];
    await touch('touchStart', sx, sy);
    for (let i = 1; i <= 12; i++) await touch('touchMove', sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12);
    await touch('touchEnd');
    await expect.poll(() => energyOnActive(page)).toBe(1);
  });

  test('long press shows the card', async ({ page }) => {
    await startGame(page, 101);
    const cdp = await page.context().newCDPSession(page);
    const b = await faceUp(page, '.side.theirs .slot.active .card');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
