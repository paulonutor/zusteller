import type { ID } from '@/domain/mail';

/**
 * List selection model (pure, unit-tested).
 *  - `focusedId` is the keyboard cursor; `selected` is the set of chosen rows.
 *  - Exactly one selected row is "open" in the reader.
 */
export type Selection = { selected: ReadonlySet<ID>; focusedId: ID | null; anchorId: ID | null };

export const emptySelection: Selection = { selected: new Set(), focusedId: null, anchorId: null };

const only = (id: ID): Selection => ({ selected: new Set([id]), focusedId: id, anchorId: id });

function range(ids: ID[], a: ID, b: ID): ID[] {
  const i = ids.indexOf(a);
  const j = ids.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Row click. meta/ctrl toggles, shift extends from the anchor, plain click opens one. */
export function clickRow(
  s: Selection,
  ids: ID[],
  id: ID,
  mods: { meta?: boolean; shift?: boolean },
): Selection {
  if (mods.shift && s.anchorId) {
    return { selected: new Set(range(ids, s.anchorId, id)), focusedId: id, anchorId: s.anchorId };
  }
  if (mods.meta) return toggleRow(s, id);
  return only(id);
}

/** Checkbox / Space: toggle membership without disturbing the rest. */
export function toggleRow(s: Selection, id: ID): Selection {
  const selected = new Set(s.selected);
  if (!selected.delete(id)) selected.add(id);
  return { selected, focusedId: id, anchorId: id };
}

/** Arrow keys move the cursor; with shift they extend the selection from the anchor. */
export function moveFocus(s: Selection, ids: ID[], delta: 1 | -1, extend: boolean): Selection {
  if (ids.length === 0) return s;
  const cur = s.focusedId ? ids.indexOf(s.focusedId) : -1;
  const next =
    ids[
      Math.max(
        0,
        Math.min(ids.length - 1, cur < 0 ? (delta > 0 ? 0 : ids.length - 1) : cur + delta),
      )
    ]!;
  if (!extend) return { ...s, focusedId: next };
  const anchor = s.anchorId ?? s.focusedId ?? next;
  return { selected: new Set(range(ids, anchor, next)), focusedId: next, anchorId: anchor };
}

export const selectAll = (ids: ID[], s: Selection): Selection => ({
  selected: new Set(ids),
  focusedId: s.focusedId ?? ids[0] ?? null,
  anchorId: s.anchorId ?? ids[0] ?? null,
});

/** Drop ids that left the list (archived, trashed, filtered out). */
export function prune(s: Selection, ids: ID[]): Selection {
  const present = new Set(ids);
  const selected = new Set([...s.selected].filter((id) => present.has(id)));
  const focusedId = s.focusedId && present.has(s.focusedId) ? s.focusedId : null;
  if (selected.size === s.selected.size && focusedId === s.focusedId) return s;
  return {
    selected,
    focusedId,
    anchorId: s.anchorId && present.has(s.anchorId) ? s.anchorId : focusedId,
  };
}

/** After removing `removed` rows, pick the row that should take focus (the next surviving one). */
export function nextAfterRemoval(ids: ID[], removed: ReadonlySet<ID>): ID | null {
  const first = ids.findIndex((id) => removed.has(id));
  if (first < 0) return null;
  return (
    ids.slice(first).find((id) => !removed.has(id)) ??
    [...ids]
      .slice(0, first)
      .reverse()
      .find((id) => !removed.has(id)) ??
    null
  );
}

export const openId = (s: Selection): ID | null =>
  s.selected.size === 1 ? [...s.selected][0]! : null;
