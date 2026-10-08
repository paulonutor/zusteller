import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { createServices } from '@/app/createServices';
import type { Message } from '@/domain/mail';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import type { SeedData } from '@/infrastructure/mail/mock/seed';
import type { PlatformService } from '@/platform';

const A = 'acct-1';
const platform: PlatformService = {
  showNotification: vi.fn().mockResolvedValue(undefined),
  setBadge: vi.fn().mockResolvedValue(undefined),
  openExternal: vi.fn().mockResolvedValue(undefined),
  setWindowTheme: vi.fn().mockResolvedValue(undefined),
  subscribeMenuActions: () => () => {},
};

const rows = () => screen.queryAllByRole('option');
const waitForRows = (min = 1) => waitFor(() => expect(rows().length).toBeGreaterThanOrEqual(min));
const checkOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-row-check]')!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inboxButton = () =>
  within(screen.getByRole('navigation', { name: 'Mailboxes' })).getByRole('button', {
    name: /^Inbox/,
  });
const inboxUnreadShown = () => Number(inboxButton().textContent?.match(/\d+/)?.[0] ?? 0);

function boot(mail: MockMailService) {
  const user = userEvent.setup();
  render(<App services={{ mail, platform }} />);
  return user;
}
const fresh = () => new MockMailService(createSeedData(), { latency: 0 });

function customSeed(messages: Partial<Message>[]): SeedData {
  const base = createSeedData();
  const tpl = base.messages.find((m) => m.labelIds.includes('INBOX') && !m.isRead)!;
  return {
    accounts: base.accounts,
    labels: base.labels,
    messages: messages.map((over, i) => ({
      ...tpl,
      id: `w${i}-m1`,
      threadId: `w${i}`,
      sentAt: new Date(Date.UTC(2026, 5, 1, 12, 0 - i)).toISOString(),
      isRead: false,
      isStarred: false,
      labelIds: ['INBOX'],
      attachments: [],
      html: undefined,
      ...over,
    })),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('failures mid-action', () => {
  it('offline mid-action rolls back with a message and recovers on reconnect', async () => {
    const mail = fresh();
    const user = boot(mail);
    await waitForRows(4);
    const row = rows()[0]!;
    const id = row.id;
    await user.click(row);
    mail.setOffline(true);
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/Couldn.t archive/)).toBeInTheDocument();
    expect(document.getElementById(id)).not.toBeNull();

    mail.setOffline(false);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(document.getElementById(id)).toBeNull());
  });

  it('partial bulk failure is all-or-nothing: nothing half-applied and the selection survives', async () => {
    const mail = fresh();
    const user = boot(mail);
    await waitForRows(4);
    const picked = rows().slice(0, 3);
    const ids = picked.map((r) => r.id);
    for (const r of picked) await user.click(checkOf(r));
    mail.failNext('archive');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/Couldn.t archive/)).toBeInTheDocument();
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    // The service really archived none of them.
    const inbox = await mail.getThreads({ accountId: A, mailbox: 'inbox', limit: 200 });
    const inboxIds = inbox.items.map((t) => `row-${t.id}`);
    for (const id of ids) expect(inboxIds).toContain(id);
  });

  it('a failed star rolls back and a following star succeeds', async () => {
    const mail = fresh();
    const user = boot(mail);
    await waitForRows(4);
    const star = () => rows()[0]!.querySelector<HTMLElement>('[data-star]')!;
    mail.failNext('setStarred');
    await user.click(star());
    expect(await screen.findByText(/Couldn.t update star/)).toBeInTheDocument();
    await waitFor(() => expect(star()).toHaveAttribute('data-starred', 'false'));
    await user.click(star());
    await waitFor(() => expect(star()).toHaveAttribute('data-starred', 'true'));
  });
});

describe('odd mailbox contents', () => {
  it('empty mailbox shows the empty state', async () => {
    const mail = new MockMailService(customSeed([]), { latency: 0 });
    boot(mail);
    expect(await screen.findByText('Your inbox is empty.')).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'e' });
    fireEvent.keyDown(document.body, { key: '#' });
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
  });

  it('a single thread works end to end', async () => {
    const mail = new MockMailService(customSeed([{ subject: 'Only one' }]), { latency: 0 });
    const user = boot(mail);
    await waitForRows(1);
    expect(rows()).toHaveLength(1);
    await user.click(rows()[0]!);
    expect(await screen.findAllByRole('article')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Your inbox is empty.')).toBeInTheDocument();
  });

  const long = 'Lorem ipsum dolor sit amet '.repeat(60);
  it.each([
    ['no subject', { subject: '' }],
    ['whitespace subject', { subject: '   ' }],
    ['very long subject', { subject: long }],
    [
      'very long sender',
      { from: { name: 'N'.repeat(500), email: `${'x'.repeat(200)}@example.test` } },
    ],
    ['sender without name', { from: { email: 'solo@example.test' } }],
    ['RTL', { subject: 'مرحبا بالعالم שלום עולם', plainText: 'مرحبا' }],
    ['emoji', { subject: '🎉👨‍👩‍👧‍👦🏳️‍🌈 Party', plainText: '🎉' }],
    ['zero-width chars', { subject: 'a​b‍c﻿d‮evil', plainText: '​' }],
    ['no body', { plainText: undefined, html: undefined }],
    ['markup-looking subject', { subject: '<img src=x onerror=alert(1)>' }],
  ] as [string, Partial<Message>][])('renders and opens a thread with %s', async (_n, over) => {
    const mail = new MockMailService(customSeed([over]), { latency: 0 });
    const user = boot(mail);
    await waitForRows(1);
    expect(document.querySelector('img[onerror]')).toBeNull();
    await user.click(rows()[0]!);
    expect(await screen.findAllByRole('article')).toHaveLength(1);
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
  });

  it('a thread with several messages and no subject on the last one still opens', async () => {
    const seed = customSeed([{ subject: 'Hello' }]);
    seed.messages.push({
      ...seed.messages[0]!,
      id: 'w0-m2',
      sentAt: new Date(Date.UTC(2026, 5, 1, 12, 5)).toISOString(),
      subject: '',
    });
    const user = boot(new MockMailService(seed, { latency: 0 }));
    await waitForRows(1);
    await user.click(rows()[0]!);
    expect((await screen.findAllByRole('article')).length).toBe(2);
  });
});

describe('counts and labels', () => {
  it('unread count tracks the service through repeated read/unread, never negative or doubled', async () => {
    const mail = fresh();
    const user = boot(mail);
    await waitForRows(4);
    const serverCount = async () => (await mail.getMailboxCounts(A)).mailboxes.inbox;
    await waitFor(async () => expect(inboxUnreadShown()).toBe(await serverCount()));
    const start = inboxUnreadShown();

    const unreadRow = rows().find((r) => r.getAttribute('data-unread') === 'true')!;
    await user.click(unreadRow);
    await waitFor(() => expect(inboxUnreadShown()).toBe(start - 1));
    // Mark read again on an already-read thread, and re-open it: no extra decrement.
    fireEvent.keyDown(document.body, { key: 'I', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'I', shiftKey: true });
    await sleep(80);
    await user.click(rows()[rows().length - 1]!);
    await user.click(document.getElementById(unreadRow.id)!);
    await sleep(80);
    await waitFor(async () => expect(inboxUnreadShown()).toBe(await serverCount()));
    expect(inboxUnreadShown()).toBeGreaterThanOrEqual(0);

    fireEvent.keyDown(document.body, { key: 'U', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'U', shiftKey: true });
    await waitFor(async () => expect(inboxUnreadShown()).toBe(await serverCount()));
  });

  it('adding a label to a just-trashed thread does not corrupt counts or throw', async () => {
    const mail = fresh();
    const labels = await mail.getLabels(A);
    const userLabel = labels.find((l) => l.type === 'user')!;
    const t = (await mail.getThreads({ accountId: A, mailbox: 'inbox' })).items[0]!;
    await mail.trash(A, [t.id]);
    await mail.addLabel(A, [t.id], userLabel.id);
    const counts = await mail.getMailboxCounts(A);
    for (const n of Object.values(counts.mailboxes)) expect(n).toBeGreaterThanOrEqual(0);
    for (const n of Object.values(counts.labels)) expect(n).toBeGreaterThanOrEqual(0);
    const inTrash = await mail.getThreads({ accountId: A, mailbox: 'trash', limit: 200 });
    expect(inTrash.items.map((x) => x.id)).toContain(t.id);
    const inLabel = await mail.getThreads({ accountId: A, labelId: userLabel.id, limit: 200 });
    expect(inLabel.items.map((x) => x.id)).not.toContain(t.id); // trashed threads leave labels
    await mail.restore(A, [t.id]);
    const back = await mail.getThreads({ accountId: A, labelId: userLabel.id, limit: 200 });
    expect(back.items.map((x) => x.id)).toContain(t.id);
  });

  it('rapid label add/remove from the menu ends in the state the service holds', async () => {
    const mail = fresh();
    const user = boot(mail);
    await waitForRows(4);
    const row = rows().find((r) => r.textContent?.includes('Lunch Thursday'))!;
    const id = row.id.replace(/^row-/, '');
    await user.click(row);
    for (let i = 0; i < 4; i++) {
      await user.click(await screen.findByRole('button', { name: 'Labels' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Home' }));
    }
    await sleep(100);
    const homeId = (await mail.getLabels(A)).find((l) => l.name === 'Home')!.id;
    const t = await mail.getThread(A, id);
    const has = t.labelIds.includes(homeId);
    const shown = within(rows().find((r) => r.id === `row-${id}`) ?? document.body).queryByText(
      'Home',
    );
    expect(Boolean(shown)).toBe(has);
    expect(has).toBe(false); // four toggles
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
  });
});

describe('bad environment', () => {
  it.each([
    ['?latency=abc'],
    ['?latency='],
    ['?latency=NaN'],
    ['?latency=Infinity'],
    ['?skin=zzz&latency=0'],
    ['?seed=nonsense&theme=banana'],
    ['?offline=maybe&latency=0'],
  ])(
    'createServices(%s) falls back to a working service',
    async (search) => {
      const s = createServices(search);
      const accounts = await s.mail.getAccounts();
      expect(accounts.length).toBeGreaterThan(0);
      const page = await s.mail.getThreads({ accountId: accounts[0]!.id, mailbox: 'inbox' });
      expect(page.items.length).toBeGreaterThan(0);
    },
    10_000,
  );

  it('?offline=1 starts offline with a retryable error', async () => {
    const s = createServices('?offline=1&latency=0');
    await expect(s.mail.getAccounts()).rejects.toThrow();
  });

  it('corrupt layout and theme in localStorage still boot', async () => {
    localStorage.setItem('zusteller.layout', '{not json');
    localStorage.setItem('zusteller.theme', 'zzz');
    boot(fresh());
    await waitForRows(4);
  });

  it('wrong-typed layout values do not break the layout', async () => {
    localStorage.setItem('zusteller.layout', JSON.stringify({ sidebar: 99999, list: -5 }));
    boot(fresh());
    await waitForRows(4);
    const sidebar = document.querySelector<HTMLElement>('[data-pane="sidebar"]')!;
    const list = document.querySelector<HTMLElement>('[data-pane="list"]')!;
    expect(parseInt(sidebar.style.width, 10)).toBeLessThanOrEqual(320);
    expect(parseInt(list.style.width, 10)).toBeGreaterThanOrEqual(300);
  });

  it('a throwing localStorage still boots and works', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const user = boot(fresh());
    await waitForRows(4);
    await user.click(screen.getByRole('radio', { name: 'Dark appearance' }));
    expect(document.documentElement).toHaveClass('dark');
  });
});
