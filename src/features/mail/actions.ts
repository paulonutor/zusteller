import { SYSTEM_LABEL, type ID, type Label, type ThreadSummary } from '@/domain/mail';
import type { MailView } from './view';

/**
 * The single list of user-invokable mail actions. Toolbar, context menu and
 * keyboard shortcuts all resolve through `resolveActions` and execute through
 * `useMailActions().run`, so behaviour cannot drift between entry points.
 */
export type MailActionId =
  'archive' | 'trash' | 'restore' | 'markRead' | 'markUnread' | 'star' | 'unstar';

/** Everything `useMailActions().run` can execute; the resolver only offers the `MailActionId`s. */
export type PerformAction = MailActionId | 'addLabel' | 'removeLabel' | 'moveToLabel';

export type ActionDescriptor = {
  id: MailActionId;
  label: string;
  /** Display string, e.g. "E". Matching is done in shortcuts.ts. */
  shortcut?: string;
  enabled: boolean;
};

const has = (t: ThreadSummary, id: ID) => t.labelIds.includes(id);

/** Which actions apply to `threads` in `view`. Empty selection => nothing enabled. */
export function resolveActions(threads: ThreadSummary[], view: MailView): ActionDescriptor[] {
  const some = threads.length > 0;
  const inTrashView = view.kind === 'mailbox' && view.mailbox === 'trash';
  const allRead = some && threads.every((t) => t.isRead);
  const allStarred = some && threads.every((t) => t.isStarred);
  const list: ActionDescriptor[] = [];

  if (inTrashView) {
    list.push({ id: 'restore', label: 'Move to Inbox', shortcut: '⇧Z', enabled: some });
  } else {
    list.push({
      id: 'archive',
      label: 'Archive',
      shortcut: 'E',
      enabled: threads.some((t) => has(t, SYSTEM_LABEL.inbox)),
    });
    list.push({ id: 'trash', label: 'Move to Trash', shortcut: '⌫', enabled: some });
  }
  list.push(
    allRead
      ? { id: 'markUnread', label: 'Mark as Unread', shortcut: '⇧U', enabled: some }
      : { id: 'markRead', label: 'Mark as Read', shortcut: '⇧I', enabled: some },
  );
  list.push(
    allStarred
      ? { id: 'unstar', label: 'Remove Star', shortcut: 'S', enabled: some }
      : { id: 'star', label: 'Add Star', shortcut: 'S', enabled: some },
  );
  return list;
}

export type LabelState = 'all' | 'some' | 'none';

/** For the Labels menu: does every / some / none of the selected threads carry each label? */
export function labelStates(threads: ThreadSummary[], labels: Label[]): Map<ID, LabelState> {
  const out = new Map<ID, LabelState>();
  for (const l of labels) {
    if (l.type !== 'user') continue;
    const n = threads.filter((t) => has(t, l.id)).length;
    out.set(l.id, n === 0 ? 'none' : n === threads.length ? 'all' : 'some');
  }
  return out;
}
