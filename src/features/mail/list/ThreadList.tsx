import { dragRegionProps } from '@/platform/hostChrome';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { AlertCircle, Inbox, ListFilter as FilterIcon, Search, X } from 'lucide-react';
import type { ID, Label, ThreadSummary } from '@/domain/mail';
import { Button } from '@/components/ui/Button';
import { DropdownMenu, type MenuItemSpec } from '@/components/ui/Menu';
import type { Selection } from '../selection';
import { ThreadRow } from './ThreadRow';
import { useListMotion } from './useListMotion';

/** Lists longer than this are windowed; shorter ones render every row as before. */
export const VIRTUALIZE_THRESHOLD = 100;
/** Selected rows are kept mounted only while there are few of them (⌘A must not mount everything). */
const MAX_PINNED_SELECTED = 20;
const DEFAULT_ROW_H = 68;

export type ListFilter = 'all' | 'unread' | 'starred';

const FILTERS: { id: ListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'starred', label: 'Starred' },
];

type Props = {
  filter: ListFilter;
  filterCounts: { unread: number; starred: number };
  onFilterChange: (f: ListFilter) => void;
  title: string;
  unreadCount?: number;
  items: ThreadSummary[];
  labels: Label[];
  accountEmail: string | undefined;
  selection: Selection;
  isLoading: boolean;
  /** Rows on screen still belong to the previous view (a new one is loading behind them). */
  isPlaceholder?: boolean;
  error: Error | null;
  hasMore: boolean;
  isFetchingMore: boolean;
  searchText: string;
  onSearchMount: (el: HTMLInputElement | null) => void;
  emptyMessage: string;
  onSearchChange: (v: string) => void;
  onFetchMore: () => void;
  onRetry: () => void;
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
  onDropLabel: (rowId: ID, labelId: ID) => void;
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

/** Extra pages fetched automatically to fill the viewport before waiting for user scroll. */
export const MAX_AUTO_PAGES = 3;

/**
 * Fetch the next page near the bottom, and keep fetching (a bounded number of pages) while the
 * first pages don't fill the viewport. Never auto-loads while an error is showing.
 */
function useLoadMoreOnScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  hasMore: boolean,
  busy: boolean,
  hasError: boolean,
  resetKey: string,
  itemsLength: number,
  fetchMore: () => void,
) {
  const auto = useRef({ key: resetKey, count: 0 });
  useEffect(() => {
    if (auto.current.key !== resetKey) auto.current = { key: resetKey, count: 0 };
    const el = ref.current;
    if (!el || !hasMore || busy || hasError) return;
    if (el.scrollHeight > el.clientHeight || auto.current.count >= MAX_AUTO_PAGES) return;
    auto.current.count++;
    fetchMore();
    // fetchMore is an inline closure; the inputs that matter are listed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, busy, hasError, resetKey, itemsLength]);
  return () => {
    const el = ref.current;
    if (el && hasMore && !busy && el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      auto.current.count = 0; // user intent: allow more auto-fill afterwards
      fetchMore();
    }
  };
}

export function ThreadList(p: Props) {
  const { onSearchMount } = p;
  const [hasFocus, setHasFocus] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const labelsById = new Map(p.labels.map((l) => [l.id, l]));
  const someSelected = p.selection.selected.size > 0;
  // 'Selection mode': avatars become checkboxes once the user explicitly multi-selects.
  // A plain click that opens one thread leaves it off.
  const [multi, setMulti] = useState(false);
  // Keyboard modality: the focus cursor only reveals row controls while keys drive the list.
  const [kbd, setKbd] = useState(false);
  // The header's select-all state and count only reflect an explicit multi-selection; merely opening
  // one thread (a single selected row) must not look like "1 selected".
  const selectionMode = someSelected && (multi || p.selection.selected.size > 1);

  const showRows = !p.isLoading && p.items.length > 0;
  const virtual = p.items.length > VIRTUALIZE_THRESHOLD;
  const rowsRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Row height comes from --row-h; real heights are then measured per row.
  const rowH = () => {
    const el = scroller.current;
    const v = el ? parseFloat(getComputedStyle(el).getPropertyValue('--row-h')) : NaN;
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_ROW_H;
  };
  const indexById = new Map(p.items.map((t, i) => [t.id, i]));
  const rangeExtractor = (range: Range) => {
    const idx = new Set(defaultRangeExtractor(range));
    // The focused row backs aria-activedescendant, so it must stay mounted.
    const f = p.selection.focusedId ? indexById.get(p.selection.focusedId) : undefined;
    if (f !== undefined) idx.add(f);
    if (p.selection.selected.size <= MAX_PINNED_SELECTED)
      for (const id of p.selection.selected) {
        const i = indexById.get(id);
        if (i !== undefined) idx.add(i);
      }
    return [...idx].sort((a, b) => a - b);
  };
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    enabled: virtual,
    count: p.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: rowH,
    overscan: 8,
    scrollMargin,
    rangeExtractor,
    getItemKey: (i) => p.items[i]?.id ?? i,
  });
  // The error banner sits above the rows inside the scroller; account for its height.
  useLayoutEffect(() => {
    if (virtual && rowsRef.current) setScrollMargin(rowsRef.current.offsetTop);
  }, [virtual, p.error, p.isLoading]);

  // Keep the keyboard cursor visible.
  useEffect(() => {
    const id = p.selection.focusedId;
    if (!id) return;
    if (virtual) {
      const i = indexById.get(id);
      if (i !== undefined) virtualizer.scrollToIndex(i, { align: 'auto' });
    } else {
      document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selection.focusedId]);

  const onScroll = useLoadMoreOnScroll(
    scroller,
    p.hasMore,
    p.isFetchingMore,
    !!p.error,
    `${p.filter}|${p.title}|${p.searchText}`,
    p.items.length,
    p.onFetchMore,
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    setKbd(true);
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      p.onMove(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      p.onOpenFocused();
    } else if (e.key === ' ') {
      e.preventDefault();
      setMulti(true);
      p.onToggleFocused();
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setMulti(true);
      p.onSelectAll();
    } else if (e.key === 'Escape') {
      p.onClear();
    }
  };

  const entries = useListMotion(
    p.items,
    `${p.filter}|${p.title}|${p.searchText}`,
    !virtual && !p.isLoading && !p.isPlaceholder,
  );

  const renderRow = (t: ThreadSummary, index?: number) => (
    <ThreadRow
      key={t.id}
      setSize={index === undefined ? undefined : p.hasMore ? -1 : p.items.length}
      posInSet={index === undefined ? undefined : index + 1}
      thread={t}
      accountEmail={p.accountEmail}
      labelsById={labelsById}
      selected={p.selection.selected.has(t.id)}
      focused={p.selection.focusedId === t.id}
      listHasFocus={hasFocus}
      onClick={(e) => {
        const mods = { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey };
        setMulti(mods.meta || mods.shift);
        p.onClickRow(t.id, mods);
      }}
      onToggleSelect={() => {
        setMulti(true);
        p.onToggleRow(t.id);
      }}
      onToggleStar={() => p.onToggleStar(t)}
      buildContextItems={() => p.buildContextItems(t.id)}
      onContextOpen={() => p.onContextOpen(t.id)}
      dragIds={() => (p.selection.selected.has(t.id) ? [...p.selection.selected] : [t.id])}
      onDropLabel={(labelId) => p.onDropLabel(t.id, labelId)}
    />
  );

  return (
    <section aria-label={p.title} className="flex h-full min-w-0 flex-col bg-background">
      <header
        {...dragRegionProps}
        className="mail-list-header drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3"
      >
        <div className="min-w-0 shrink-0">
          <h1 className="text-[15px] font-semibold leading-tight">{p.title}</h1>
          <p className="text-[11px] leading-tight text-muted" aria-live="polite">
            {selectionMode
              ? `${p.selection.selected.size} selected`
              : p.searchText
                ? 'Search results'
                : p.unreadCount
                  ? `${p.unreadCount} unread`
                  : 'No unread'}
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
            placeholder="Search mail"
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
        <DropdownMenu
          trigger={
            <Button
              aria-label={`Filter: ${FILTERS.find((f) => f.id === p.filter)!.label}`}
              title="Filter"
              active={p.filter !== 'all'}
            >
              <FilterIcon size={15} />
            </Button>
          }
          items={FILTERS.map(({ id, label }) => {
            const n = id === 'all' ? 0 : p.filterCounts[id];
            return {
              kind: 'check',
              label: n > 0 ? `${label} (${n})` : label,
              state: p.filter === id ? 'all' : 'none',
              onSelect: () => p.onFilterChange(id),
            } satisfies MenuItemSpec;
          })}
        />
      </header>

      <div
        ref={scroller}
        id="thread-list"
        data-list-scroller
        // A listbox needs options; empty / loading / error states are plain regions.
        role={showRows ? 'listbox' : 'region'}
        aria-label={`${p.title} conversations`}
        aria-multiselectable={showRows || undefined}
        aria-busy={p.isLoading || undefined}
        data-selection-mode={selectionMode}
        data-kbd={kbd}
        onPointerDown={() => setKbd(false)}
        aria-activedescendant={
          showRows && p.selection.focusedId ? `row-${p.selection.focusedId}` : undefined
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setHasFocus(true)}
        onBlur={() => setHasFocus(false)}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none focus-visible:outline-none"
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
          <>
            <p role="status" className="sr-only">
              Loading conversations
            </p>
            <Skeleton />
          </>
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
            {virtual ? (
              <div
                ref={rowsRef}
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((v) => {
                  const t = p.items[v.index];
                  if (!t) return null;
                  return (
                    <div
                      key={v.key}
                      role="presentation"
                      data-index={v.index}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${v.start - scrollMargin}px)` }}
                    >
                      {renderRow(t, v.index)}
                    </div>
                  );
                })}
              </div>
            ) : (
              entries.map((e) => (
                // Every row lives in a slot that can collapse (leaving) or expand (arriving) without
                // the row element ever being re-created, so no state resets when an animation ends.
                <div
                  key={e.thread.id}
                  role="presentation"
                  data-row-slot
                  data-state={e.exiting ? 'exit' : e.entering ? 'enter' : undefined}
                  aria-hidden={e.exiting || undefined}
                  inert={e.exiting || undefined}
                >
                  <div data-row-clip>{renderRow(e.thread)}</div>
                </div>
              ))
            )}
            {p.isFetchingMore && (
              <div className="py-3 text-center text-[12px] text-muted">Loading…</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
