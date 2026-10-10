import { useEffect, useMemo, useState } from 'react';
import type { ID } from '@/domain/mail';
import { useThreadList } from './hooks';
import type { ListFilter } from './list/ThreadList';
import { emptySelection, openId, prune, type Selection } from './selection';
import { toQuery, type MailView } from './view';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useMailNavigation(accountId: ID | undefined) {
  const [view, setViewState] = useState<MailView>({ kind: 'mailbox', mailbox: 'inbox' });
  const [searchText, setSearchTextState] = useState('');
  const search = useDebounced(searchText, 250);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [filter, setFilterState] = useState<ListFilter>('all');

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
  // Keep an opened unread conversation visible after mark-on-open. Unstarring always removes
  // it from Starred, including during an optimistic update before the provider refetch finishes.
  const items = useMemo(() => {
    const scoped =
      view.kind === 'mailbox' && view.mailbox === 'starred'
        ? loaded.filter((t) => t.isStarred)
        : loaded;
    if (filter === 'all') return scoped;
    return scoped.filter((t) =>
      filter === 'unread' ? selection.selected.has(t.id) || !t.isRead : t.isStarred,
    );
  }, [loaded, filter, selection.selected, view]);
  const filterCounts = useMemo(
    () => ({
      unread: loaded.filter((t) => !t.isRead).length,
      starred: loaded.filter((t) => t.isStarred).length,
    }),
    [loaded],
  );
  const ids = useMemo(() => items.map((t) => t.id), [items]);
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
  return {
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
  };
}
