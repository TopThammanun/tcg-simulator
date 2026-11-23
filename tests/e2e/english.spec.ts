// The English site (/en/…): its own pages for search engines, a link to the same page in Thai, and a game and its
// review with no Thai on screen.
import { expect, test, type Page } from '@playwright/test';

const THAI = /[฀-๿]/;

/** The page's visible text without the link to the Thai site. */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.lang-switch, script, style').forEach((el) => el.remove());
    return clone.innerText;
  });
}

test('the English pages are built in English and point at their Thai versions', async ({ page }) => {
  for (const path of ['/en/', '/en/decks/', '/en/decks/dragapult-ex/', '/en/builder/', '/en/review/']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('link[rel="alternate"][hreflang="th"]')).toHaveAttribute('href', path.replace(/^\/en/, ''));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', path);
    await page.waitForLoadState('networkidle');
    expect(await visibleText(page)).not.toMatch(THAI);
  }
  // The Thai page links back to the English one.
  await page.goto('/decks/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(page.locator('.nav .lang-switch')).toHaveAttribute('href', '/en/decks/');
});

test('every page has its keywords, its own description and schema.org data', async ({ page }) => {
  const ld = () => page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((e) => JSON.parse(e.textContent!)['@type'] as string));
  for (const path of ['/', '/en/', '/en/builder/', '/decks/dragapult-ex/']) {
    await page.goto(path);
    await expect(page.locator('meta[name="keywords"]')).toHaveAttribute('content', /Pokémon TCG/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Pokémon TCG/);
    await expect(page).toHaveTitle(/Pokémon TCG/);
    expect(await ld()).toContain('WebSite');
  }
  await page.goto('/en/');
  expect(await ld()).toEqual(expect.arrayContaining(['WebApplication', 'FAQPage']));
  // Anyone whose language is neither gets the English page.
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', '/en/');
});

// A person's browser, not a headless one (Base.astro leaves crawlers and automated browsers where they are).
const PERSON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

test.describe('a visitor from abroad', () => {
  test.use({ locale: 'en-US', timezoneId: 'Europe/London', userAgent: PERSON });
  test('opening a Thai page gets the English one, until they pick Thai', async ({ page }) => {
    // Automated browsers are left on the page they asked for (crawlers): this one plays a person.
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    await page.goto('/decks/?x=1#mine');
    await expect(page).toHaveURL(/\/en\/decks\/\?x=1#mine$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('.nav .lang-switch').click();
    await expect(page).toHaveURL(/:\d+\/decks\/\?x=1#mine$/);
    await page.goto('/en/');
    await expect(page).toHaveURL(/:\d+\/$/);
  });
});

test.describe('a visitor in Thailand', () => {
  test.use({ locale: 'th-TH', timezoneId: 'Asia/Bangkok', userAgent: PERSON });
  test('opening an English page gets the Thai one; a crawler is left where it is', async ({ page, browser }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    await page.goto('/en/review/');
    await expect(page).toHaveURL(/:\d+\/review\/$/);
    const crawler = await browser.newPage({ locale: 'en-US', timezoneId: 'Europe/London', baseURL: 'http://127.0.0.1:4329' });
    await crawler.goto('/decks/');
    await expect(crawler.locator('html')).toHaveAttribute('lang', 'th');
    await crawler.close();
  });
});

test('switching language keeps the page and its query', async ({ page }) => {
  await page.goto('/play/?opp=basic-box');
  await page.locator('.nav .lang-switch').click();
  await expect(page).toHaveURL(/\/en\/play\/\?opp=basic-box$/);
  await expect(page.getByRole('heading', { name: 'Pick the decks and play' })).toBeVisible();
});

test('an English game plays to the end and its review is in English', async ({ page }) => {
  await page.goto('/en/play/?watch=1&test=1&speed=0&seed=7&me=basic-box&opp=dragapult-ex&save=1');
  await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.log .line').first()).toBeVisible();
  const over = page.getByRole('dialog', { name: 'Game over' });
  await expect(over).toBeVisible();
  expect(await visibleText(page)).not.toMatch(THAI);

  await over.getByRole('link', { name: /Review this game/ }).click();
  await expect(page).toHaveURL(/\/en\/review\/\?id=\d+/);
  await expect(page.locator('.summary')).toContainText('of your', { timeout: 30_000 });
  await expect(page.locator('.sentence')).not.toBeEmpty();
  expect(await visibleText(page)).not.toMatch(THAI);
});

test('the sitemap lists every page in both languages, each with its other-language address', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.replace(/^https?:\/\/[^/]+/, ''));
  for (const path of ['/', '/play/', '/decks/', '/decks/dragapult-ex/', '/builder/', '/review/']) {
    expect(locs).toContain(path);
    expect(locs).toContain(path === '/' ? '/en/' : `/en${path}`);
  }
  expect(xml.match(/hreflang="en"/g)!.length).toBe(locs.length);
  expect(await (await request.get('/robots.txt')).text()).toContain('Allow: /');
});
