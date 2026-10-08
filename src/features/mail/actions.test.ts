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
    expect(ids(resolveActions([t()], inbox))).toEqual(['archive', 'trash', 'markRead', 'star']);
  });
  it('flips to unread/unstar when all are read/starred', () => {
    expect(ids(resolveActions([t({ isRead: true, isStarred: true })], inbox))).toEqual([
      'archive',
      'trash',
      'markUnread',
      'unstar',
    ]);
  });
  it('mixed selection offers the "set" direction', () => {
    const a = resolveActions([t({ isRead: true }), t({ isRead: false })], inbox);
    expect(a.map((x) => x.id)).toContain('markRead');
  });
  it('trash view swaps archive/trash for restore', () => {
    const a = resolveActions([t({ labelIds: ['TRASH'] })], { kind: 'mailbox', mailbox: 'trash' });
    expect(a.map((x) => x.id)).toEqual(['restore', 'markRead', 'star']);
  });
  it('archive is disabled when nothing is in the inbox; all disabled when empty', () => {
    expect(ids(resolveActions([t({ labelIds: [] })], inbox))).not.toContain('archive');
    expect(ids(resolveActions([], inbox))).toEqual([]);
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
