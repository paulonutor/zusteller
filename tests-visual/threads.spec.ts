import type { Page } from '@playwright/test';
import { expect, pinFrameFont, test } from './fixtures';

// Every thread shape must share one look: same gutters, same gaps, same card treatment.
// Dates are frozen to the mock seed's "now" so relative timestamps never change.
const SEED_NOW = '2026-10-07T12:00:00.000Z';

const CASES = [
  { key: 'single-plain', search: 'Notes from our call', messages: 1, html: 0 },
  { key: 'single-html', search: 'Payment failed for your subscription', messages: 1, html: 1 },
  { key: 'multi-plain', search: 'Lunch Thursday', messages: 3, html: 0 },
  { key: 'multi-html', search: 'Lisbon trip: check-in and gate', messages: 2, html: 2 },
  { key: 'multi-mixed', search: 'Your order #302-8841772', messages: 3, html: 2 },
] as const;

async function openCase(page: Page, c: (typeof CASES)[number]) {
  await page.clock.setFixedTime(new Date(SEED_NOW));
  await page.goto('/?latency=0');
  await page.waitForSelector('[role=option]');
  await page.locator('input[type=search]').fill(c.search);
  await page.getByRole('option', { name: c.search }).first().click();
  await expect(page.locator('article')).toHaveCount(c.messages);
  if (c.html > 0) {
    // Multi-message threads open only the newest message; expand the rest so every body renders.
    if (c.messages > 1) await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.locator('article iframe')).toHaveCount(c.html);
    await expect
      .poll(() =>
        page
          .locator('article iframe')
          .evaluateAll((fs) =>
            fs.every((f) => ((f as HTMLIFrameElement).contentDocument?.body?.children.length ?? 0) > 0),
          ),
      )
      .toBe(true);
    await pinFrameFont(page);
  }
  await page.mouse.move(640, 795);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`thread layouts ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const c of CASES) {
      test(c.key, async ({ page }) => {
        await openCase(page, c);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`thread-${c.key}-${scheme}.png`, {
          caret: 'hide',
          // The sandboxed email iframe's text measures slightly wider on CI (see states.spec.ts).
          ...(c.html > 0 ? { maxDiffPixelRatio: 0.012 } : {}),
        });
      });
    }
  });
}

test('all thread shapes share the same gaps and gutters', async ({ page }) => {
  const measured: Record<string, Record<string, number>> = {};
  for (const c of CASES) {
    await openCase(page, c);
    measured[c.key] = await page.evaluate(() => {
      const r = (el: Element) => el.getBoundingClientRect();
      const pane = document.querySelector("[data-pane='reader']")!;
      const header = pane.querySelector('.mail-thread-header')!;
      const container = pane.querySelector('.mail-thread-messages')!;
      const articles = [...pane.querySelectorAll('article')];
      const first = articles[0]!;
      const last = articles[articles.length - 1]!;
      const m: Record<string, number> = {
        headerToFirst: r(first).top - r(header).bottom,
        left: r(first).left - r(container).left,
        right: r(container).right - r(first).right,
        lastMargin: parseFloat(getComputedStyle(last).marginBottom),
      };
      if (articles.length > 1) m.between = r(articles[1]!).top - r(articles[0]!).bottom;
      // The newest message is expanded in every shape: compare where its avatar sits in its card.
      const avatar = last.querySelector('[data-reader-avatar]')!;
      m.avatarInset = r(avatar).left - r(last).left;
      m.avatarTop = r(avatar).top - r(last).top;
      // Right edge of the message content (white HTML card or plain text) inside the card.
      m.cardWidth = r(last).width;
      return m;
    });
  }
  const base = measured['single-plain']!;
  for (const c of CASES) {
    const m = measured[c.key]!;
    for (const k of ['headerToFirst', 'left', 'right', 'lastMargin', 'avatarInset', 'avatarTop', 'cardWidth']) {
      expect.soft(m[k], `${c.key}.${k}`).toBeCloseTo(base[k]!, 0);
    }
    if (m.between !== undefined) {
      expect.soft(m.between, `${c.key}.between`).toBeCloseTo(measured['multi-plain']!.between!, 0);
    }
  }
  console.log(JSON.stringify(measured, null, 1));
});
