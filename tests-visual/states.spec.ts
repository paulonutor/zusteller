import type { Page } from '@playwright/test';
import { expect, pinFrameFont, test } from './fixtures';

// Mirrors the key states of scripts/capture-states.mjs in light + dark.
// Dates are frozen to the mock seed's "now" so relative timestamps never change.
const SEED_NOW = '2026-10-07T12:00:00.000Z';
const FLAT_BACKDROP = '#6b5bd6';

async function load(page: Page, query = '') {
  await page.clock.setFixedTime(new Date(SEED_NOW));
  await page.goto(`/?latency=0${query}`);
  await page.waitForSelector('[role=option]');
  await page.evaluate(() => document.fonts.ready);
}

async function openThread(page: Page, name: RegExp) {
  await page.getByRole('option', { name }).first().click();
  await page.waitForSelector('article');
}

async function waitForHtmlBody(page: Page) {
  const frame = page.locator('article iframe').first();
  await frame.waitFor();
  await expect
    .poll(() =>
      frame.evaluate((f) => (f as HTMLIFrameElement).contentDocument?.body?.children.length ?? 0),
    )
    .toBeGreaterThan(0);
  await pinFrameFont(page);
}

async function selectRows(page: Page, indices: number[]) {
  for (const i of indices) {
    await page.locator('[role=option] [data-lead]').nth(i).hover();
    await page.locator('[role=option] [data-row-check]').nth(i).click();
  }
  await page.mouse.move(640, 790);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme}`, () => {
    test.use({ colorScheme: scheme });

    const shot = async (page: Page, name: string, maxDiffPixelRatio?: number) => {
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${name}-${scheme}.png`, {
        caret: 'hide',
        ...(maxDiffPixelRatio === undefined ? {} : { maxDiffPixelRatio }),
      });
    };

    test('inbox', async ({ page }) => {
      await load(page);
      await shot(page, 'inbox');
    });

    test('thread open (plain)', async ({ page }) => {
      await load(page);
      await openThread(page, /Notes from our call/);
      await page.mouse.move(640, 795);
      await shot(page, 'thread-plain');
    });

    test('thread open (HTML mail)', async ({ page }) => {
      await load(page);
      await openThread(page, /Hacker Newsletter #712/);
      await waitForHtmlBody(page);
      await page.mouse.move(640, 795);
      // The sandboxed iframe's text measures ~2% wider on the CI runner than in the Playwright
      // image (same Inter, same flags; cause unknown), so Docker- and CI-made baselines differ by
      // ~0.8% of the frame, all of it inside the email body. Everything else matches exactly.
      await shot(page, 'thread-html', 0.012);
    });

    test('junk mailbox with images blocked banner', async ({ page }) => {
      await load(page);
      await page.getByRole('button', { name: /^Junk/ }).click();
      await openThread(page, /Exclusive offer/);
      await waitForHtmlBody(page);
      await expect(page.getByRole('button', { name: 'Load images' })).toBeVisible();
      await page.mouse.move(640, 795);
      await shot(page, 'junk', 0.012);
    });

    test('avatar hover shows checkbox', async ({ page }) => {
      await load(page);
      await page.locator('[role=option] [data-lead]').nth(2).hover();
      await expect(page.locator('[role=option] [data-row-check]').nth(2)).toBeVisible();
      await shot(page, 'avatar-hover');
    });

    test('multi-select', async ({ page }) => {
      await load(page);
      await selectRows(page, [1, 3]);
      await shot(page, 'multi-select');
    });

    test('selection with window inactive', async ({ page }) => {
      await load(page);
      await selectRows(page, [1, 3]);
      await page.evaluate(() =>
        document.documentElement.toggleAttribute('data-window-inactive', true),
      );
      await shot(page, 'selection-window-inactive');
    });

    test('filter tab Unread', async ({ page }) => {
      await load(page);
      await page.getByRole('button', { name: /^Filter/ }).click();
      await page.getByRole('menuitem', { name: /unread/i }).click();
      await expect(page.getByRole('button', { name: 'Filter: Unread' })).toBeVisible();
      await page.mouse.move(640, 795);
      await shot(page, 'tab-unread');
    });

    test('search results', async ({ page }) => {
      await load(page);
      await page.locator('input[type=search]').fill('receipt');
      await expect(page.locator('[role=option]').first()).toBeVisible();
      await page.mouse.move(640, 795);
      await shot(page, 'search-results');
    });

    test('empty state', async ({ page }) => {
      await load(page);
      await page.locator('input[type=search]').fill('zzzzqqxx');
      await expect(page.locator('[role=option]')).toHaveCount(0);
      await shot(page, 'empty');
    });

    test('context menu open', async ({ page }) => {
      await load(page);
      await page.locator('[role=option]').nth(1).click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
      await shot(page, 'context-menu');
    });

    test('Labels dropdown open', async ({ page }) => {
      await load(page);
      await openThread(page, /Notes from our call/);
      await page.getByRole('button', { name: 'Labels' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await shot(page, 'labels-dropdown');
    });

    test('native host vibrancy over flat backdrop', async ({ page }) => {
      await load(page);
      await page.addStyleTag({
        content: `:root[data-vibrancy] { background: ${FLAT_BACKDROP} !important; }`,
      });
      await page.evaluate(() => {
        document.documentElement.dataset.host = 'tauri';
        document.documentElement.dataset.vibrancy = '';
      });
      await openThread(page, /Notes from our call/);
      await page.mouse.move(640, 795);
      await shot(page, 'vibrancy');
    });

    test('virtualized list top (300 threads)', async ({ page }) => {
      await load(page, '&seed=big:300');
      await shot(page, 'virtual-list-top');
    });
  });
}
