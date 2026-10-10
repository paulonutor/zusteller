import type { Page } from '@playwright/test';

export const NEWSLETTER_IMAGE = 'https://cdn.example.com/banner.jpg';
export const JUNK_IMAGE = 'https://images.cheap-meds-outlet.example.biz/hero.jpg';

// Serve a fixed image at the seed's remote URL so tests exercise HTTPS image loading
// without depending on the network or a third-party image changing.
export async function serveRemoteImage(page: Page, url: string) {
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="80"><rect width="512" height="80" fill="#eef2f6"/><path d="M24 56V24h28v8H32v8h16v8H32v8z" fill="#38516b"/></svg>',
    }),
  );
}
