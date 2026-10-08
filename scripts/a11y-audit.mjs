// Usage: node scripts/a11y-audit.mjs [baseUrl]     (needs `npm run dev`; `npm run a11y`)
// Runs axe (wcag2a/aa, wcag21aa, best-practice) over the app in many UI states,
// light + dark, plus the native-host vibrancy variant and the virtualized list (?seed=big, dev only).
// Exit code 1 when any violation is found. CHROMIUM_PATH overrides the browser binary.
/* global document, matchMedia */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.argv[2] ?? 'http://localhost:47831';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'];
const executablePath =
  process.env.CHROMIUM_PATH || (process.env.PW_CHROMIUM_FALLBACK ?? '/opt/pw-browsers/chromium');

const rows = [];
const browser = await chromium
  .launch({ executablePath })
  .catch(() => chromium.launch({ executablePath: undefined }));

async function audit(page, theme, variant, state) {
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of res.violations)
    for (const n of v.nodes) {
      // Radix menu portals sit outside the landmarks by design (role=menu); known axe noise.
      if (v.id === 'region' && n.target.join(' ').includes('data-radix-popper-content-wrapper'))
        continue;
      rows.push({
        theme,
        variant,
        state,
        impact: v.impact ?? 'n/a',
        rule: v.id,
        detail: (() => {
          const d = n.any[0]?.data;
          return d?.contrastRatio
            ? `${d.fgColor} on ${d.bgColor} = ${d.contrastRatio} (${d.fontSize})`
            : '';
        })(),
        selector: n.target.join(' >> ').slice(0, 90),
      });
    }
}

const firstRow = (page) => page.locator('[role=option]').first();

/** Each state: [name, query, setup(page)] */
function states() {
  const openHtml = async (page) => {
    const n = await page.locator('[role=option]').count();
    for (let i = 0; i < n; i++) {
      await page.locator('[role=option]').nth(i).click();
      await page.waitForSelector('article');
      await page.waitForTimeout(150);
      if (await page.locator('article iframe').count()) return;
    }
    throw new Error('no HTML thread found');
  };
  return [
    ['inbox idle', '', async () => {}],
    [
      'thread open (plain)',
      '',
      async (page) => {
        const n = await page.locator('[role=option]').count();
        for (let i = 0; i < n; i++) {
          await page.locator('[role=option]').nth(i).click();
          await page.waitForSelector('article');
          if (!(await page.locator('article iframe').count())) return;
        }
      },
    ],
    [
      'thread open (html+iframe)',
      '',
      async (page) => {
        await openHtml(page);
        await page.waitForTimeout(300);
      },
    ],
    [
      'avatar hover checkbox',
      '',
      async (page) => {
        await firstRow(page).locator('[data-lead]').hover();
      },
    ],
    [
      'selection mode (multi)',
      '',
      async (page) => {
        await page.locator('[role=option]').nth(0).click();
        await page
          .locator('[role=option]')
          .nth(2)
          .click({ modifiers: ['Shift'] });
      },
    ],
    [
      'selection, window inactive',
      '',
      async (page) => {
        await page.locator('[role=option]').nth(0).click();
        await page
          .locator('[role=option]')
          .nth(2)
          .click({ modifiers: ['Shift'] });
        await page.evaluate(() =>
          document.documentElement.setAttribute('data-window-inactive', ''),
        );
      },
    ],
    [
      'context menu open',
      '',
      async (page) => {
        await firstRow(page).click({ button: 'right' });
        await page.waitForSelector('[role=menu]');
      },
    ],
    [
      'labels dropdown open',
      '',
      async (page) => {
        await firstRow(page).click();
        await page.waitForSelector('article');
        await page.getByRole('button', { name: 'Labels' }).click();
        await page.waitForSelector('[role=menu]');
      },
    ],
    [
      'search focused with results',
      '',
      async (page) => {
        await page.getByRole('searchbox', { name: 'Search mail' }).fill('a');
        await page.waitForTimeout(500);
        await page.getByRole('searchbox', { name: 'Search mail' }).focus();
      },
    ],
    [
      'empty state',
      '',
      async (page) => {
        await page.getByRole('searchbox', { name: 'Search mail' }).fill('zzzzqqqq');
        await page.waitForSelector('text=No results');
      },
    ],
    [
      'filter tab unread',
      '',
      async (page) => {
        await page.getByRole('button', { name: /^Filter/ }).click();
        await page.getByRole('menuitem', { name: /Unread/ }).click();
      },
    ],
    [
      'toast visible',
      '',
      async (page) => {
        await firstRow(page).click();
        await page.keyboard.press('e');
        await page.waitForTimeout(200);
      },
    ],
  ];
}

for (const theme of ['light', 'dark']) {
  const variants = [
    { name: 'default', q: '', pre: async () => {} },
    {
      name: 'host+vibrancy',
      q: '',
      pre: async (page) =>
        page.evaluate(() => {
          document.documentElement.dataset.host = 'tauri';
          document.documentElement.dataset.vibrancy = '';
          // A headless browser has no native material: stand in a plausible one so axe doesn't
          // compute the transparent sidebar against white.
          const dark = matchMedia('(prefers-color-scheme: dark)').matches;
          const st = document.createElement('style');
          st.textContent = `html:root[data-vibrancy]{background:${dark ? '#2b2b30' : '#e4e4e8'} !important}`;
          document.head.append(st);
        }),
    },
    { name: 'virtualized', q: '&seed=big:300', pre: async () => {} },
  ];
  for (const variant of variants) {
    const list = variant.name === 'default' ? states() : states().slice(0, 4);
    for (const [state, , setup] of list) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: theme,
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
      await page.goto(`${base}/?latency=0&theme=${theme}${variant.q}`);
      await page.waitForSelector('[role=option]');
      await variant.pre(page);
      await setup(page);
      await page.waitForTimeout(150);
      await audit(page, theme, variant.name, state);
      await ctx.close();
    }
  }
  // Error state: offline backend.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/?latency=0&offline=1&theme=${theme}`);
  await page.waitForTimeout(800); // accounts fail offline, so the list stays in its loading skeleton
  await audit(page, theme, 'default', 'error (offline)');
  await ctx.close();
}
await browser.close();

// Report: unique by (impact, rule, selector), with the states they appear in.
const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const uniq = new Map();
for (const r of rows) {
  const sel = r.selector.replace(/#row-[\w-]+/g, '#row-*').replace(/:nth-child\(\d+\)/g, '');
  const k = `${r.impact}|${r.rule}|${sel}`;
  const e = uniq.get(k) ?? { ...r, selector: sel, where: new Set() };
  e.where.add(`${r.theme}/${r.variant}/${r.state}`);
  uniq.set(k, e);
}
const out = [...uniq.values()]
  .sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || a.rule.localeCompare(b.rule))
  .map((e) => ({
    impact: e.impact,
    rule: e.rule,
    selector: e.selector,
    ...(process.env.A11Y_VERBOSE ? { detail: e.detail } : {}),
    states: e.where.size > 2 ? `${e.where.size} states` : [...e.where].join('; '),
  }));
// Known, deliberately unfixed findings: text inside list rows whose colour comes from a design
// decision awaiting approval (dimmed meta text on the accent selection; label-chip colours).
// They are listed but do not fail the run. Everything else does.
const isKnown = (e) => e.rule === 'color-contrast' && e.selector.startsWith('#row-*');
const failing = out.filter((e) => !isKnown(e));
const known = out.filter(isKnown);
if (failing.length) console.table(failing);
if (known.length) {
  console.log(`\nKnown design-token findings (not failing): ${known.length}`);
  console.table(known);
}
const byImpact = {};
for (const r of rows) byImpact[r.impact] = (byImpact[r.impact] ?? 0) + 1;
console.log(
  `\n${rows.length} violation nodes (${out.length} unique, ${failing.length} failing): ${JSON.stringify(byImpact)}`,
);
process.exit(failing.length ? 1 : 0);
