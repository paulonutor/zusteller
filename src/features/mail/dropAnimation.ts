/**
 * Drag & drop flourish: the dropped rows shrink and fly into the sidebar target, which pulses once.
 * Purely visual (WAAPI on detached clones); the real move goes through the shared action layer.
 */
import type { ID } from '@/domain/mail';
import type { DropTarget } from './dnd';

const FLY_MS = 340;
const MAX_FLYERS = 4;

export const dropTargetKey = (t: DropTarget) =>
  t.kind === 'label' ? `label:${t.labelId}` : `mailbox:${t.mailbox}`;

export function flyRowsToTarget(ids: ID[], target: DropTarget) {
  if (typeof window.matchMedia !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dest = document.querySelector<HTMLElement>(`[data-drop-target="${dropTargetKey(target)}"]`);
  if (!dest || !dest.animate) return;
  const to = dest.getBoundingClientRect();

  ids.slice(0, MAX_FLYERS).forEach((id, i) => {
    const row = document.getElementById(`row-${id}`);
    if (!row) return;
    const from = row.getBoundingClientRect();
    const clone = row.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      margin: '0',
      zIndex: '100',
      pointerEvents: 'none',
      borderRadius: '10px',
      boxShadow: '0 6px 18px rgb(0 0 0 / 0.25)',
      background: 'var(--surface-raised, var(--background))',
      transformOrigin: 'left center',
    });
    clone.setAttribute('aria-hidden', 'true');
    document.body.append(clone);
    const dx = to.left + 24 - from.left;
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const fly = clone.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        {
          transform: `translate(${dx * 0.6}px,${dy * 0.6}px) scale(0.45)`,
          opacity: 0.9,
          offset: 0.6,
        },
        { transform: `translate(${dx}px,${dy}px) scale(0.06)`, opacity: 0 },
      ],
      { duration: FLY_MS, delay: i * 45, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'both' },
    );
    fly.onfinish = () => clone.remove();
    fly.oncancel = () => clone.remove();
  });

  dest.animate(
    [
      { transform: 'scale(1)', backgroundColor: 'transparent' },
      {
        transform: 'scale(1.05)',
        backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
      },
      { transform: 'scale(1)', backgroundColor: 'transparent' },
    ],
    { duration: 320, delay: FLY_MS - 120, easing: 'ease-out' },
  );
}
