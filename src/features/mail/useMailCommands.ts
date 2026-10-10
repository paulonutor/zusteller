import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useServices } from '@/app/services';
import type { ID, ThreadSummary } from '@/domain/mail';
import { resolveActions, type MailActionId } from './actions';
import { nextAfterRemoval, type Selection } from './selection';
import { useGlobalShortcuts } from './shortcuts';
import type { Perform } from './useThreadActions';
import { useMailActions } from './useMailActions';
import type { MailView } from './view';

type Options = {
  accountId: ID | undefined;
  view: MailView;
  ids: ID[];
  items: ThreadSummary[];
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  selectedSummaries: ThreadSummary[];
  open: ID | null;
  searchRef: RefObject<HTMLInputElement | null>;
};

export function useMailCommands({
  accountId,
  view,
  ids,
  items,
  selection,
  setSelection,
  selectedSummaries,
  open,
  searchRef,
}: Options) {
  const { mail, platform } = useServices();
  const { run, refresh } = useMailActions(accountId);
  // New mail announced by the provider: refetch lists and counts (the list animates the arrivals).
  useEffect(() => mail.subscribe?.(() => void refresh()), [mail, refresh]);

  // Opening a conversation marks it read (once per open, not on every later state change).
  const markedFor = useRef<ID | null>(null);
  useEffect(() => {
    if (!open) {
      markedFor.current = null;
      return;
    }
    if (markedFor.current === open) return;
    markedFor.current = open;
    const summary = items.find((t) => t.id === open);
    if (summary && !summary.isRead) void run('markRead', [open]);
  }, [open, items, run]);

  const perform: Perform = useCallback(
    async (action, targetIds, opts) => {
      const removes =
        (action === 'archive' && view.kind === 'mailbox' && view.mailbox === 'inbox') ||
        action === 'trash' ||
        action === 'restore' ||
        action === 'markJunk' ||
        action === 'notJunk' ||
        action === 'deleteForever' ||
        // Moving to a label takes rows out of the Inbox view only.
        (action === 'moveToLabel' && view.kind === 'mailbox' && view.mailbox === 'inbox');
      if (action === 'deleteForever') {
        const n = targetIds.length;
        const ok = await platform.confirm({
          title:
            n === 1
              ? 'Delete this conversation permanently?'
              : `Delete ${n} conversations permanently?`,
          message: "This can't be undone.",
          confirmLabel: 'Delete',
          destructive: true,
        });
        if (!ok) return false;
      }
      const next = removes ? nextAfterRemoval(ids, new Set(targetIds)) : null;
      let previousSelection: Selection | undefined;
      let advancedSelection: Selection | undefined;
      const advanceSelection = () => {
        const acted = new Set(targetIds);
        // Only move the selection if it still refers to the acted-on rows; if the user has
        // since selected something else, leave their newer selection alone.
        setSelection((s) => {
          const stillSame =
            [...s.selected].every((id) => acted.has(id)) &&
            (s.focusedId === null || acted.has(s.focusedId));
          if (!stillSame) return s;
          // Removing the open conversation opens the next one; bulk removals just move the cursor.
          const wasOpen = s.selected.size === 1;
          previousSelection = s;
          advancedSelection = {
            selected: wasOpen && next ? new Set([next]) : new Set(),
            focusedId: next,
            anchorId: next,
          };
          return advancedSelection;
        });
      };
      const optimistic = action === 'archive' || action === 'trash';
      if (optimistic && removes) advanceSelection();
      const ok = await run(action, targetIds, opts);
      if (ok && removes && !optimistic) advanceSelection();
      if (!ok && optimistic && removes) {
        setSelection((s) => (s === advancedSelection && previousSelection ? previousSelection : s));
      }
      return ok;
    },
    [run, ids, view, platform, setSelection],
  );

  // Targets for shortcuts: the selection, else the keyboard cursor.
  const onShortcut = useCallback(
    (k: MailActionId | 'toggleStar' | 'toggleJunk' | 'find') => {
      if (k === 'find') {
        searchRef.current?.focus();
        return;
      }
      const focused = items.find((t) => t.id === selection.focusedId);
      const targets = selectedSummaries.length ? selectedSummaries : focused ? [focused] : [];
      if (!targets.length) return;
      const available = resolveActions(targets, view);
      const id =
        k === 'toggleStar'
          ? available.find((a) => a.id === 'star' || a.id === 'unstar')?.id
          : k === 'toggleJunk'
            ? available.find((a) => a.id === 'markJunk' || a.id === 'notJunk')?.id
            : k;
      const desc = available.find((a) => a.id === id);
      if (desc?.enabled)
        void perform(
          desc.id,
          targets.map((t) => t.id),
        );
    },
    [selectedSummaries, selection.focusedId, items, view, perform, searchRef],
  );
  // Native menu (desktop hosts) goes through the same handler as the keyboard shortcuts.
  const onShortcutRef = useRef(onShortcut);
  useEffect(() => {
    onShortcutRef.current = onShortcut;
  });
  useEffect(
    () =>
      platform.subscribeMenuActions((a) =>
        onShortcutRef.current(a === 'star' ? 'toggleStar' : a === 'junk' ? 'toggleJunk' : a),
      ),
    [platform],
  );
  useGlobalShortcuts({ onAction: onShortcut, onSearch: () => searchRef.current?.focus() });

  return { perform };
}
