/**
 * Drag & drop flourish: the dropped rows themselves (not copies) lift out of the list, shrink into
 * the sidebar target and the target pulses once. Their slots collapse at the same time, so the rows
 * below slide up to fill the gap. Purely visual; the real move goes through the shared actions.
 */
import type { ID } from '@/domain/mail';
import type { DropTarget } from './dnd';

const FLY_MS = 320;
const MAX_FLYERS = 5;
/** Fallback if the move never removes the row (it failed): put everything back. */
const RESTORE_AFTER_MS = 1800;

const flights = new Map<ID, number>();
/** When the row's flight ends (epoch ms), or 0. The list keeps a leaving row mounted until then. */
export const flightEndsAt = (id: ID) => flights.get(id) ?? 0;

export const dropTargetKey = (t: DropTarget) =>
  t.kind === 'label' ? `label:${t.labelId}` : `mailbox:${t.mailbox}`;

const STYLED = [
  'position',
  'left',
  'top',
  'width',
  'height',
  'margin',
  'zIndex',
  'pointerEvents',
  'borderRadius',
  'boxShadow',
  'background',
] as const;

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

    // Lift the row out of the layout (fixed at its current spot) and close its slot.
    Object.assign(row.style, {
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
    });
    slot.dataset.state = 'exit';
    slot.dataset.fly = '1';

    const dx = to.left + 24 - from.left;
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const delay = i * 45;
    flights.set(id, Date.now() + delay + FLY_MS + 40);
    row.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1, transformOrigin: 'left center' },
        {
          transform: `translate(${dx * 0.6}px,${dy * 0.6}px) scale(0.45)`,
          opacity: 0.9,
          offset: 0.6,
        },
        { transform: `translate(${dx}px,${dy}px) scale(0.06)`, opacity: 0 },
      ],
      { duration: FLY_MS, delay, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'both' },
    );
    setTimeout(() => {
      flights.delete(id);
      if (!row.isConnected) return;
      row.getAnimations().forEach((a) => a.cancel());
      for (const k of STYLED) row.style[k] = '';
      delete slot.dataset.state;
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
