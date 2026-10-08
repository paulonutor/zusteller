import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ThreadSummary } from '@/domain/mail';

/** Keep in sync with `row-exit` / `row-enter` in mail.css. */
export const ROW_EXIT_MS = 150;
export const ROW_ENTER_MS = 1400;

export type ListEntry = { thread: ThreadSummary; exiting: boolean; entering: boolean };

const motionAllowed = () =>
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animates list changes. Rows that leave (archived, trashed, moved, refreshed away) stay in place
 * as non-interactive "exiting" entries for one short collapse; rows that arrive among the existing
 * ones (new mail) are flagged "entering". Switching list (`resetKey`), loading, appending a next
 * page, a windowed list and reduced motion never animate.
 */
export function useListMotion(
  items: ThreadSummary[],
  resetKey: string,
  enabled: boolean,
): ListEntry[] {
  const prev = useRef<{ key: string; items: ThreadSummary[] }>({ key: resetKey, items });
  const [ghosts, setGhosts] = useState<{ thread: ThreadSummary; index: number }[]>([]);
  const [entering, setEntering] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { key: resetKey, items };
    if (before.key !== resetKey || !enabled || !motionAllowed()) {
      setGhosts((g) => (g.length ? [] : g));
      setEntering((e) => (e.size ? new Set() : e));
      return;
    }
    const was = new Set(before.items.map((t) => t.id));
    const now = new Set(items.map((t) => t.id));
    const gone = before.items
      .map((thread, index) => ({ thread, index }))
      .filter((g) => !now.has(g.thread.id));
    // Arrivals sit among (or above) the previous rows; a next page only appends after them.
    const arrived = before.items.length
      ? items.filter((t, i) => !was.has(t.id) && i < before.items.length).map((t) => t.id)
      : [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (gone.length) {
      setGhosts((g) => [...g, ...gone]);
      const ids = new Set(gone.map((g) => g.thread.id));
      timers.push(
        setTimeout(
          () => setGhosts((g) => g.filter((x) => !ids.has(x.thread.id))),
          ROW_EXIT_MS + 30,
        ),
      );
    }
    if (arrived.length) {
      setEntering((e) => new Set([...e, ...arrived]));
      timers.push(
        setTimeout(
          () => setEntering((e) => new Set([...e].filter((id) => !arrived.includes(id)))),
          ROW_ENTER_MS,
        ),
      );
    }
    // Timers are left running on purpose: a quick follow-up change must not cancel an earlier
    // row's clean-up (each one only removes its own ids).
    void timers;
  }, [items, resetKey, enabled]);

  return useMemo(() => {
    const live = new Set(items.map((t) => t.id));
    const out: ListEntry[] = items.map((thread) => ({
      thread,
      exiting: false,
      entering: entering.has(thread.id),
    }));
    // Re-insert in original order; positions are from the previous list, so insert ascending.
    for (const g of [...ghosts].sort((a, b) => a.index - b.index))
      if (!live.has(g.thread.id))
        out.splice(Math.min(g.index, out.length), 0, {
          thread: g.thread,
          exiting: true,
          entering: false,
        });
    return out;
  }, [items, ghosts, entering]);
}
