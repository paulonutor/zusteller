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

const FRAME_CSS = `html, body { font-family: 'Inter', sans-serif !important; }`;

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

/**
 * The reader iframe has a strict CSP (no font-src), so an @font-face data: URL is blocked there.
 * Fonts built from raw bytes with the FontFace API are not fetched, so CSP does not apply. The
 * rule below only sets the family; the CSP itself stays untouched.
 */
export async function pinFrameFont(page: Page) {
  await page.evaluate(
    async ({ b64, css }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const docs: Document[] = [];
      for (const f of document.querySelectorAll('iframe')) {
        const doc = f.contentDocument;
        const win = f.contentWindow as (Window & { FontFace: typeof FontFace }) | null;
        if (!doc || !win) continue;
        docs.push(doc);
        if (doc.querySelector('style[data-test-font]')) continue;
        const face = new win.FontFace('Inter', bytes.buffer.slice(0), { weight: '100 900' });
        await face.load();
        doc.fonts.add(face);
        const style = doc.createElement('style');
        style.setAttribute('data-test-font', '');
        style.textContent = css;
        doc.head.appendChild(style);
      }
      // Let the reader's auto-resize settle (two frames) so the screenshot never races the reflow.
      await Promise.all(docs.map((d) => d.fonts.ready));
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    },
    { b64: FONT_B64, css: FRAME_CSS },
  );
  await page.evaluate(() => document.fonts.ready);
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    await pinFont(page);
    await provide(page);
  },
});
export { expect } from '@playwright/test';
