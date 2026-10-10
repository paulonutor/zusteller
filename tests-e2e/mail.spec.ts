import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-07T12:00:00.000Z'));
  await page.goto('/?latency=0');
  await expect(page.getByRole('option').first()).toBeVisible();
});

test('pane resizing clamps and persists across reloads', async ({ page }) => {
  const handle = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 800, box.y + 100);
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '320');
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '320');
  await handle.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '280');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '180');
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '180');
});

test('invalid persisted widths fall back to usable defaults', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('zusteller.layout', JSON.stringify({ sidebar: 'bad', list: null })),
  );
  await page.reload();
  await expect(
    page.getByRole('separator', { name: 'Resize sidebar', exact: true }),
  ).toHaveAttribute('aria-valuenow', '220');
  await expect(
    page.getByRole('separator', { name: 'Resize conversation list', exact: true }),
  ).toHaveAttribute('aria-valuenow', '410');
});

test('search and menus keep destructive shortcuts from reaching mail actions', async ({ page }) => {
  const row = page.getByRole('option', { name: /Lunch Thursday/ });
  await row.click();
  const search = page.getByRole('searchbox');
  await search.focus();
  await page.keyboard.press('e');
  await expect(search).toHaveValue('e');
  await expect(row).toBeVisible();
  await search.fill('');
  await page.getByRole('button', { name: /^Filter/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('e');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Filter/ })).toBeFocused();
  await expect(row).toBeVisible();
});

test('keyboard navigation scrolls the focused virtual row into view', async ({ page }) => {
  await page.goto('/?latency=0&seed=big:5000');
  const list = page.getByRole('listbox');
  // Load enough pages to activate virtualization, rather than only exercising the initial page.
  await expect(page.getByRole('option')).toHaveCount(30);
  for (const count of [60, 90]) {
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.getByRole('option')).toHaveCount(count);
  }
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('[role=option][aria-posinset]').first()).toBeVisible();
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await list.focus();
  for (let i = 0; i < 35; i++) await page.keyboard.press('ArrowDown');
  const active = await list.getAttribute('aria-activedescendant');
  const row = page.locator(`[id="${active}"]`);
  await expect(row).toBeInViewport();
  expect(await page.getByRole('option').count()).toBeLessThan(50);
});

test('window focus events update inactive selection state', async ({ page }) => {
  await page.getByRole('option').first().click();
  // Headless Chromium does not blur when switching tabs; deliver the browser events explicitly.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true });
    window.dispatchEvent(new Event('blur'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-window-inactive');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true });
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('html')).not.toHaveAttribute('data-window-inactive');
});

for (const mode of ['filter', 'mailbox']) {
  test(`unstarring hides the selected row from the Starred ${mode}`, async ({ page }) => {
    if (mode === 'filter') {
      await page.getByRole('button', { name: /^Filter/ }).click();
      await page.getByRole('menuitem', { name: /^Starred/ }).click();
    } else {
      await page.getByRole('button', { name: 'Starred', exact: true }).click();
    }
    const row = page.getByRole('option', { name: /Ihre Stromrechnung/ });
    await row.click();
    const id = await row.getAttribute('id');
    await page.keyboard.press('s');
    await expect(row).toHaveCount(0);
    await expect(page.getByRole('listbox')).not.toHaveAttribute('aria-activedescendant', id!);
    await expect(page.getByRole('option', { selected: true })).toHaveCount(0);
  });
}

for (const [action, button] of [
  ['archive', 'Archive'],
  ['trash', 'Move to Trash'],
] as const) {
  test(`${action} responds before a delayed service write`, async ({ page }) => {
    await page.goto('/?latency=1200');
    const row = page.getByRole('option', { name: /Lunch Thursday/ });
    await row.click();
    await page.getByRole('button', { name: button, exact: true }).click();
    // A service write alone takes 1200ms, followed by refetch. UI removal must precede it.
    await expect(row).toHaveCount(0, { timeout: 700 });
    await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
  });
}
