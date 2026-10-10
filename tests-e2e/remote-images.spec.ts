import { expect, test } from '@playwright/test';
import { JUNK_IMAGE, NEWSLETTER_IMAGE, serveRemoteImage } from '../tests-visual/remoteImages';

test('normal mail loads HTTPS images; Junk requires an explicit per-message request', async ({
  page,
}) => {
  await serveRemoteImage(page, NEWSLETTER_IMAGE);
  await serveRemoteImage(page, JUNK_IMAGE);
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if ([NEWSLETTER_IMAGE, JUNK_IMAGE].includes(request.url())) {
      imageRequests.push(request.url());
      expect(request.headers().referer).toBeUndefined();
    }
  });
  await page.goto('/?latency=0');
  await page.getByRole('option', { name: /Hacker Newsletter #712/ }).click();
  const frame = page.locator('article iframe').first();
  const imageWidth = () =>
    frame.evaluate((f) => {
      const img = (f as HTMLIFrameElement).contentDocument?.querySelector('img');
      return img?.naturalWidth ?? 0;
    });
  await expect.poll(imageWidth).toBe(512);
  expect(imageRequests).toContain(NEWSLETTER_IMAGE);
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(page.getByRole('button', { name: /Load (remote )?images/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^Junk/ }).click();
  await page.getByRole('option', { name: /Exclusive offer/ }).click();
  await expect(page.getByRole('button', { name: 'Load images' })).toBeVisible();
  await expect(frame).toHaveAttribute('srcdoc', /img-src data: cid:;/);
  expect(imageRequests).not.toContain(JUNK_IMAGE);
  await page.getByRole('button', { name: 'Load images' }).click();
  await expect.poll(imageWidth).toBe(512);
  expect(imageRequests).toContain(JUNK_IMAGE);
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  await expect(page.getByRole('button', { name: 'Load images' })).toHaveCount(0);
});
