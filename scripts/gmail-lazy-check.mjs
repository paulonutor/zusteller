// Synthetic Gmail adapter in Chromium. No account, OAuth or native app access.
/* global document, innerWidth */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/zusteller-gmail-lazy';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const count of [40, 1500]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: theme,
      });
      await context.addInitScript(
        ({ count }) => {
          const account = {
            id: 'fixture@example.com',
            email: 'fixture@example.com',
            displayName: 'Synthetic account',
          };
          const summaries = new Map();
          const bodies = new Map();
          globalThis.__lazyCalls = [];
          globalThis.__lazyBodyReads = 0;
          const summary = (index) => ({
            id: `t${index}`,
            accountId: account.id,
            subject: `Synthetic conversation ${index}`,
            participants: [{ name: `Sender ${index}`, email: `sender${index}@example.com` }],
            snippet: 'Synthetic message for viewport and cache verification.',
            messageCount: 1,
            lastMessageAt: '2026-10-11T12:00:00Z',
            isRead: true,
            isStarred: false,
            labelIds: ['INBOX', 'custom'],
            hasAttachments: false,
          });
          globalThis.__TAURI__ = {
            core: {
              invoke: async (command, args) => {
                if (command !== 'gmail_read')
                  return command === 'gmail_diagnostics'
                    ? { requests: 0, quotaUnits: 0, rateLimits: 0, cacheHits: 0, entries: [] }
                    : undefined;
                globalThis.__lazyCalls.push(args);
                switch (args.operation) {
                  case 'accounts':
                    return [account];
                  case 'labels':
                    return [
                      { id: 'custom', accountId: account.id, name: 'Fixture label', type: 'user' },
                    ];
                  case 'counts':
                    return {
                      mailboxes: { inbox: 0, starred: 0, sent: 0, junk: 0, trash: 0, all: 0 },
                      labels: { custom: 0 },
                    };
                  case 'sync':
                    return false;
                  case 'threads':
                    return {
                      items: Array.from(
                        { length: count },
                        (_, i) =>
                          summaries.get(`t${i}`) ?? {
                            ...summary(i),
                            subject: '',
                            participants: [],
                            metadataPending: true,
                          },
                      ),
                      nextCursor: null,
                    };
                  case 'summaries': {
                    await new Promise((r) => setTimeout(r, 50));
                    return args.input.threadIds.map((id) => {
                      const value = summary(Number(id.slice(1)));
                      summaries.set(id, value);
                      return value;
                    });
                  }
                  case 'thread': {
                    const id = args.input.threadId;
                    if (!bodies.has(id)) {
                      globalThis.__lazyBodyReads++;
                      const value = summary(Number(id.slice(1)));
                      summaries.set(id, value);
                      bodies.set(id, {
                        ...value,
                        messages: [
                          {
                            id: `${id}-message`,
                            threadId: id,
                            accountId: account.id,
                            from: value.participants[0],
                            to: [{ email: account.email }],
                            subject: value.subject,
                            sentAt: value.lastMessageAt,
                            isRead: true,
                            isStarred: false,
                            labelIds: value.labelIds,
                            attachments: [],
                            plainText: 'Synthetic body loaded only on open.',
                          },
                        ],
                      });
                    }
                    return bodies.get(id);
                  }
                  case 'action':
                    return;
                  default:
                    throw new Error(`Unexpected fixture operation: ${args.operation}`);
                }
              },
            },
            event: { listen: async () => () => {} },
          };
        },
        { count },
      );
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:47831/?theme=${theme}`);
      await page.getByRole('option', { name: /Synthetic conversation 0/ }).waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector('[role=option][data-metadata-pending]:not([style])') ||
          globalThis.__lazyCalls.filter((c) => c.operation === 'summaries').length > 0,
      );
      const initial = await page.evaluate(() => ({
        headers: globalThis.__lazyCalls
          .filter((c) => c.operation === 'summaries')
          .flatMap((c) => c.input.threadIds),
        bodies: globalThis.__lazyBodyReads,
        height: document.querySelector('[role=listbox]').clientHeight,
      }));
      if (
        initial.bodies !== 0 ||
        initial.headers.length > Math.ceil(initial.height / 68) + 1 ||
        initial.headers.length < 1
      )
        throw new Error(`Eager reads: ${JSON.stringify(initial)}`);
      await page.screenshot({ path: `${out}/${theme}-${count}-initial.png` });
      const list = page.getByRole('listbox');
      await list.evaluate((el) => {
        el.scrollTop = 680;
      });
      await page.getByRole('option', { name: /Synthetic conversation 12\b/ }).waitFor();
      if ((await page.evaluate(() => globalThis.__lazyBodyReads)) !== 0)
        throw new Error('Scrolling downloaded bodies');
      await page.getByRole('option', { name: /Synthetic conversation 12\b/ }).click();
      await page.getByText('Synthetic body loaded only on open.', { exact: true }).waitFor();
      if ((await page.evaluate(() => globalThis.__lazyBodyReads)) !== 1)
        throw new Error('Opening fetched multiple bodies');
      const headersBefore = await page.evaluate(
        () => globalThis.__lazyCalls.filter((c) => c.operation === 'summaries').length,
      );
      await page.getByRole('button', { name: 'Fixture label', exact: true }).click();
      await page.getByRole('option', { name: /Synthetic conversation 0\b/ }).waitFor();
      await list.evaluate((el) => {
        el.scrollTop = 680;
      });
      await page.getByRole('option', { name: /Synthetic conversation 12\b/ }).click();
      await page.getByText('Synthetic body loaded only on open.', { exact: true }).waitFor();
      if ((await page.evaluate(() => globalThis.__lazyBodyReads)) !== 1)
        throw new Error('Reopening bypassed the body cache');
      if (
        (await page.evaluate(
          () => globalThis.__lazyCalls.filter((c) => c.operation === 'summaries').length,
        )) !== headersBefore
      )
        throw new Error('Label navigation refetched known metadata');
      await page.setViewportSize({ width: 980, height: 620 });
      await page.screenshot({ path: `${out}/${theme}-${count}-compact.png` });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        throw new Error('Compact UI overflow');
      const audit = await new AxeBuilder({ page }).analyze();
      const failing = audit.violations.filter((v) => v.id !== 'color-contrast');
      if (failing.length)
        throw new Error(`Accessibility: ${JSON.stringify(failing.map((v) => v.id))}`);
      if (errors.length) throw new Error(`UI errors: ${JSON.stringify(errors)}`);
      console.log(
        `${theme}, ${count} rows: ${initial.headers.length} initial headers, zero initial bodies, viewport loading and cached reopening passed`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
}
