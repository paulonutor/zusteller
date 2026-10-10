import { dragRegionProps } from '@/platform/hostChrome';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MAILBOXES, type ID } from '@/domain/mail';
import { useServices } from '@/app/services';
import { Resizer } from '@/components/ui/Resizer';
import { flyRowsToTarget } from './dropAnimation';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAccounts, useCounts, useLabels, useThread } from './hooks';
import { ThreadList } from './list/ThreadList';
import { Reader } from './reader/Reader';
import { Sidebar } from './sidebar/Sidebar';
import { clickRow, moveFocus, selectAll, toggleRow } from './selection';
import { buildThreadActions } from './useThreadActions';
import { useMailCommands } from './useMailCommands';
import { useMailNavigation } from './useMailNavigation';
import { PANE_LIMITS, usePaneLayout } from './usePaneLayout';
import { planThreadDrop, type DropTarget } from './dnd';
import { useToast } from '@/app/toast';
import { prepareExternalUrl } from './links';

const EMPTY: Record<string, string> = {
  inbox: 'Your inbox is empty.',
  starred: 'No starred conversations.',
  sent: 'No sent mail.',
  junk: 'No junk mail.',
  trash: 'Trash is empty.',
  all: 'No mail.',
};

export function MailApp() {
  const { platform } = useServices();
  const toast = useToast();
  const accounts = useAccounts();
  const account = accounts.data?.[0];
  const accountId = account?.id;
  const labelsQ = useLabels(accountId);
  const labels = useMemo(() => labelsQ.data ?? [], [labelsQ.data]);
  const counts = useCounts(accountId);

  const navigation = useMailNavigation(accountId);
  const {
    view,
    setView,
    searchText,
    search,
    setSearchText,
    filter,
    setFilter,
    query,
    list,
    items,
    ids,
    filterCounts,
    selection,
    setSelection,
    selectedSummaries,
    open,
  } = navigation;
  const { layout, setLayout } = usePaneLayout();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const thread = useThread(accountId, open);
  const { perform } = useMailCommands({ ...navigation, accountId, searchRef });

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

  // Drag & drop. Validity and the plan come from one pure function so the highlight and the drop
  // can't disagree; the mutation goes through the same `perform` as toolbar and shortcuts.
  const byId = (dragged: ID[]) => items.filter((t) => dragged.includes(t.id));
  const canDropThreads = (target: DropTarget, dragged: ID[]) =>
    planThreadDrop(target, byId(dragged), false) !== null;
  const dropThreads = async (target: DropTarget, dragged: ID[], copy: boolean) => {
    const plan = planThreadDrop(target, byId(dragged), copy);
    if (!plan) return;
    if (!copy) flyRowsToTarget(dragged, target);
    const success = await perform(plan.action, dragged, { labelId: plan.labelId });
    if (success && target.kind === 'label') {
      const name = labels.find((l) => l.id === target.labelId)?.name ?? 'label';
      const n = `${dragged.length} conversation${dragged.length === 1 ? '' : 's'}`;
      toast.show(copy ? `Added “${name}” to ${n}` : `Moved ${n} to “${name}”`);
    }
  };
  const dropLabel = (rowId: ID, labelId: ID) => {
    const targets = selection.selected.has(rowId) ? [...selection.selected] : [rowId];
    void perform('addLabel', targets, { labelId });
  };

  const openLink = useCallback(
    (url: string) => void platform.openExternal(prepareExternalUrl(url)).catch(() => undefined),
    [platform],
  );

  // Without an account nothing else can load; say so instead of showing skeletons forever.
  if (accounts.isError && !account) {
    return (
      <main
        data-shell
        {...dragRegionProps}
        className="flex h-full items-center justify-center bg-background"
      >
        <div role="alert" className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
          <WifiOff size={26} className="text-muted" aria-hidden />
          <h1 className="text-[15px] font-semibold">Can’t load your mail</h1>
          <p className="text-[13px] text-muted">{accounts.error.message}</p>
          <Button variant="subtle" onClick={() => void accounts.refetch()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div data-shell {...dragRegionProps} className="flex h-full min-w-0 overflow-hidden">
      <div data-pane="sidebar" style={{ width: layout.sidebar }} className="h-full shrink-0">
        <Sidebar
          account={account}
          labels={labels}
          counts={counts.data}
          view={view}
          onSelectView={setView}
          canDropThreads={canDropThreads}
          onDropThreads={(...args) => void dropThreads(...args)}
        />
      </div>
      <Resizer
        label="Resize sidebar"
        value={layout.sidebar}
        min={PANE_LIMITS.sidebar[0]}
        max={PANE_LIMITS.sidebar[1]}
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
          isPlaceholder={list.isPlaceholderData}
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
          onDropLabel={dropLabel}
          onContextOpen={(id) =>
            setSelection((s) => (s.selected.has(id) ? s : clickRow(s, ids, id, {})))
          }
        />
      </div>
      <Resizer
        label="Resize conversation list"
        value={layout.list}
        min={PANE_LIMITS.list[0]}
        max={PANE_LIMITS.list[1]}
        onChange={(list) => setLayout((l) => ({ ...l, list }))}
      />
      <main data-pane="reader" className="h-full min-w-[320px] flex-1">
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
      </main>
    </div>
  );
}
