import { useEffect, useState } from 'react';

const LAYOUT_KEY = 'zusteller.layout';
export const PANE_LIMITS = { sidebar: [180, 320], list: [300, 640] } as const;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

function loadLayout() {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as {
      sidebar?: unknown;
      list?: unknown;
    };
    return {
      sidebar: clamp(
        typeof v.sidebar === 'number' && Number.isFinite(v.sidebar) ? v.sidebar : 220,
        PANE_LIMITS.sidebar,
      ),
      list: clamp(
        typeof v.list === 'number' && Number.isFinite(v.list) ? v.list : 410,
        PANE_LIMITS.list,
      ),
    };
  } catch {
    return { sidebar: 220, list: 410 };
  }
}

export function usePaneLayout() {
  const [layout, setLayout] = useState(loadLayout);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // Layout persistence is best effort.
    }
  }, [layout]);
  return { layout, setLayout };
}
