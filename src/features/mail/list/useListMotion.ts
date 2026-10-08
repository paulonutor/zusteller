import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadSummary } from '@/domain/mail';
import { COLLAPSE_MS, flightEndsAt } from '../dropAnimation';

/** Keep in sync with the `data-state` animations in mail.css. */
export const ROW_EXIT_MS = 150;
export const ROW_ENTER_MS = 1400;

export type ListEntry = { thread: ThreadSummary; exiting: boolean; entering: boolean };
type Ghost = { thread: ThreadSummary; index: number };

const motionAllowed = () =>
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const sameIds = (a: ThreadSummary[], b: ThreadSummary[]) =>
  a.length === b.length && a.every((t, i) => t.id === b[i]!.id);

/**
 * Animates list changes. Rows that leave (archived, trashed, moved, refreshed away) stay in place
 * as non-interactive "exiting" entries for one short collapse; rows that arrive among the existing
 * ones (new mail) are flagged "entering". Changes are worked out while rendering, so a leaving
 * row's DOM element is never torn down and re-created (a drop animation may be flying it).
 *
 * `enabled` must be false while the list is loading or showing placeholder rows from the previous
 * view: the swap to the new list then never counts as arrivals or departures. Switching list
 * (`resetKey`), appending a next page, a windowed list and reduced motion never animate either.
 */
export function useListMotion(
  items: ThreadSummary[],
  resetKey: string,
  enabled: boolean,
): ListEntry[] {
  const [seen, setSeen] = useState({ key: resetKey, items, enabled });
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [entering, setEntering] = useState<string[]>([]);

  if (seen.key !== resetKey || seen.enabled !== enabled || !sameIds(seen.items, items)) {
    setSeen({ key: resetKey, items, enabled });
    if (seen.key !== resetKey || !seen.enabled || !enabled || !motionAllowed()) {
      if (ghosts.length) setGhosts([]);
      if (entering.length) setEntering([]);
    } else {
      const was = new Set(seen.items.map((t) => t.id));
      const now = new Set(items.map((t) => t.id));
      const gone = seen.items
        .map((thread, index) => ({ thread, index }))
        .filter((g) => !now.has(g.thread.id));
      // Arrivals sit among (or above) the previous rows; a next page only appends after them.
      const arrived = seen.items.length
        ? items.filter((t, i) => !was.has(t.id) && i < seen.items.length).map((t) => t.id)
        : [];
      if (gone.length) setGhosts([...ghosts, ...gone]);
      if (arrived.length) setEntering([...entering, ...arrived]);
    }
  }

  // Each ghost / arrival schedules its own clean-up once; later changes never cancel it.
  const scheduled = useRef(new Set<string>());
  useEffect(() => {
    for (const g of ghosts) {
      const k = `x:${g.thread.id}`;
      if (scheduled.current.has(k)) continue;
      scheduled.current.add(k);
      const flying = flightEndsAt(g.thread.id) > 0;
      // A flying row still needs its full (longer) gap collapse, even if the list updated late.
      const hold = flying
        ? Math.max(COLLAPSE_MS + 40, flightEndsAt(g.thread.id) - Date.now())
        : ROW_EXIT_MS + 30;
      setTimeout(() => {
        scheduled.current.delete(k);
        setGhosts((cur) => cur.filter((x) => x.thread.id !== g.thread.id));
      }, hold);
    }
    for (const id of entering) {
      const k = `e:${id}`;
      if (scheduled.current.has(k)) continue;
      scheduled.current.add(k);
      setTimeout(() => {
        scheduled.current.delete(k);
        setEntering((cur) => cur.filter((x) => x !== id));
      }, ROW_ENTER_MS);
    }
  }, [ghosts, entering]);

  return useMemo(() => {
    const live = new Set(items.map((t) => t.id));
    const enter = new Set(entering);
    const out: ListEntry[] = items.map((thread) => ({
      thread,
      exiting: false,
      entering: enter.has(thread.id),
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
