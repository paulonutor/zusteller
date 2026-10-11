// Synthetic native-provider UI checks; no OAuth tokens or real Gmail data.
/* global window, location, document, innerWidth */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

const out = process.argv[2] ?? '/tmp/zusteller-gmail-preview';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addInitScript(() => {
    let connected = false;
    globalThis.__gmailActions = 0;
    globalThis.__gmailCalls = [];
    const handlers = new Map();
    const bridge = new BroadcastChannel('gmail-preview');
    bridge.onmessage = ({ data }) => {
      const role =
        new URLSearchParams(location.search).get('view') === 'activity' ? 'activity' : 'mail';
      if (data.target === role)
        for (const handler of handlers.get(data.event) ?? []) handler({ payload: data.payload });
    };
    const account = {
      id: 'preview@example.com',
      email: 'preview@example.com',
      displayName: 'Preview account',
    };
    const thread = {
      id: 'thread',
      accountId: account.id,
      subject: 'Read-only Gmail preview',
      participants: [{ name: 'Gmail preview', email: 'sender@example.com' }],
      snippet: 'These are synthetic messages for UI verification.',
      messageCount: 1,
      lastMessageAt: '2026-10-10T12:00:00Z',
      isRead: true,
      isStarred: false,
      labelIds: ['INBOX'],
      hasAttachments: true,
    };
    const message = {
      id: 'message',
      threadId: thread.id,
      accountId: account.id,
      from: thread.participants[0],
      to: [{ email: account.email }],
      subject: thread.subject,
      sentAt: thread.lastMessageAt,
      isRead: true,
      isStarred: false,
      labelIds: ['INBOX'],
      plainText: 'Synthetic Gmail preview. Your Gmail account is unchanged by local actions.',
      attachments: [
        { id: 'attachment', filename: 'preview.txt', mimeType: 'text/plain', size: 64 },
      ],
    };
    globalThis.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          globalThis.__gmailCalls.push({ command, args });
          if (command === 'open_mail_activity') {
            window.open(
              `/?view=activity&theme=${new URLSearchParams(location.search).get('theme')}`,
              'gmail-activity',
              'width=820,height=660',
            );
            return;
          }
          if (command === 'close_mail_activity') {
            window.close();
            return;
          }
          if (command === 'gmail_activity_publish') {
            localStorage.setItem('gmail-preview-activity', JSON.stringify(args.snapshot));
            return;
          }
          if (command === 'gmail_activity_snapshot')
            return JSON.parse(
              localStorage.getItem('gmail-preview-activity') ??
                '{"status":{"state":"idle"},"busy":false}',
            );
          if (command === 'gmail_activity_action') {
            bridge.postMessage({
              target: 'mail',
              event: 'zusteller://gmail-activity-action',
              payload: args,
            });
            return;
          }
          if (command === 'gmail_activity_result') {
            bridge.postMessage({
              target: 'activity',
              event: 'zusteller://gmail-activity-result',
              payload: args,
            });
            return;
          }
          if (command === 'gmail_connect') {
            connected = true;
            return account;
          }
          if (command === 'gmail_diagnostics')
            return {
              requests: 104,
              quotaUnits: 4053,
              rateLimits: 1,
              cacheHits: 50,
              entries: [
                {
                  timestamp: Date.parse('2026-10-11T13:00:00Z'),
                  operation: 'batch',
                  outcome: 'sent',
                  status: null,
                  durationMs: 0,
                  waitMs: 0,
                  quotaUnits: 0,
                  reason: null,
                  retryAfter: null,
                  count: 4,
                },
                {
                  timestamp: Date.parse('2026-10-11T13:00:00Z'),
                  operation: 'sync',
                  outcome: 'started',
                  status: null,
                  durationMs: 0,
                  waitMs: 0,
                  quotaUnits: 0,
                  reason: null,
                  retryAfter: null,
                  count: null,
                },
                {
                  timestamp: Date.parse('2026-10-11T13:00:01Z'),
                  operation: 'threads.get',
                  outcome: 'rate_limit',
                  status: 429,
                  durationMs: 620,
                  waitMs: 500,
                  quotaUnits: 40,
                  reason: 'userRateLimitExceeded',
                  retryAfter: 60,
                  count: null,
                },
                {
                  timestamp: Date.parse('2026-10-11T13:00:02Z'),
                  operation: 'cache',
                  outcome: 'reused',
                  status: null,
                  durationMs: 0,
                  waitMs: 0,
                  quotaUnits: 0,
                  reason: null,
                  retryAfter: null,
                  count: 25,
                },
                {
                  timestamp: Date.parse('2026-10-11T13:00:03Z'),
                  operation: 'sync',
                  outcome: 'failed',
                  status: null,
                  durationMs: 0,
                  waitMs: 0,
                  quotaUnits: 0,
                  reason: null,
                  retryAfter: null,
                  count: null,
                },
              ],
            };
          if (command === 'gmail_read') {
            switch (args.operation) {
              case 'accounts':
                return connected ? [account] : [];
              case 'labels':
                return [];
              case 'counts':
                return {
                  mailboxes: { inbox: 0, starred: 0, sent: 0, junk: 0, trash: 0, all: 0 },
                  labels: {},
                  estimated: true,
                };
              case 'threads':
                return { items: [thread], nextCursor: null };
              case 'thread':
                return { ...thread, messages: [message] };
              case 'sync':
                return false;
              case 'action':
                globalThis.__gmailActions++;
                return;
              case 'disconnect':
                connected = false;
                return;
              default:
                return;
            }
          }
          if (command === 'accent_color') return '#007aff';
        },
      },
      event: {
        listen: async (event, handler) => {
          if (!handlers.has(event)) handlers.set(event, new Set());
          handlers.get(event).add(handler);
          return () => handlers.get(event).delete(handler);
        },
      },
    };
  });
  await page.goto(`http://127.0.0.1:47831/?theme=${scheme}`);
  await page.getByRole('button', { name: 'Connect Gmail', exact: true }).waitFor();
  await page.screenshot({ path: `${out}/${scheme}-connect.png` });
  let results = await new AxeBuilder({ page }).analyze();
  const contrast = results.violations.filter((v) => v.id === 'color-contrast');
  if (contrast.length)
    console.log(
      `${scheme} connection contrast findings: ${JSON.stringify(contrast.flatMap((v) => v.nodes.map((n) => n.target)))}`,
    );
  const failing = results.violations.filter((v) => !['color-contrast'].includes(v.id));
  if (failing.length)
    throw new Error(`Connection accessibility: ${JSON.stringify(failing.map((v) => v.id))}`);
  await page.getByRole('button', { name: 'Connect Gmail', exact: true }).click();
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Save preview.txt' }).waitFor();
  await page.screenshot({ path: `${out}/${scheme}-reader.png` });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let activity;
  const openActivity = async () => {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Gmail activity', exact: true }).click();
    const window = await popup;
    window.on('pageerror', (e) => errors.push(e.message));
    await window.getByRole('heading', { name: 'Gmail activity', exact: true }).waitFor();
    return window;
  };
  for (const width of [820, 480]) {
    activity = await openActivity();
    await activity.setViewportSize({ width, height: width === 480 ? 520 : 660 });
    const panel = activity.getByRole('region', { name: 'Gmail diagnostics', exact: true });
    await panel.getByText(/userRateLimitExceeded/).waitFor();
    await activity.getByRole('heading', { name: 'preview@example.com' }).waitFor();
    if (await page.getByRole('region', { name: 'Gmail connection' }).count())
      throw new Error('Main window still has the connection bar');
    await panel.getByRole('button', { name: 'Copy log' }).click();
    await panel.getByText('Log copied', { exact: true }).waitFor();
    const copied = await activity.evaluate(() => navigator.clipboard.readText());
    if (!copied.includes('HTTP 429') || !copied.includes('retry in 60 s'))
      throw new Error('Diagnostics did not copy the request details');
    if (!copied.includes('batch · sent · 4 calls'))
      throw new Error('Diagnostics did not identify the batched call count');
    const overflows = await activity.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflows) throw new Error(`Activity window overflow at ${width}px`);
    await activity.screenshot({ path: `${out}/${scheme}-activity-${width}.png` });
    const audit = await new AxeBuilder({ page: activity }).analyze();
    const violations = audit.violations.filter((v) => v.id !== 'color-contrast');
    if (violations.length)
      throw new Error(`Activity accessibility: ${JSON.stringify(violations.map((v) => v.id))}`);
    await panel.getByLabel('Gmail diagnostic events').focus();
    const before = await page.evaluate(() => globalThis.__gmailActions);
    await activity.keyboard.press('s');
    if ((await page.evaluate(() => globalThis.__gmailActions)) !== before)
      throw new Error('Mail shortcuts fired in the activity window');
    const reads = await activity.evaluate(() =>
      globalThis.__gmailCalls.filter(({ command }) => command === 'gmail_read'),
    );
    if (reads.length) throw new Error('Activity window started mail polling');
    const closed = activity.waitForEvent('close');
    await activity.keyboard.press('Escape').catch((error) => {
      if (!activity.isClosed()) throw error;
    });
    await closed;
  }
  await page.getByRole('button', { name: 'Save preview.txt' }).click();
  activity = await openActivity();
  await activity.getByRole('button', { name: 'Reset local changes' }).click();
  await activity.getByRole('button', { name: 'Refresh Gmail' }).click();
  results = await new AxeBuilder({ page }).analyze();
  const readerContrast = results.violations.filter((v) => v.id === 'color-contrast');
  if (readerContrast.length)
    console.log(
      `${scheme} reader contrast findings: ${JSON.stringify(readerContrast.flatMap((v) => v.nodes.map((n) => n.target)))}`,
    );
  const readerFailing = results.violations.filter((v) => !['color-contrast'].includes(v.id));
  if (readerFailing.length)
    throw new Error(`Reader accessibility: ${JSON.stringify(readerFailing.map((v) => v.id))}`);
  await activity.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await activity.getByRole('button', { name: 'Connect Gmail', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Connect your Gmail account' }).waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `${scheme}: connect, read, save, separate activity window, copy/close/reopen, reset, refresh, disconnect and accessibility checks passed`,
  );
  await context.close();
}
await browser.close();
