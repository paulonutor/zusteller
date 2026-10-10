/**
 * Drag & drop flourish: a copy of each dropped row shrinks into the sidebar target (the real row is
 * invisible meanwhile) and the target pulses once. The row's slot collapses at the same time, so
 * the rows below slide up to fill the gap instead of jumping. Purely visual; the real move goes through the shared actions.
 */
import type { ID } from '@/domain/mail';
import type { DropTarget } from './dnd';

const FLY_MS = 320;
/** Keep in sync with `slot-collapse` in mail.css. */
export const COLLAPSE_MS = 280;
/** The gap starts closing this far into the flight, while the copy is still leaving. */
const GAP_START = 0.3;
const MAX_FLYERS = 5;
const flights = new Map<ID, { endsAt: number }>();
/** When the row's flight ends (epoch ms), or 0. The list keeps a leaving row mounted until then. */
export const flightEndsAt = (id: ID) => flights.get(id)?.endsAt ?? 0;

export const dropTargetKey = (t: DropTarget) =>
  t.kind === 'label' ? `label:${t.labelId}` : `mailbox:${t.mailbox}`;

export function flyRowsToTarget(ids: ID[], target: DropTarget) {
  if (typeof window.matchMedia !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dest = document.querySelector<HTMLElement>(`[data-drop-target="${dropTargetKey(target)}"]`);
  if (!dest || !dest.animate) return;
  const to = dest.getBoundingClientRect();

  const finish: ((success: boolean) => void)[] = [];
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
    // The gap stays open at first; `go` (a third into the flight) lets the slot collapse.
    slot.dataset.fly = 'wait';

    const dx = to.left + 24 - from.left;
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const delay = i * 45;
    const flight = { endsAt: Date.now() + delay + FLY_MS * GAP_START + COLLAPSE_MS + 60 };
    flights.set(id, flight);
    // Close the gap on our own clock, not when the server round trip finishes.
    setTimeout(
      () => {
        if (!slot.isConnected || !slot.dataset.fly) return;
        slot.dataset.state = 'exit';
        slot.dataset.fly = 'go';
      },
      delay + FLY_MS * GAP_START,
    );
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
    };
    // Success keeps the source collapsed until query data removes it. Failure restores it
    // immediately, even if the service settles before the gap animation starts.
    finish.push((success) => {
      if (flights.get(id) !== flight) return;
      const forget = () => {
        if (flights.get(id) === flight) flights.delete(id);
      };
      if (success) {
        setTimeout(forget, Math.max(0, flight.endsAt - Date.now()));
        return;
      }
      forget();
      fly.cancel();
      row.style.opacity = '';
      delete slot.dataset.state;
      delete slot.dataset.fly;
    });
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
  return (success: boolean) => finish.forEach((settle) => settle(success));
}
