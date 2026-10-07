import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Inbox, RefreshCw, Search, X } from 'lucide-react';
import type { ID, Label, ThreadSummary } from '@/domain/mail';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import type { MenuItemSpec } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import type { Selection } from '../selection';
import { ThreadRow } from './ThreadRow';

type Props = {
  title: string;
  unreadCount?: number;
  items: ThreadSummary[];
  labels: Label[];
  accountEmail: string | undefined;
  selection: Selection;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hasMore: boolean;
  isFetchingMore: boolean;
  searchText: string;
  onSearchMount: (el: HTMLInputElement | null) => void;
  emptyMessage: string;
  onSearchChange: (v: string) => void;
  onFetchMore: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onClickRow: (id: ID, mods: { meta: boolean; shift: boolean }) => void;
  onToggleRow: (id: ID) => void;
  onToggleStar: (t: ThreadSummary) => void;
  onMove: (delta: 1 | -1, extend: boolean) => void;
  onOpenFocused: () => void;
  onToggleFocused: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  buildContextItems: (id: ID) => MenuItemSpec[];
  onContextOpen: (id: ID) => void;
};

function Skeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex h-[68px] gap-3 border-b border-border/70 px-3 py-3">
          <div className="skeleton size-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-2/5" />
            <div className="skeleton h-3 w-4/5" />
            <div className="skeleton h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Fetch the next page near the bottom, and keep fetching while the first pages don't fill the viewport. */
function useLoadMoreOnScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  hasMore: boolean,
  busy: boolean,
  fetchMore: () => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (el && hasMore && !busy && el.scrollHeight <= el.clientHeight) fetchMore();
  });
  return () => {
    const el = ref.current;
    if (el && hasMore && !busy && el.scrollHeight - el.scrollTop - el.clientHeight < 300)
      fetchMore();
  };
}

export function ThreadList(p: Props) {
  const { onSearchMount } = p;
  const [hasFocus, setHasFocus] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const labelsById = new Map(p.labels.map((l) => [l.id, l]));
  const allSelected = p.items.length > 0 && p.selection.selected.size === p.items.length;
  const someSelected = p.selection.selected.size > 0;

  // Keep the keyboard cursor visible.
  useEffect(() => {
    if (p.selection.focusedId)
      document.getElementById(`row-${p.selection.focusedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [p.selection.focusedId]);

  const onScroll = useLoadMoreOnScroll(scroller, p.hasMore, p.isFetchingMore, p.onFetchMore);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      p.onMove(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      p.onOpenFocused();
    } else if (e.key === ' ') {
      e.preventDefault();
      p.onToggleFocused();
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      p.onSelectAll();
    } else if (e.key === 'Escape') {
      p.onClear();
    }
  };

  return (
    <section aria-label={p.title} className="flex h-full min-w-0 flex-col bg-background">
      <header className="drag-region flex h-[52px] shrink-0 items-center gap-3 px-3">
        <div className="min-w-0 shrink-0">
          <h1 className="text-[15px] font-semibold leading-tight">{p.title}</h1>
          <p className="text-[11px] leading-tight text-muted">
            {p.unreadCount ? `${p.unreadCount} unread` : 'No unread'}
          </p>
        </div>
        <label className="no-drag relative ml-auto min-w-0 flex-1">
          <span className="sr-only">Search mail</span>
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            ref={(el) => onSearchMount(el)}
            type="search"
            value={p.searchText}
            placeholder="Search"
            onChange={(e) => p.onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                p.onSearchChange('');
                e.currentTarget.blur();
              }
            }}
            className="h-7 w-full appearance-none rounded-md bg-hover pl-7 pr-7 text-[13px] outline-none placeholder:text-muted focus:bg-background focus:ring-2 focus:ring-accent/60 [&::-webkit-search-cancel-button]:hidden"
          />
          {p.searchText && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => p.onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </label>
      </header>

      <div className="flex h-8 shrink-0 items-center gap-2 border-y border-border px-3">
        <Checkbox
          label={allSelected ? 'Deselect all' : 'Select all'}
          checked={allSelected ? true : someSelected ? 'mixed' : false}
          onChange={() => (allSelected || someSelected ? p.onClear() : p.onSelectAll())}
        />
        <Button size="sm" aria-label="Refresh" title="Refresh" onClick={p.onRefresh}>
          <RefreshCw size={13} className={cn(p.isFetching && 'animate-spin')} />
        </Button>
        <span className="ml-auto text-[12px] text-muted" aria-live="polite">
          {someSelected
            ? `${p.selection.selected.size} selected`
            : p.searchText
              ? 'Search results'
              : 'Newest first'}
        </span>
      </div>

      <div
        ref={scroller}
        role="listbox"
        aria-label={`${p.title} conversations`}
        aria-multiselectable
        aria-activedescendant={p.selection.focusedId ? `row-${p.selection.focusedId}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setHasFocus(true)}
        onBlur={() => setHasFocus(false)}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto outline-none focus-visible:outline-none"
      >
        {p.error && !p.items.length ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-muted">
            <AlertCircle size={22} />
            <p className="text-[13px]">Couldn’t load conversations.</p>
            <p className="text-[12px]">{p.error.message}</p>
            <Button variant="subtle" onClick={p.onRetry}>
              Try again
            </Button>
          </div>
        ) : p.isLoading ? (
          <Skeleton />
        ) : p.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-muted">
            <Inbox size={22} />
            <p className="text-[13px]">{p.emptyMessage}</p>
          </div>
        ) : (
          <>
            {p.error && (
              <div
                className="flex items-center gap-2 bg-red-500/10 px-3 py-1.5 text-[12px] text-danger"
                role="alert"
              >
                Couldn’t refresh. Showing earlier results.
                <button type="button" className="ml-auto underline" onClick={p.onRetry}>
                  Retry
                </button>
              </div>
            )}
            {p.items.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                accountEmail={p.accountEmail}
                labelsById={labelsById}
                selected={p.selection.selected.has(t.id)}
                focused={p.selection.focusedId === t.id}
                listHasFocus={hasFocus}
                onClick={(e) =>
                  p.onClickRow(t.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })
                }
                onToggleSelect={() => p.onToggleRow(t.id)}
                onToggleStar={() => p.onToggleStar(t)}
                buildContextItems={() => p.buildContextItems(t.id)}
                onContextOpen={() => p.onContextOpen(t.id)}
              />
            ))}
            {p.isFetchingMore && (
              <div className="py-3 text-center text-[12px] text-muted">Loading…</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
