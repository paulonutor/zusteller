import { describe, expect, it } from 'vitest';
import {
  clickRow,
  emptySelection,
  moveFocus,
  nextAfterRemoval,
  openId,
  prune,
  selectAll,
  toggleRow,
} from './selection';

const ids = ['a', 'b', 'c', 'd', 'e'];
const sel = (s: ReturnType<typeof clickRow>) => [...s.selected].sort();

describe('selection', () => {
  it('plain click opens exactly one row', () => {
    const s = clickRow(clickRow(emptySelection, ids, 'b', {}), ids, 'd', {});
    expect(sel(s)).toEqual(['d']);
    expect(openId(s)).toBe('d');
  });

  it('meta toggles, shift selects a range from the anchor', () => {
    let s = clickRow(emptySelection, ids, 'a', {});
    s = clickRow(s, ids, 'c', { meta: true });
    expect(sel(s)).toEqual(['a', 'c']);
    expect(openId(s)).toBeNull();
    s = clickRow(s, ids, 'e', { shift: true });
    expect(sel(s)).toEqual(['c', 'd', 'e']);
  });

  it('arrows move the cursor without selecting; shift extends', () => {
    let s = moveFocus(emptySelection, ids, 1, false);
    expect(s.focusedId).toBe('a');
    expect(s.selected.size).toBe(0);
    s = moveFocus(s, ids, 1, false);
    s = moveFocus(s, ids, 1, true);
    expect(sel(s)).toEqual(['b', 'c']);
    expect(moveFocus(moveFocus(emptySelection, ids, -1, false), ids, 1, false).focusedId).toBe('e');
  });

  it('clamps at the ends', () => {
    let s = moveFocus(emptySelection, ids, 1, false);
    s = moveFocus(s, ids, -1, false);
    expect(s.focusedId).toBe('a');
  });

  it('toggle and select-all', () => {
    expect(sel(toggleRow(toggleRow(emptySelection, 'a'), 'a'))).toEqual([]);
    expect(selectAll(ids, emptySelection).selected.size).toBe(5);
  });

  it('prunes rows that left the list', () => {
    const s = prune(selectAll(ids, emptySelection), ['a', 'b']);
    expect(sel(s)).toEqual(['a', 'b']);
  });

  it('picks the next surviving row after removal, else the previous', () => {
    expect(nextAfterRemoval(ids, new Set(['b', 'c']))).toBe('d');
    expect(nextAfterRemoval(ids, new Set(['d', 'e']))).toBe('c');
    expect(nextAfterRemoval(ids, new Set(ids))).toBeNull();
  });
});
