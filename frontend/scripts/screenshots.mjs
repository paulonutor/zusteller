// Usage: node scripts/screenshots.mjs [baseUrl] [outDir]
// Captures the app in light/dark at a 13" MacBook viewport. Requires `npm run dev`.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshots';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('CONSOLE', m.text()));
  await page.goto(`${base}/?latency=0`);
  await page.waitForSelector('[role=option]');
  await page.screenshot({ path: `${out}/${scheme}-inbox.png` });
  await page.locator('[role=option]').first().click();
  await page.waitForSelector('article');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${scheme}-thread.png` });
  await ctx.close();
}
await browser.close();
