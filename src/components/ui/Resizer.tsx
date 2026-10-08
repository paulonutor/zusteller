import { useCallback, useRef } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (px: number) => void;
};

/** Vertical drag handle between panes; also keyboard-adjustable (arrow keys). */
export function Resizer({ label, value, min, max, onChange }: Props) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);

  return (
    // The wrapper only gives the handle a landmark (axe `region`); it generates no box.
    <div role="region" aria-label={`${label} handle`} className="contents">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        className={cn('no-drag group relative z-10 w-px shrink-0 cursor-col-resize bg-border')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          if (start.current) onChange(clamp(start.current.v + e.clientX - start.current.x));
        }}
        onPointerUp={() => (start.current = null)}
        onPointerCancel={() => (start.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 10;
          if (e.key === 'ArrowLeft') onChange(clamp(value - step));
          else if (e.key === 'ArrowRight') onChange(clamp(value + step));
          else return;
          e.preventDefault();
        }}
      >
        {/* Wider invisible hit target. */}
        <span className="absolute inset-y-0 -left-1.5 w-3 group-focus-visible:bg-accent/30" />
      </div>
    </div>
  );
}
