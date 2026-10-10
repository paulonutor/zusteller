import { beforeEach, describe, expect, it } from 'vitest';
import { MailServiceError, type Message } from '@/domain/mail';
import { MockMailService } from './MockMailService';
import type { SeedData } from './seed';

const A = 'acct-1';
const me = { name: 'Me', email: 'me@example.com' };
const bob = { name: 'Bob Builder', email: 'bob@example.com' };

let n = 0;
function msg(threadId: string, minute: number, over: Partial<Message> = {}): Message {
  n++;
  return {
    id: `${threadId}-m${n}`,
    threadId,
    accountId: A,
    from: bob,
    to: [me],
    subject: `Subject ${threadId}`,
    sentAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    plainText: `body of ${threadId}`,
    isRead: false,
    isStarred: false,
    labelIds: ['INBOX'],
    attachments: [],
    ...over,
  };
}

function seed(): SeedData {
  return {
    accounts: [{ id: A, email: me.email, displayName: 'Me' }],
    labels: [
      { id: 'INBOX', accountId: A, name: 'Inbox', type: 'system' },
      { id: 'SENT', accountId: A, name: 'Sent', type: 'system' },
      { id: 'TRASH', accountId: A, name: 'Trash', type: 'system' },
      { id: 'L1', accountId: A, name: 'Work', type: 'user' },
      { id: 'L2', accountId: A, name: 'Home', type: 'user' },
    ],
    messages: [
      msg('t1', 10, { labelIds: ['INBOX', 'L1'] }),
      // multi-message: one unread, one read, one starred; reply is from me
      msg('t2', 20, { isRead: true }),
      msg('t2', 25, {
        from: me,
        to: [bob],
        isRead: true,
        labelIds: ['INBOX', 'SENT'],
        subject: 'Re: Subject t2',
      }),
      msg('t2', 30, { isStarred: true, isRead: false, plainText: 'needle in a haystack' }),
      msg('t3', 40, { from: me, to: [bob], isRead: true, labelIds: ['SENT'] }),
      msg('t4', 50, { labelIds: ['TRASH'], isRead: true }),
      msg('t5', 60, {
        labelIds: [],
        isRead: true,
        attachments: [{ id: 'a', filename: 'invoice.pdf', mimeType: 'application/pdf', size: 10 }],
      }),
      msg('t6', 60, {
        labelIds: ['INBOX', 'L2'],
        html: '<p>Hello <b>world</b></p>',
        plainText: undefined,
      }),
    ],
  };
}

let svc: MockMailService;
const ids = async (q: Parameters<MockMailService['getThreads']>[0]) =>
  (await svc.getThreads(q)).items.map((t) => t.id);

beforeEach(() => {
  svc = new MockMailService(seed(), { latency: 0 });
});

describe('queries', () => {
  it('lists mailboxes with documented semantics, newest first, id tie-break', async () => {
    expect(await ids({ accountId: A, mailbox: 'inbox' })).toEqual(['t6', 't2', 't1']);
    expect(await ids({ accountId: A, mailbox: 'sent' })).toEqual(['t3', 't2']);
    expect(await ids({ accountId: A, mailbox: 'starred' })).toEqual(['t2']);
    expect(await ids({ accountId: A, mailbox: 'trash' })).toEqual(['t4']);
    expect(await ids({ accountId: A, mailbox: 'all' })).toEqual(['t6', 't5', 't3', 't2', 't1']);
  });

  it('filters by user label and excludes trashed threads', async () => {
    expect(await ids({ accountId: A, labelId: 'L1' })).toEqual(['t1']);
    await svc.trash(A, ['t1']);
    expect(await ids({ accountId: A, labelId: 'L1' })).toEqual([]);
  });

  it('derives thread summary flags', async () => {
    const t2 = (await svc.getThreads({ accountId: A, mailbox: 'all' })).items.find(
      (t) => t.id === 't2',
    )!;
    expect(t2).toMatchObject({
      messageCount: 3,
      isRead: false,
      isStarred: true,
      subject: 'Subject t2',
    });
    expect(t2.labelIds).toEqual(expect.arrayContaining(['INBOX', 'SENT']));
    const t5 = (await svc.getThreads({ accountId: A, mailbox: 'all' })).items.find(
      (t) => t.id === 't5',
    )!;
    expect(t5.hasAttachments).toBe(true);
  });

  it('returns thread messages in ascending order', async () => {
    const t = await svc.getThread(A, 't2');
    expect(t.messages.map((m) => m.sentAt)).toEqual([...t.messages.map((m) => m.sentAt)].sort());
  });

  it('returns copies, not live state', async () => {
    const t = await svc.getThread(A, 't1');
    t.messages[0]!.isRead = true;
    expect((await svc.getThread(A, 't1')).isRead).toBe(false);
  });

  it('rejects unknown ids', async () => {
    await expect(svc.getThread(A, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.getThreads({ accountId: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('search', () => {
  it('matches sender, recipient, subject, body, html text and attachment names (AND, case-insensitive)', async () => {
    const q = (search: string) => ids({ accountId: A, mailbox: 'all', search });
    expect(await q('NEEDLE')).toEqual(['t2']);
    expect(await q('subject t1')).toEqual(['t1']);
    expect(await q('bob@example')).toEqual(['t6', 't5', 't3', 't2', 't1']);
    expect(await q('hello world')).toEqual(['t6']);
    expect(await q('invoice.pdf')).toEqual(['t5']);
    expect(await q('needle nothere')).toEqual([]);
  });

  it('respects the current mailbox', async () => {
    expect(await ids({ accountId: A, mailbox: 'inbox', search: 'invoice' })).toEqual([]);
  });
});

describe('pagination', () => {
  it('pages without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await svc.getThreads({ accountId: A, mailbox: 'all', limit: 2, cursor });
      seen.push(...p.items.map((t) => t.id));
      cursor = p.nextCursor;
    } while (cursor);
    expect(seen).toEqual(await ids({ accountId: A, mailbox: 'all' }));
  });

  it('is stable when rows are removed between pages', async () => {
    const p1 = await svc.getThreads({ accountId: A, mailbox: 'all', limit: 2 });
    await svc.trash(A, [p1.items[0]!.id]);
    const p2 = await svc.getThreads({
      accountId: A,
      mailbox: 'all',
      limit: 2,
      cursor: p1.nextCursor,
    });
    expect(p2.items.map((t) => t.id)).toEqual(['t3', 't2']);
  });

  it('has no cursor on the last page and rejects garbage cursors', async () => {
    expect(
      (await svc.getThreads({ accountId: A, mailbox: 'all', limit: 50 })).nextCursor,
    ).toBeUndefined();
    await expect(svc.getThreads({ accountId: A, cursor: '%%%' })).rejects.toBeInstanceOf(
      MailServiceError,
    );
  });
});

describe('mutations', () => {
  it('markRead applies to every message in the thread', async () => {
    await svc.markRead(A, ['t2'], true);
    const t = await svc.getThread(A, 't2');
    expect(t.isRead).toBe(true);
    expect(t.messages.every((m) => m.isRead)).toBe(true);
    await svc.markRead(A, ['t2'], false);
    expect((await svc.getThread(A, 't2')).messages.every((m) => !m.isRead)).toBe(true);
  });

  it('setStarred toggles the Starred mailbox', async () => {
    await svc.setStarred(A, ['t1'], true);
    expect(await ids({ accountId: A, mailbox: 'starred' })).toEqual(['t2', 't1']);
    await svc.setStarred(A, ['t1', 't2'], false);
    expect(await ids({ accountId: A, mailbox: 'starred' })).toEqual([]);
  });

  it('archive removes Inbox only; thread stays in All', async () => {
    await svc.archive(A, ['t1']);
    expect(await ids({ accountId: A, mailbox: 'inbox' })).toEqual(['t6', 't2']);
    expect(await ids({ accountId: A, mailbox: 'all' })).toContain('t1');
  });

  it('trash removes from Inbox/All/Starred and lists in Trash; restore returns to Inbox', async () => {
    await svc.trash(A, ['t2']);
    expect(await ids({ accountId: A, mailbox: 'trash' })).toEqual(['t4', 't2']);
    for (const mailbox of ['inbox', 'all', 'starred', 'sent'] as const)
      expect(await ids({ accountId: A, mailbox })).not.toContain('t2');
    await svc.restore(A, ['t2']);
    expect(await ids({ accountId: A, mailbox: 'trash' })).toEqual(['t4']);
    expect(await ids({ accountId: A, mailbox: 'inbox' })).toContain('t2');
  });

  it('add/remove label is idempotent and rejects system or unknown labels', async () => {
    await svc.addLabel(A, ['t5'], 'L1');
    await svc.addLabel(A, ['t5'], 'L1');
    const t = await svc.getThread(A, 't5');
    expect(t.labelIds.filter((l) => l === 'L1')).toHaveLength(1);
    await svc.removeLabel(A, ['t5'], 'L1');
    expect((await svc.getThread(A, 't5')).labelIds).not.toContain('L1');
    await expect(svc.addLabel(A, ['t5'], 'INBOX')).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.addLabel(A, ['t5'], 'zzz')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('is atomic: a bad id applies nothing', async () => {
    await expect(svc.markRead(A, ['t1', 'nope'], true)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await svc.getThread(A, 't1')).isRead).toBe(false);
  });
});

describe('counts', () => {
  it('counts unread threads per mailbox and label and tracks mutations', async () => {
    const c = await svc.getMailboxCounts(A);
    expect(c.mailboxes).toMatchObject({ inbox: 3, starred: 1, sent: 1, trash: 0, all: 3 });
    expect(c.labels).toEqual({ L1: 1, L2: 1 });
    await svc.markRead(A, ['t1', 't6'], true);
    expect((await svc.getMailboxCounts(A)).mailboxes.inbox).toBe(1);
    await svc.trash(A, ['t2']);
    const after = await svc.getMailboxCounts(A);
    expect(after.mailboxes).toMatchObject({ inbox: 0, trash: 1, starred: 0 });
  });
});

describe('simulation', () => {
  it('offline fails everything until cleared', async () => {
    svc.setOffline(true);
    await expect(svc.getAccounts()).rejects.toMatchObject({ code: 'offline' });
    svc.clearFailures();
    await expect(svc.getAccounts()).resolves.toHaveLength(1);
  });

  it('failNext fails exactly N matching calls and does not mutate', async () => {
    svc.failNext('markRead', 1);
    await svc.getAccounts(); // other methods unaffected
    await expect(svc.markRead(A, ['t1'], true)).rejects.toMatchObject({ code: 'simulated' });
    expect((await svc.getThread(A, 't1')).isRead).toBe(false);
    await expect(svc.markRead(A, ['t1'], true)).resolves.toBeUndefined();
  });

  it('applies configurable latency', async () => {
    svc.setLatency(40);
    const t0 = performance.now();
    await svc.getAccounts();
    expect(performance.now() - t0).toBeGreaterThanOrEqual(35);
  });
});

describe('junk', () => {
  it('deleteForever removes junk/trashed threads for good and rejects anything else atomically', async () => {
    await svc.markJunk(A, ['t1']);
    await expect(svc.deleteForever(A, ['t1', 't2'])).rejects.toMatchObject({ code: 'invalid' });
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual(['t1']); // nothing was deleted
    await svc.deleteForever(A, ['t1']);
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual([]);
    await expect(svc.getThread(A, 't1')).rejects.toMatchObject({ code: 'not_found' });
    await svc.trash(A, ['t2']);
    await svc.deleteForever(A, ['t2']);
    expect(await ids({ accountId: A, mailbox: 'trash' })).not.toContain('t2');
  });

  it('markJunk moves a thread out of Inbox/All/Starred/Sent/labels into Junk, keeping its labels', async () => {
    await svc.markJunk(A, ['t2', 't1']);
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual(['t2', 't1']);
    for (const mailbox of ['inbox', 'all', 'starred', 'sent'] as const) {
      const got = await ids({ accountId: A, mailbox });
      expect(got).not.toContain('t1');
      expect(got).not.toContain('t2');
    }
    expect(await ids({ accountId: A, labelId: 'L1' })).toEqual([]);
    const t = await svc.getThread(A, 't1');
    expect(t.labelIds).toEqual(expect.arrayContaining(['SPAM', 'L1']));
    expect(t.labelIds).not.toContain('INBOX');
    // every message of a multi-message thread is marked
    const t2 = await svc.getThread(A, 't2');
    expect(t2.messages.every((m) => m.labelIds.includes('SPAM'))).toBe(true);
  });

  it('markJunk is idempotent and also pulls a trashed thread out of Trash', async () => {
    await svc.markJunk(A, ['t4']);
    await svc.markJunk(A, ['t4']);
    expect(await ids({ accountId: A, mailbox: 'trash' })).toEqual([]);
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual(['t4']);
    const labels = (await svc.getThread(A, 't4')).messages[0]!.labelIds;
    expect(labels.filter((l) => l === 'SPAM')).toHaveLength(1);
  });

  it('notJunk returns the thread to the Inbox and leaves non-junk threads alone', async () => {
    await svc.markJunk(A, ['t1']);
    await svc.notJunk(A, ['t1', 't5']);
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual([]);
    expect(await ids({ accountId: A, mailbox: 'inbox' })).toContain('t1');
    expect(await ids({ accountId: A, labelId: 'L1' })).toEqual(['t1']);
    // t5 was archived (no INBOX) and never junk: unchanged
    expect((await svc.getThread(A, 't5')).labelIds).toEqual([]);
  });

  it('trash from Junk leaves Junk; restore (Move to Inbox) clears Junk and Trash', async () => {
    await svc.markJunk(A, ['t1']);
    await svc.trash(A, ['t1']);
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual([]);
    expect(await ids({ accountId: A, mailbox: 'trash' })).toContain('t1');
    expect((await svc.getThread(A, 't1')).labelIds).not.toContain('SPAM');
    await svc.markJunk(A, ['t6']);
    await svc.restore(A, ['t6']);
    const labels = (await svc.getThread(A, 't6')).labelIds;
    expect(labels).toContain('INBOX');
    expect(labels).not.toContain('SPAM');
  });

  it('archive does not change Junk membership', async () => {
    await svc.markJunk(A, ['t1']);
    await svc.archive(A, ['t1']);
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual(['t1']);
  });

  it('a junk thread is found by search in Junk but not in All', async () => {
    await svc.markJunk(A, ['t2']);
    expect(await ids({ accountId: A, mailbox: 'junk', search: 'needle' })).toEqual(['t2']);
    expect(await ids({ accountId: A, mailbox: 'all', search: 'needle' })).toEqual([]);
  });

  it('counts unread Junk separately and keeps junk out of the other counts', async () => {
    const before = await svc.getMailboxCounts(A);
    expect(before.mailboxes.junk).toBe(0);
    await svc.markJunk(A, ['t2', 't1']); // both unread; t2 starred
    const after = await svc.getMailboxCounts(A);
    expect(after.mailboxes).toMatchObject({ inbox: 1, starred: 0, all: 1, junk: 2, trash: 0 });
    expect(after.labels).toEqual({ L1: 0, L2: 1 });
    await svc.markRead(A, ['t1'], true);
    expect((await svc.getMailboxCounts(A)).mailboxes.junk).toBe(1);
  });

  it('junk mutations are atomic, validated and subject to failure injection', async () => {
    await expect(svc.markJunk(A, ['t1', 'nope'])).rejects.toMatchObject({ code: 'not_found' });
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual([]);
    await expect(svc.notJunk(A, ['nope'])).rejects.toMatchObject({ code: 'not_found' });
    svc.failNext('markJunk');
    await expect(svc.markJunk(A, ['t1'])).rejects.toMatchObject({ code: 'simulated' });
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual([]);
    await svc.markJunk(A, ['t1']);
    expect(await ids({ accountId: A, mailbox: 'junk' })).toEqual(['t1']);
  });

  it('rejects SPAM as a user label', async () => {
    await expect(svc.addLabel(A, ['t1'], 'SPAM')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('move to label', () => {
  it('labels every message and removes Inbox in one call', async () => {
    await svc.moveToLabel(A, ['t1', 't2'], 'L2');
    for (const id of ['t1', 't2']) {
      const thread = await svc.getThread(A, id);
      for (const message of thread.messages) {
        expect(message.labelIds).toContain('L2');
        expect(message.labelIds).not.toContain('INBOX');
      }
    }
    expect((await svc.getThread(A, 't1')).labelIds).toContain('L1');
  });

  it.each(['unknown', 'INBOX'])('rejects label %s without changing any messages', async (label) => {
    const before = await svc.getThread(A, 't2');
    await expect(svc.moveToLabel(A, ['t2'], label)).rejects.toMatchObject({ code: 'invalid' });
    expect(await svc.getThread(A, 't2')).toEqual(before);
  });

  it('validates the entire batch and fails before applying either change', async () => {
    const before = await svc.getThread(A, 't1');
    await expect(svc.moveToLabel(A, ['t1', 'missing'], 'L2')).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await svc.getThread(A, 't1')).toEqual(before);
    svc.failNext('moveToLabel');
    await expect(svc.moveToLabel(A, ['t1'], 'L2')).rejects.toMatchObject({ code: 'simulated' });
    expect(await svc.getThread(A, 't1')).toEqual(before);
  });
});
