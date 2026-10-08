/* global document */
// Usage: node scripts/capture-states.mjs [baseUrl] [outDir]
// Captures a fixed matrix of UI states (theme x vibrancy) at 1280x800 for pixel-diffing
// stylesheet refactors. Run before and after, then compare the two directories. Requires a dev server.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47831';
const out = process.argv[3] ?? 'capture-states';
fs.mkdirSync(out, { recursive: true });

const variants = ['light', 'dark'];

async function openFirstThread(page) {
  await page.locator('[role=option]').first().click();
  await page.waitForSelector('article');
  await page.waitForTimeout(400);
}

async function clickTab(page, name) {
  await page.getByRole('button', { name: /^Filter/ }).click();
  const item = page.getByRole('menuitem', { name });
  if (await item.isVisible().catch(() => false)) await item.click();
  await page.waitForTimeout(300);
}

const states = {
  inbox: async () => {},
  thread: openFirstThread,
  'avatar-hover': async (page) => {
    await page.locator('[role=option] [data-lead]').nth(2).hover();
  },
  'multi-select': async (page) => {
    for (const i of [1, 3]) {
      await page.locator('[role=option] [data-lead]').nth(i).hover();
      await page.locator('[role=option] [role=checkbox]').nth(i).click();
    }
    await page.mouse.move(640, 790);
  },
  'window-inactive': async (page) => {
    await openFirstThread(page);
    await page.evaluate(() =>
      document.documentElement.toggleAttribute('data-window-inactive', true),
    );
    await page.mouse.move(640, 790);
  },
  search: async (page) => {
    await page.locator('input[type=search]').fill('a');
    await page.waitForTimeout(300);
  },
  empty: async (page) => {
    await page.locator('input[type=search]').fill('zzzzqqxx');
    await page.waitForTimeout(300);
  },
  'tab-unread': (page) => clickTab(page, /unread/i),
  'tab-starred': (page) => clickTab(page, /starred/i),
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
let n = 0;
for (const scheme of variants) {
  for (const vibrancy of [false, true]) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: scheme,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    for (const [state, run] of Object.entries(states)) {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
      await page.goto(`${base}/?latency=0`);
      await page.waitForSelector('[role=option]');
      if (vibrancy) {
        await page.evaluate(() => {
          document.documentElement.dataset.host = 'tauri';
          document.documentElement.dataset.vibrancy = '';
        });
      }
      await page.waitForTimeout(150);
      await run(page);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `${out}/${scheme}${vibrancy ? '-vibrancy' : ''}-${state}.png`,
        omitBackground: vibrancy,
        animations: 'disabled',
        caret: 'hide',
      });
      n++;
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`captured ${n} screenshots in ${out}`);
