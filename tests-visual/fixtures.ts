import fs from 'node:fs';
import path from 'node:path';
import { test as base, type Page } from '@playwright/test';

// Screenshots must not depend on whichever system fonts the machine has. The app's font stack
// already lists 'Inter' ahead of system-ui, so defining it here pins every machine (macOS dev
// box, CI runner, container) to the same glyphs. The reader iframe uses system-ui first, so it
// gets an explicit override. Test-only: the shipped app keeps its system font stack.
const FONT_FILE = path.resolve(
  'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
);
const FONT_B64 = fs.readFileSync(FONT_FILE).toString('base64');

const PINNED_CSS = `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url(data:font/woff2;base64,${FONT_B64}) format('woff2');
}
html, body, button, input, textarea, select { font-family: 'Inter', sans-serif !important; }
`;

/** Installs the pinned font into every document the page creates (top level + iframes). */
async function pinFont(page: Page) {
  await page.addInitScript((css) => {
    const install = () => {
      const style = document.createElement('style');
      style.setAttribute('data-test-font', '');
      style.textContent = css;
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.documentElement) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
  }, PINNED_CSS);
}

/** Sandboxed srcdoc frames may skip init scripts, so also inject into the reader iframe directly. */
export async function pinFrameFont(page: Page) {
  await page.evaluate((css) => {
    for (const f of document.querySelectorAll('iframe')) {
      const doc = f.contentDocument;
      if (!doc || doc.querySelector('style[data-test-font]')) continue;
      const style = doc.createElement('style');
      style.setAttribute('data-test-font', '');
      style.textContent = css;
      doc.head.appendChild(style);
    }
  }, PINNED_CSS);
  await page.evaluate(() => document.fonts.ready);
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    await pinFont(page);
    await provide(page);
  },
});
export { expect } from '@playwright/test';
