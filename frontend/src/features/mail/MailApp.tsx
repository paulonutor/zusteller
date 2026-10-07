import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAILBOXES, type ID, type ThreadSummary } from '@/domain/mail';
import { useServices } from '@/app/services';
import { Resizer } from '@/components/ui/Resizer';
import { resolveActions, type MailActionId } from './actions';
import { useAccounts, useCounts, useLabels, useThread, useThreadList } from './hooks';
import { ThreadList, type ListFilter } from './list/ThreadList';
import { Reader } from './reader/Reader';
import { Sidebar } from './sidebar/Sidebar';
import {
  clickRow,
  emptySelection,
  moveFocus,
  nextAfterRemoval,
  openId,
  prune,
  selectAll,
  toggleRow,
  type Selection,
} from './selection';
import { useGlobalShortcuts } from './shortcuts';
import { buildThreadActions, type Perform } from './useThreadActions';
import { useMailActions } from './useMailActions';
import { toQuery, type MailView } from './view';

const LAYOUT_KEY = 'zusteller.layout';
const LIMITS = { sidebar: [180, 320], list: [300, 640] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

function loadLayout() {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as {
      sidebar?: number;
      list?: number;
    };
    return {
      sidebar: clamp(v.sidebar ?? 220, LIMITS.sidebar),
      list: clamp(v.list ?? 410, LIMITS.list),
    };
  } catch {
    return { sidebar: 220, list: 410 };
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const EMPTY: Record<string, string> = {
  inbox: 'Your inbox is empty.',
  starred: 'No starred conversations.',
  sent: 'No sent mail.',
  trash: 'Trash is empty.',
  all: 'No mail.',
};

export function MailApp() {
  const { platform } = useServices();
  const accounts = useAccounts();
  const account = accounts.data?.[0];
  const accountId = account?.id;
  const labelsQ = useLabels(accountId);
  const labels = useMemo(() => labelsQ.data ?? [], [labelsQ.data]);
  const counts = useCounts(accountId);

  const [view, setViewState] = useState<MailView>({ kind: 'mailbox', mailbox: 'inbox' });
  const [searchText, setSearchTextState] = useState('');
  const search = useDebounced(searchText, 250);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [filter, setFilterState] = useState<ListFilter>('all');
  const [layout, setLayout] = useState(loadLayout);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // A different view or search shows different rows, so the old selection is meaningless.
  const setView = (v: MailView) => {
    setViewState(v);
    setSelection(emptySelection);
  };
  const setFilter = (f: ListFilter) => {
    setFilterState(f);
    setSelection(emptySelection);
  };
  const setSearchText = (t: string) => {
    setSearchTextState(t);
    setSelection(emptySelection);
  };

  const query = accountId ? toQuery(accountId, view, search) : undefined;
  const list = useThreadList(query);
  const loaded = list.items;
  // Client-side tab filter over the loaded rows. Selected rows stay visible so that opening an
  // unread thread (which marks it read) or unstarring doesn't make the open conversation vanish.
  const items = useMemo(
    () =>
      filter === 'all'
        ? loaded
        : loaded.filter(
            (t) => selection.selected.has(t.id) || (filter === 'unread' ? !t.isRead : t.isStarred),
          ),
    [loaded, filter, selection.selected],
  );
  const filterCounts = useMemo(
    () => ({
      unread: loaded.filter((t) => !t.isRead).length,
      starred: loaded.filter((t) => t.isStarred).length,
    }),
    [loaded],
  );
  const ids = useMemo(() => items.map((t) => t.id), [items]);
  const { run, refresh } = useMailActions(accountId);

  // Persist layout (best effort).
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }, [layout]);

  // Drop rows that left the list (archived, trashed, filtered out) once fresh data is in.
  useEffect(() => {
    // Syncing selection with server-driven list contents is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!list.isPlaceholderData && !list.isFetching) setSelection((s) => prune(s, ids));
  }, [ids, list.isPlaceholderData, list.isFetching]);

  const selectedSummaries = useMemo(
    () => items.filter((t) => selection.selected.has(t.id)),
    [items, selection.selected],
  );
  const open = openId(selection);
  const thread = useThread(accountId, open);

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
      const removes = action === 'archive' || action === 'trash' || action === 'restore';
      const next = removes ? nextAfterRemoval(ids, new Set(targetIds)) : null;
      const ok = await run(action, targetIds, opts);
      if (ok && removes) {
        setSelection({ selected: new Set(), focusedId: next, anchorId: next });
      }
    },
    [run, ids],
  );

  // Targets for shortcuts: the selection, else the keyboard cursor.
  const shortcutTargets = (): ThreadSummary[] => {
    if (selectedSummaries.length) return selectedSummaries;
    const f = items.find((t) => t.id === selection.focusedId);
    return f ? [f] : [];
  };
  const onShortcut = useCallback(
    (k: MailActionId | 'toggleStar') => {
      const targets = shortcutTargets();
      if (!targets.length) return;
      const available = resolveActions(targets, view);
      const id =
        k === 'toggleStar' ? available.find((a) => a.id === 'star' || a.id === 'unstar')?.id : k;
      const desc = available.find((a) => a.id === id);
      if (desc?.enabled)
        void perform(
          desc.id,
          targets.map((t) => t.id),
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSummaries, selection.focusedId, items, view, perform],
  );
  useGlobalShortcuts({ onAction: onShortcut, onSearch: () => searchRef.current?.focus() });

  const unread =
    view.kind === 'mailbox'
      ? counts.data?.mailboxes[view.mailbox]
      : counts.data?.labels[view.labelId];
  useEffect(() => {
    void platform.setBadge(counts.data?.mailboxes.inbox || undefined);
  }, [counts.data?.mailboxes.inbox, platform]);

  const title =
    view.kind === 'mailbox'
      ? MAILBOXES.find((m) => m.id === view.mailbox)!.name
      : (labels.find((l) => l.id === view.labelId)?.name ?? 'Label');

  const buildContextItems = (id: ID) => {
    const targets = selection.selected.has(id)
      ? selectedSummaries
      : items.filter((t) => t.id === id);
    return buildThreadActions(targets, view, labels, perform).contextItems;
  };

  const openLink = useCallback(
    (url: string) => void platform.openExternal(url).catch(() => undefined),
    [platform],
  );

  return (
    <div data-shell className="flex h-full min-w-0 overflow-hidden">
      <div data-pane="sidebar" style={{ width: layout.sidebar }} className="h-full shrink-0">
        <Sidebar
          account={account}
          labels={labels}
          counts={counts.data}
          view={view}
          onSelectView={setView}
        />
      </div>
      <Resizer
        label="Resize sidebar"
        value={layout.sidebar}
        min={LIMITS.sidebar[0]}
        max={LIMITS.sidebar[1]}
        onChange={(sidebar) => setLayout((l) => ({ ...l, sidebar }))}
      />
      <div data-pane="list" style={{ width: layout.list }} className="h-full shrink-0">
        <ThreadList
          title={title}
          unreadCount={unread}
          items={items}
          labels={labels}
          accountEmail={account?.email}
          selection={selection}
          isLoading={!query || (list.isPending && !list.data)}
          isFetching={list.isFetching}
          error={list.error}
          hasMore={!!list.hasNextPage}
          isFetchingMore={list.isFetchingNextPage}
          searchText={searchText}
          onSearchMount={(el) => void (searchRef.current = el)}
          filter={filter}
          filterCounts={filterCounts}
          onFilterChange={setFilter}
          emptyMessage={
            search
              ? `No results for “${search}”.`
              : filter === 'unread'
                ? 'No unread conversations here.'
                : filter === 'starred'
                  ? 'No starred conversations here.'
                  : (EMPTY[view.kind === 'mailbox' ? view.mailbox : ''] ??
                    'No conversations with this label.')
          }
          onSearchChange={setSearchText}
          onFetchMore={() => void list.fetchNextPage()}
          onRetry={() => void list.refetch()}
          onRefresh={() => void refresh()}
          onClickRow={(id, mods) => setSelection((s) => clickRow(s, ids, id, mods))}
          onToggleRow={(id) => setSelection((s) => toggleRow(s, id))}
          onToggleStar={(t) => void perform(t.isStarred ? 'unstar' : 'star', [t.id])}
          onMove={(d, extend) => setSelection((s) => moveFocus(s, ids, d, extend))}
          onOpenFocused={() =>
            setSelection((s) => (s.focusedId ? clickRow(s, ids, s.focusedId, {}) : s))
          }
          onToggleFocused={() => setSelection((s) => (s.focusedId ? toggleRow(s, s.focusedId) : s))}
          onSelectAll={() => setSelection((s) => selectAll(ids, s))}
          onClear={() => setSelection((s) => ({ ...s, selected: new Set(), anchorId: null }))}
          buildContextItems={buildContextItems}
          onContextOpen={(id) =>
            setSelection((s) => (s.selected.has(id) ? s : clickRow(s, ids, id, {})))
          }
        />
      </div>
      <Resizer
        label="Resize conversation list"
        value={layout.list}
        min={LIMITS.list[0]}
        max={LIMITS.list[1]}
        onChange={(list) => setLayout((l) => ({ ...l, list }))}
      />
      <div data-pane="reader" className="h-full min-w-[320px] flex-1">
        <Reader
          selected={selectedSummaries}
          thread={thread.data}
          isLoading={thread.isLoading}
          error={thread.error}
          onRetry={() => void thread.refetch()}
          view={view}
          labels={labels}
          perform={perform}
          onOpenLink={openLink}
        />
      </div>
    </div>
  );
}
