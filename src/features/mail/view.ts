import type { ID, SystemMailbox, ThreadQuery } from '@/domain/mail';

/** What the list pane is showing. */
export type MailView = { kind: 'mailbox'; mailbox: SystemMailbox } | { kind: 'label'; labelId: ID };

export const viewKey = (v: MailView) =>
  v.kind === 'mailbox' ? `m:${v.mailbox}` : `l:${v.labelId}`;

export function toQuery(
  accountId: ID,
  view: MailView,
  search: string,
): Omit<ThreadQuery, 'cursor'> {
  const q = search.trim();
  return {
    accountId,
    ...(view.kind === 'mailbox' ? { mailbox: view.mailbox } : { labelId: view.labelId }),
    ...(q ? { search: q } : {}),
    limit: 30,
  };
}
