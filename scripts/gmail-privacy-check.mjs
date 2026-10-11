// Synthetic IPC responses only. Never connects to Gmail or reads a native cache.
/* global window */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const out = process.argv[2] ?? '/tmp/zusteller-gmail-privacy';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      const account = {
        id: 'private-account-1',
        email: 'private-account-1@example.invalid',
        displayName: 'Privacy mode',
        privacyProtected: true,
      };
      const summary = {
        id: 'private-thread-2',
        accountId: account.id,
        subject: 'Private conversation 2',
        snippet: 'Synthetic preview. Original email content is hidden.',
        participants: [{ name: 'Person 3', email: 'private-person-3@example.invalid' }],
        messageCount: 1,
        lastMessageAt: '2026-01-01T12:00:00Z',
        isRead: true,
        isStarred: false,
        labelIds: ['INBOX', 'private-label-4'],
        hasAttachments: true,
      };
      const thread = {
        ...summary,
        messages: [
          {
            id: 'private-message-5',
            threadId: summary.id,
            accountId: account.id,
            subject: summary.subject,
            from: summary.participants[0],
            to: [{ name: 'Person 6', email: 'private-person-6@example.invalid' }],
            sentAt: summary.lastMessageAt,
            isRead: true,
            isStarred: false,
            labelIds: summary.labelIds,
            plainText: 'This is a synthetic message for private testing.',
            html: '<h2>Private test message</h2><p>This synthetic content replaces the original email, including links and images.</p>',
            attachments: [
              {
                id: 'private-attachment-7',
                filename: 'Private attachment.bin',
                mimeType: 'application/octet-stream',
                size: 12,
              },
            ],
          },
        ],
      };
      let snapshot = { status: { state: 'idle' }, busy: false };
      let bodyAttempts = 0;
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            if (command === 'gmail_read') {
              switch (args.operation) {
                case 'accounts':
                  return [account];
                case 'labels':
                  return [
                    { id: 'private-label-4', accountId: account.id, name: 'Label 4', type: 'user' },
                  ];
                case 'counts':
                  return {
                    mailboxes: { inbox: 0, starred: 0, sent: 0, junk: 0, trash: 0, all: 0 },
                    labels: { 'private-label-4': 0 },
                    estimated: true,
                  };
                case 'threads':
                  return { items: [summary], nextCursor: null };
                case 'summaries':
                  return [summary];
                case 'thread':
                  if (++bodyAttempts === 1)
                    throw { code: 'rate_limit', message: 'Synthetic cooldown', retryAfter: 1 };
                  return thread;
                case 'sync':
                  return false;
                case 'action':
                  return null;
                default:
                  throw { message: 'Account changes are disabled in privacy mode' };
              }
            }
            if (command === 'gmail_diagnostics')
              return { entries: [], requests: 0, quotaUnits: 0, rateLimits: 0, cacheHits: 0 };
            if (command === 'gmail_activity_publish') {
              snapshot = args.snapshot;
              return;
            }
            if (command === 'gmail_activity_snapshot') return snapshot;
            if (command === 'gmail_download')
              throw { message: 'Attachment downloads are disabled in privacy mode' };
            if (command === 'gmail_connect')
              throw { message: 'Sign-in is disabled in privacy mode' };
            if (command === 'accent_color') return null;
          },
        },
        event: { listen: async () => () => {} },
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:47831/?theme=${theme}`);
    await page
      .getByRole('navigation', { name: 'Mailboxes' })
      .getByText('Privacy mode', { exact: true })
      .waitFor();
    await page.getByRole('option').filter({ hasText: 'Private conversation 2' }).click();
    await page.getByRole('status', { name: 'Waiting for request limit' }).waitFor();
    await page.screenshot({ path: `${out}/${theme}-cooldown.png` });
    await page.getByText('Private attachment.bin', { exact: true }).waitFor();
    const reader = page.frameLocator('iframe[title="Message body: Private conversation 2"]');
    await reader.getByText('Private test message', { exact: true }).waitFor();
    assert.equal(await reader.locator('img, a[href]').count(), 0);
    await page.screenshot({ path: `${out}/${theme}.png` });
    await page.setViewportSize({ width: 980, height: 620 });
    await page.screenshot({ path: `${out}/${theme}-compact.png` });
    const audit = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .options({ iframes: false })
      .analyze();
    assert.deepEqual(
      audit.violations.filter((v) => v.id !== 'color-contrast'),
      [],
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${theme}: protected account, labels, reader and compact layout passed`);
  }
} finally {
  await browser.close();
}
