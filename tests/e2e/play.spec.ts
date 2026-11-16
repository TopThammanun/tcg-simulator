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

for (const [opp, seed] of [
  ['dragapult-ex', 7],
  ['festival-lead-seaking', 11],
  ['basic-box', 23],
] as const) {
  test(`a seeded game vs ${opp} plays to the end and the board matches the engine`, async ({ page }) => {
    await page.goto(`/play/?watch=1&test=1&speed=0&seed=${seed}&opp=${opp}`);
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

test('the decklist editor rejects unsupported cards and accepts your list', async ({ page }) => {
  await page.goto('/play/');
  await page.getByText('แก้ list ของคุณ').click();
  const area = page.getByRole('textbox', { name: 'decklist' });
  const original = await area.inputValue();
  await area.fill(original.replace('1 Judge POR 76', '1 Iono PAL 185'));
  await expect(page.locator('.errors')).toContainText('Iono');
  await expect(page.locator('.editor button.primary')).toBeDisabled();
  await area.fill(original);
  await expect(page.locator('.ok')).toContainText('60');
});

test('you can set up, attach Energy and end the turn; the bot then plays', async ({ page }) => {
  await page.goto('/play/?test=1');
  await page.locator('select').first().selectOption('basic-box');
  await page.locator('select').nth(2).selectOption('150');
  await page.locator('input[type=number]').fill('101');
  await page.getByRole('button', { name: 'เริ่มเกม' }).click();

  await setUp(page);
  const before = await engineState(page);

  // Attach an Energy card if one is playable.
  const energy = page.locator('.hcard.grab img[alt$="Energy"]').first();
  if (await energy.count()) {
    await energy.click();
    await page.locator('.side.mine .slot.target .card').first().click();
  }
  await page.getByRole('button', { name: 'จบเทิร์น' }).click();
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
  for (let i = 0; i < 8; i++) {
    if (await page.locator('.bar:not(.setup-bar)').isVisible()) break;
    const choice = page.locator('.choice');
    const setup = page.locator('.setup-bar');
    if (await choice.isVisible()) await choice.locator('button').first().click();
    else if (await setup.isVisible()) {
      if ((await setup.getAttribute('data-step')) === 'active') await page.locator('.hcard.grab').first().click();
      else await setup.getByRole('button', { name: /ยืนยัน/ }).click();
    }
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 20_000 });
}

/** Start a seeded game vs Basic Box and set up (Active = first Basic, no Bench). */
async function startGame(page: Page, seed: number) {
  await page.goto('/play/?test=1');
  await page.locator('select').first().selectOption('basic-box');
  await page.locator('input[type=number]').fill(String(seed));
  await page.getByRole('button', { name: 'เริ่มเกม' }).click();
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
  await expect(page.locator('.ghost-label')).toContainText('ติด Grass Energy ให้');
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
  await page.getByRole('button', { name: 'จบเทิร์น' }).click();
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 30_000 });
});

test('animations can be turned off', async ({ page }) => {
  await startGame(page, 101);
  await page.locator('.anim-pick select').selectOption('off');
  await expect(page.locator('html')).toHaveAttribute('data-anim', 'off');
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  await card.click();
  await page.locator('.side.mine .slot.target .card').first().click();
  expect(await energyOnActive(page)).toBe(1);
  await expect(page.locator('.fx-layer > *')).toHaveCount(0);
});

test('tapping your Active opens a pop-up with its attacks and retreating', async ({ page }) => {
  await startGame(page, 101);
  await faceUp(page, '.side.mine .slot.active .card');
  await page.locator('.side.mine .slot.active .card').click();
  const menu = page.getByRole('dialog').filter({ has: page.locator('.attacks') });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.attack').first()).toBeVisible();
  // Nothing attached yet: the attack is greyed out with the reason; no Bench, so no retreat.
  await expect(menu.locator('.attack').first()).toBeDisabled();
  await expect(menu.locator('.attack .why').first()).not.toBeEmpty();
  await expect(menu.locator('.retreat')).toContainText('ไม่มี Pokémon บน Bench');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('the hint button explains each suggestion', async ({ page }) => {
  await startGame(page, 101);
  await page.getByRole('button', { name: 'แนะนำ 3 ทางเลือก' }).click();
  const tips = page.locator('.coach .tips > li');
  await expect(tips.first()).toBeVisible();
  await expect(tips.first().locator('.why')).toContainText('เพราะ');
  expect((await tips.first().locator('.why').innerText()).length).toBeGreaterThan(12);
});

test('the threat panel shows what the opponent can do next turn, and goes away when turned off', async ({ page }) => {
  await startGame(page, 101);
  const panel = page.locator('.threat');
  await expect(panel).toContainText('ภัยเทิร์นหน้า');
  // 64 samples in the worker, reported a batch at a time; the last report says it is done.
  await expect(panel.locator('.note')).toContainText('จำลอง 64 แบบ ', { timeout: 30_000 });
  const rows = await panel.locator('.rows li').count();
  const mine = await page.evaluate(() => {
    const s = (window as unknown as { __tcg: { state: () => any } }).__tcg.state();
    return 1 + s.players[0].bench.length;
  });
  expect(rows).toBe(mine);
  await page.locator('.threat-pick input').uncheck();
  await expect(panel).toHaveCount(0);
});

test('a finished game is saved, reviewed turn by turn in under 30 s, and can be played on from a turn', async ({ page }) => {
  // A seeded game (your deck played by the bot) saved like one of yours.
  await page.goto('/play/?watch=1&test=1&speed=0&seed=7&opp=dragapult-ex&save=1');
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
  await expect(page.locator('table.games tbody tr').first()).toContainText('Dragapult ex');
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
