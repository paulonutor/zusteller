/**
 * Drag & drop flourish: a copy of each dropped row shrinks into the sidebar target (the real row is
 * invisible meanwhile) and the target pulses once. The row's slot collapses at the same time, so
 * the rows below slide up to fill the gap instead of jumping. Purely visual; the real move goes through the shared actions.
 */
import type { ID } from '@/domain/mail';
import type { DropTarget } from './dnd';

const FLY_MS = 320;
/** Keep in sync with `slot-collapse` in mail.css. */
const COLLAPSE_MS = 220;
const MAX_FLYERS = 5;
/** Fallback if the move never removes the row (it failed): put everything back. */
const RESTORE_AFTER_MS = 1800;

const flights = new Map<ID, number>();
/** When the row's flight ends (epoch ms), or 0. The list keeps a leaving row mounted until then. */
export const flightEndsAt = (id: ID) => flights.get(id) ?? 0;

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
    const slot = row?.closest<HTMLElement>('[data-row-slot]');
    if (!row || !slot) return;
    const from = row.getBoundingClientRect();

    // A copy of the row flies; the real one is invisible meanwhile and its slot closes smoothly.
    const clone = row.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    clone.setAttribute('aria-hidden', 'true');
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
      background: 'var(--background)',
      transformOrigin: 'left center',
    });
    document.body.append(clone);
    row.style.opacity = '0';
    // The gap stays open while the copy flies; `go` (set when it lands) lets the slot collapse.
    slot.dataset.fly = 'wait';

    const dx = to.left + 24 - from.left;
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const delay = i * 45;
    flights.set(id, Date.now() + delay + FLY_MS + COLLAPSE_MS + 60);
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
      { duration: FLY_MS, delay, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'both' },
    );
    fly.onfinish = fly.oncancel = () => {
      clone.remove();
      if (slot.isConnected) slot.dataset.fly = 'go';
    };
    // If the move never removes the row (it failed), put it back.
    setTimeout(() => {
      flights.delete(id);
      if (!row.isConnected) return;
      row.style.opacity = '';
      delete slot.dataset.fly;
    }, RESTORE_AFTER_MS);
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
