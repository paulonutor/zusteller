import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Label } from '@/domain/mail';
import { LabelChip } from '../LabelChip';

const chip = 'shrink-0 rounded px-1.5 text-[11px] leading-[16px]';

/**
 * "+N" badge that lists the labels that didn't fit in the row on hover. Pointer-only like the row's
 * star and checkbox (a nested control inside role=option is invalid ARIA); the labels stay reachable
 * for keyboard/AT through the label picker.
 */
export function LabelOverflow({ labels }: { labels: Label[] }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const open = () => {
    clearTimeout(timer.current);
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.right, y: r.bottom + 4 });
  };
  // Short grace period so the pointer can travel from the badge into the popover.
  const close = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPos(null), 120);
  };

  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', hide);
      document.removeEventListener('scroll', hide, true);
    };
  }, [pos]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <span
        ref={ref}
        data-label-overflow
        aria-hidden="true"
        onMouseEnter={open}
        onMouseLeave={close}
        className={`${chip} no-drag border border-border text-muted hover:bg-hover`}
      >
        +{labels.length}
      </span>
      {pos &&
        createPortal(
          <div
            data-label-popover
            role="presentation"
            onMouseEnter={open}
            onMouseLeave={close}
            style={{ position: 'fixed', top: pos.y, right: window.innerWidth - pos.x }}
            className="z-50 flex max-w-64 flex-wrap gap-1 rounded-lg border border-border bg-surface-raised/95 p-2 shadow-lg backdrop-blur-xl"
          >
            {labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
