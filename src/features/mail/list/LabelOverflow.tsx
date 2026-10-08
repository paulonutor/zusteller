import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Label } from '@/domain/mail';
import { labelChipStyle } from '../format';

const chip = 'shrink-0 truncate rounded px-1.5 text-[11px] leading-[16px]';

/**
 * "+N" badge that lists the labels that didn't fit in the row. Pointer-only like the row's star and
 * checkbox (a nested control inside role=option is invalid ARIA); the labels stay reachable for
 * keyboard/AT through the label picker, and the hidden ones are named in the title.
 */
export function LabelOverflow({ labels }: { labels: Label[] }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('[data-label-popover]')) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [pos]);

  return (
    <>
      <span
        ref={ref}
        data-label-overflow
        aria-hidden="true"
        title={labels.map((l) => l.name).join(', ')}
        onClick={(e) => {
          e.stopPropagation();
          const r = ref.current?.getBoundingClientRect();
          setPos(pos || !r ? null : { x: r.right, y: r.bottom + 4 });
        }}
        onContextMenu={(e) => e.stopPropagation()}
        className={`${chip} no-drag border border-border text-muted hover:bg-hover`}
      >
        +{labels.length}
      </span>
      {pos &&
        createPortal(
          <div
            data-label-popover
            role="presentation"
            style={{ position: 'fixed', top: pos.y, right: window.innerWidth - pos.x }}
            className="z-50 flex max-w-64 flex-wrap gap-1 rounded-lg border border-border bg-surface-raised/95 p-2 shadow-lg backdrop-blur-xl"
          >
            {labels.map((l) => (
              <span key={l.id} className={chip} style={labelChipStyle(l.color)}>
                {l.name}
              </span>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
