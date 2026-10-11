// Synthetic native-provider UI checks; no OAuth tokens or real Gmail data.
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
  await page.addInitScript(() => {
    let connected = false;
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
          if (command === 'gmail_connect') {
            connected = true;
            return account;
          }
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
      event: { listen: async () => () => {} },
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
  await page.getByRole('button', { name: 'Save preview.txt' }).click();
  await page.getByRole('button', { name: 'Reset local changes' }).click();
  results = await new AxeBuilder({ page }).analyze();
  const readerContrast = results.violations.filter((v) => v.id === 'color-contrast');
  if (readerContrast.length)
    console.log(
      `${scheme} reader contrast findings: ${JSON.stringify(readerContrast.flatMap((v) => v.nodes.map((n) => n.target)))}`,
    );
  const readerFailing = results.violations.filter((v) => !['color-contrast'].includes(v.id));
  if (readerFailing.length)
    throw new Error(`Reader accessibility: ${JSON.stringify(readerFailing.map((v) => v.id))}`);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect your Gmail account' }).waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`${scheme}: connect, read, save, reset, disconnect and accessibility checks passed`);
  await context.close();
}
await browser.close();
