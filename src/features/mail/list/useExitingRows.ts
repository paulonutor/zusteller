import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ThreadSummary } from '@/domain/mail';

/** Keep in sync with `row-exit` in mail.css. */
export const ROW_EXIT_MS = 220;

export type ListEntry = { thread: ThreadSummary; exiting: boolean };

const motionAllowed = () =>
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Rows that leave the list (archived, trashed, moved, filtered out by a refresh) stay in place for
 * one short exit animation as non-interactive "exiting" entries. Switching list (`resetKey`) or
 * loading never animates, and neither does a windowed list.
 */
export function useExitingRows(
  items: ThreadSummary[],
  resetKey: string,
  enabled: boolean,
): ListEntry[] {
  const prev = useRef<{ key: string; items: ThreadSummary[] }>({ key: resetKey, items });
  const [ghosts, setGhosts] = useState<{ thread: ThreadSummary; index: number }[]>([]);

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { key: resetKey, items };
    if (before.key !== resetKey || !enabled || !motionAllowed()) {
      setGhosts((g) => (g.length ? [] : g));
      return;
    }
    const now = new Set(items.map((t) => t.id));
    const gone = before.items
      .map((thread, index) => ({ thread, index }))
      .filter((g) => !now.has(g.thread.id));
    if (!gone.length) return;
    setGhosts((g) => [...g, ...gone]);
    const ids = new Set(gone.map((g) => g.thread.id));
    const timer = setTimeout(
      () => setGhosts((g) => g.filter((x) => !ids.has(x.thread.id))),
      ROW_EXIT_MS + 30,
    );
    return () => clearTimeout(timer);
  }, [items, resetKey, enabled]);

  return useMemo(() => {
    const live = new Set(items.map((t) => t.id));
    const out: ListEntry[] = items.map((thread) => ({ thread, exiting: false }));
    // Re-insert in original order; positions are from the previous list, so insert ascending.
    for (const g of [...ghosts].sort((a, b) => a.index - b.index))
      if (!live.has(g.thread.id))
        out.splice(Math.min(g.index, out.length), 0, { thread: g.thread, exiting: true });
    return out;
  }, [items, ghosts]);
}
