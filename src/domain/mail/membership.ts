import { SYSTEM_LABEL } from './system';
import type { ID, SystemMailbox, ThreadQuery, ThreadSummary } from './types';

export type MailboxAction = 'archive' | 'trash';

/** Shared V1 membership rules for the provider and optimistic cache updates. */
export function applyMailboxAction(labels: ID[], action: MailboxAction): ID[] {
  const remaining = labels.filter(
    (id) => id !== SYSTEM_LABEL.inbox && (action !== 'trash' || id !== SYSTEM_LABEL.junk),
  );
  return action === 'trash' && !remaining.includes(SYSTEM_LABEL.trash)
    ? [...remaining, SYSTEM_LABEL.trash]
    : remaining;
}

export function inMailbox(thread: ThreadSummary, mailbox: SystemMailbox): boolean {
  const trash = thread.labelIds.includes(SYSTEM_LABEL.trash);
  const junk = thread.labelIds.includes(SYSTEM_LABEL.junk);
  const live = !trash && !junk;
  switch (mailbox) {
    case 'trash':
      return trash;
    case 'junk':
      return junk && !trash;
    case 'inbox':
      return live && thread.labelIds.includes(SYSTEM_LABEL.inbox);
    case 'sent':
      return live && thread.labelIds.includes(SYSTEM_LABEL.sent);
    case 'starred':
      return live && thread.isStarred;
    case 'all':
      return live;
  }
}

/** Search matching remains provider-owned; this checks only mailbox/label membership. */
export function matchesMembership(thread: ThreadSummary, query: ThreadQuery): boolean {
  if (query.mailbox) return inMailbox(thread, query.mailbox);
  if (!query.labelId) return inMailbox(thread, 'inbox');
  const hidden =
    (thread.labelIds.includes(SYSTEM_LABEL.trash) && query.labelId !== SYSTEM_LABEL.trash) ||
    (thread.labelIds.includes(SYSTEM_LABEL.junk) && query.labelId !== SYSTEM_LABEL.junk);
  return !hidden && thread.labelIds.includes(query.labelId);
}
