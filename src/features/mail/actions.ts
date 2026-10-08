import { SYSTEM_LABEL, type ID, type Label, type ThreadSummary } from '@/domain/mail';
import type { MailView } from './view';

/**
 * The single list of user-invokable mail actions. Toolbar, context menu and
 * keyboard shortcuts all resolve through `resolveActions` and execute through
 * `useMailActions().run`, so behaviour cannot drift between entry points.
 */
export type MailActionId =
  | 'archive'
  | 'trash'
  | 'restore'
  | 'markRead'
  | 'markUnread'
  | 'star'
  | 'unstar'
  | 'markJunk'
  | 'notJunk'
  | 'deleteForever';

/** Everything `useMailActions().run` can execute; the resolver only offers the `MailActionId`s. */
export type PerformAction = MailActionId | 'addLabel' | 'removeLabel' | 'moveToLabel';

export type ActionDescriptor = {
  id: MailActionId;
  label: string;
  /** Display string, e.g. "E". Matching is done in shortcuts.ts. */
  shortcut?: string;
  /** Render as a text button in the toolbar instead of an icon. */
  text?: boolean;
  destructive?: boolean;
  enabled: boolean;
};

const has = (t: ThreadSummary, id: ID) => t.labelIds.includes(id);

/** Which actions apply to `threads` in `view`. Empty selection => nothing enabled. */
export function resolveActions(threads: ThreadSummary[], view: MailView): ActionDescriptor[] {
  const some = threads.length > 0;
  const inTrashView = view.kind === 'mailbox' && view.mailbox === 'trash';
  const inJunkView = view.kind === 'mailbox' && view.mailbox === 'junk';
  const allRead = some && threads.every((t) => t.isRead);
  const allStarred = some && threads.every((t) => t.isStarred);
  const list: ActionDescriptor[] = [];

  if (inJunkView) {
    // Junk threads are not in the Inbox, so there is nothing to archive: offer the way out instead.
    list.push({
      id: 'notJunk',
      label: 'Not Junk',
      shortcut: '!',
      text: true,
      enabled: threads.some((t) => has(t, SYSTEM_LABEL.junk)),
    });
    list.push({
      id: 'deleteForever',
      label: 'Delete Permanently',
      destructive: true,
      enabled: some,
    });
  } else if (inTrashView) {
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
  // Junk is a place to leave, not to organise: no starring or labelling there.
  if (!inJunkView) {
    list.push(
      allStarred
        ? { id: 'unstar', label: 'Remove Star', shortcut: 'S', enabled: some }
        : { id: 'star', label: 'Add Star', shortcut: 'S', enabled: some },
    );
    list.push({
      id: 'markJunk',
      label: 'Mark as Junk',
      shortcut: '!',
      enabled: threads.some((t) => !has(t, SYSTEM_LABEL.junk)),
    });
  }
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
