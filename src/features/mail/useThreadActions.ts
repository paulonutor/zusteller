import { useMemo } from 'react';
import type { ID, Label, ThreadSummary } from '@/domain/mail';
import type { MenuItemSpec } from '@/components/ui/Menu';
import { labelStates, resolveActions, type ActionDescriptor, type PerformAction } from './actions';
import type { MailView } from './view';

export type Perform = (action: PerformAction, ids: ID[], opts?: { labelId?: ID }) => void;

/**
 * Derives everything a menu or toolbar needs for a set of threads from the one
 * action resolver, so toolbar / context menu / shortcuts stay identical.
 */
export function buildThreadActions(
  threads: ThreadSummary[],
  view: MailView,
  labels: Label[],
  perform: Perform,
) {
  {
    const ids = threads.map((t) => t.id);
    const actions = resolveActions(threads, view);
    const states = labelStates(threads, labels);
    const userLabels = labels.filter((l) => l.type === 'user');
    const none = threads.length === 0;

    const labelItems: MenuItemSpec[] = userLabels.map((l) => ({
      kind: 'check',
      label: l.name,
      color: l.color,
      state: states.get(l.id) ?? 'none',
      // 'all' => remove from everything; otherwise add to all.
      onSelect: () =>
        perform(states.get(l.id) === 'all' ? 'removeLabel' : 'addLabel', ids, { labelId: l.id }),
    }));

    const toItem = (a: ActionDescriptor): MenuItemSpec => ({
      kind: 'item',
      label: a.label,
      shortcut: a.shortcut,
      disabled: !a.enabled,
      onSelect: () => perform(a.id, ids),
    });

    const contextItems: MenuItemSpec[] = [
      ...actions
        .filter((a) => a.id === 'archive' || a.id === 'trash' || a.id === 'restore')
        .map(toItem),
      { kind: 'separator' },
      ...actions
        .filter((a) => a.id !== 'archive' && a.id !== 'trash' && a.id !== 'restore')
        .map(toItem),
      { kind: 'separator' },
      {
        kind: 'sub',
        label: 'Labels',
        disabled: none || userLabels.length === 0,
        items: labelItems,
      },
    ];

    return { actions, labelItems, contextItems, hasLabels: userLabels.length > 0, none };
  }
}

export function useThreadActions(
  threads: ThreadSummary[],
  view: MailView,
  labels: Label[],
  perform: Perform,
) {
  return useMemo(
    () => buildThreadActions(threads, view, labels, perform),
    [threads, view, labels, perform],
  );
}
