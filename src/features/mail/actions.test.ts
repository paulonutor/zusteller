import { describe, expect, it } from 'vitest';
import type { Label, ThreadSummary } from '@/domain/mail';
import { labelStates, resolveActions } from './actions';

const t = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: 'x',
  accountId: 'a',
  subject: 's',
  participants: [],
  snippet: '',
  messageCount: 1,
  lastMessageAt: '2026-01-01T00:00:00Z',
  isRead: false,
  isStarred: false,
  labelIds: ['INBOX'],
  hasAttachments: false,
  ...over,
});
const ids = (a: ReturnType<typeof resolveActions>) => a.filter((x) => x.enabled).map((x) => x.id);

describe('resolveActions', () => {
  const inbox = { kind: 'mailbox', mailbox: 'inbox' } as const;
  it('offers archive/trash/read/star for inbox threads', () => {
    expect(ids(resolveActions([t()], inbox))).toEqual([
      'archive',
      'trash',
      'markRead',
      'star',
      'markJunk',
    ]);
  });
  it('flips to unread/unstar when all are read/starred', () => {
    expect(ids(resolveActions([t({ isRead: true, isStarred: true })], inbox))).toEqual([
      'archive',
      'trash',
      'markUnread',
      'unstar',
      'markJunk',
    ]);
  });
  it('mixed selection offers the "set" direction', () => {
    const a = resolveActions([t({ isRead: true }), t({ isRead: false })], inbox);
    expect(a.map((x) => x.id)).toContain('markRead');
  });
  it('trash view swaps archive/trash for restore and offers no star', () => {
    const a = resolveActions([t({ labelIds: ['TRASH'] })], { kind: 'mailbox', mailbox: 'trash' });
    expect(a.map((x) => x.id)).toEqual(['restore', 'markRead']);
  });
  it('archive is disabled when nothing is in the inbox; all disabled when empty', () => {
    expect(ids(resolveActions([t({ labelIds: [] })], inbox))).not.toContain('archive');
    expect(ids(resolveActions([], inbox))).toEqual([]);
  });
});

describe('resolveActions: Junk', () => {
  const inbox = { kind: 'mailbox', mailbox: 'inbox' } as const;
  const junkView = { kind: 'mailbox', mailbox: 'junk' } as const;
  const junk = (over: Partial<ThreadSummary> = {}) => t({ labelIds: ['SPAM'], ...over });

  it('offers Mark as Junk (shortcut !) in the inbox, label and all-mail views', () => {
    const a = resolveActions([t()], inbox).find((x) => x.id === 'markJunk');
    expect(a).toMatchObject({ label: 'Mark as Junk', shortcut: '!', enabled: true });
    expect(resolveActions([t()], { kind: 'label', labelId: 'L1' }).map((x) => x.id)).toContain(
      'markJunk',
    );
  });
  it('junk view swaps archive/mark-as-junk for Not Junk and offers Delete Permanently instead of trash, and read (no star)', () => {
    const a = resolveActions([junk()], junkView);
    expect(a.map((x) => x.id)).toEqual(['notJunk', 'deleteForever', 'markRead']);
    expect(a.find((x) => x.id === 'notJunk')).toMatchObject({ label: 'Not Junk', shortcut: '!' });
  });
  it('Mark as Junk is disabled when everything selected is already junk', () => {
    const a = resolveActions([junk()], inbox).find((x) => x.id === 'markJunk');
    expect(a?.enabled).toBe(false);
    const mixed = resolveActions([junk(), t()], inbox).find((x) => x.id === 'markJunk');
    expect(mixed?.enabled).toBe(true);
  });
  it('Not Junk is disabled when nothing selected is junk; everything disabled when empty', () => {
    expect(
      resolveActions([t({ labelIds: [] })], junkView).find((x) => x.id === 'notJunk')?.enabled,
    ).toBe(false);
    expect(ids(resolveActions([], junkView))).toEqual([]);
  });
});

describe('labelStates', () => {
  const labels: Label[] = [
    { id: 'L1', accountId: 'a', name: 'W', type: 'user' },
    { id: 'L2', accountId: 'a', name: 'H', type: 'user' },
    { id: 'INBOX', accountId: 'a', name: 'Inbox', type: 'system' },
  ];
  it('reports all/some/none and ignores system labels', () => {
    const s = labelStates([t({ labelIds: ['L1'] }), t({ labelIds: ['L1', 'L2'] })], labels);
    expect(s.get('L1')).toBe('all');
    expect(s.get('L2')).toBe('some');
    expect(s.has('INBOX')).toBe(false);
  });
});
