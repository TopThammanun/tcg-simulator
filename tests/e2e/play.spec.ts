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

  // Setup choices: Active (if asked), then Bench.
  for (let i = 0; i < 3; i++) {
    const choice = page.locator('.choice');
    if (!(await choice.isVisible())) break;
    const head = await choice.locator('.head').innerText();
    if (head.includes('ตัวหลัก')) await choice.locator('.opt').first().click();
    else if (head.includes('Bench')) await choice.locator('.go').click();
    else await choice.locator('button').first().click();
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 20_000 });
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

/** Start a seeded game vs Basic Box and go through setup by tapping (Active = first option, no Bench). */
async function startGame(page: Page, seed: number) {
  await page.goto('/play/?test=1');
  await page.locator('select').first().selectOption('basic-box');
  await page.locator('input[type=number]').fill(String(seed));
  await page.getByRole('button', { name: 'เริ่มเกม' }).click();
  for (let i = 0; i < 4; i++) {
    const choice = page.locator('.choice');
    if (!(await choice.isVisible())) break;
    const head = await choice.locator('.head').innerText();
    if (head.includes('ตัวหลัก')) await choice.locator('.opt').first().click();
    else if (head.includes('Bench')) await choice.locator('.go').click();
    else await choice.locator('button').first().click();
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 20_000 });
}

const energyOnActive = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __tcg: { state: () => any } }).__tcg.state();
    return s.players[0].active.energy.length as number;
  });

test('drag an Energy from your hand onto your Active Pokémon (mouse)', async ({ page }) => {
  await startGame(page, 101);
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  const target = page.locator('.side.mine .slot.active .card');
  const a = (await card.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 30, { steps: 4 });
  const b = (await target.boundingBox())!;
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

test('the hint button explains each suggestion', async ({ page }) => {
  await startGame(page, 101);
  await page.getByRole('button', { name: 'แนะนำ 3 ทางเลือก' }).click();
  const tips = page.locator('.coach .tips > li');
  await expect(tips.first()).toBeVisible();
  await expect(tips.first().locator('.why')).toContainText('เพราะ');
  expect((await tips.first().locator('.why').innerText()).length).toBeGreaterThan(12);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('swipe a card up from the hand onto a Pokémon; swipe sideways to scroll the hand', async ({ page }) => {
    await startGame(page, 101);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await page.locator('.main').evaluate((el) => el.scrollIntoView({ block: 'start' }));

    // The dock (hand + buttons) stays on screen.
    const dock = (await page.locator('.dock').boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(844 + 1);

    const hand = (await page.locator('.hand').boundingBox())!;
    const hy = hand.y + hand.height / 2;
    await touch('touchStart', hand.x + hand.width - 40, hy);
    for (let i = 1; i <= 8; i++) await touch('touchMove', hand.x + hand.width - 40 - i * 25, hy);
    await touch('touchEnd');
    await expect.poll(() => page.locator('.hand').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    expect(await energyOnActive(page)).toBe(0);

    await page.locator('.hand').evaluate((el) => (el.scrollLeft = 0));
    const a = (await page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first().boundingBox())!;
    const b = (await page.locator('.side.mine .slot.active .card').boundingBox())!;
    const [sx, sy, tx, ty] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2 + 10];
    await touch('touchStart', sx, sy);
    for (let i = 1; i <= 12; i++) await touch('touchMove', sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12);
    await touch('touchEnd');
    await expect.poll(() => energyOnActive(page)).toBe(1);
  });

  test('long press shows the card', async ({ page }) => {
    await startGame(page, 101);
    const cdp = await page.context().newCDPSession(page);
    await page.locator('.main').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const b = (await page.locator('.side.theirs .slot.active .card').boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
