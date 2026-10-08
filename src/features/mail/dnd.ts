import { useRef, useState, useSyncExternalStore, type DragEvent, type HTMLAttributes } from 'react';
import {
  SYSTEM_LABEL,
  type ID,
  type Label,
  type SystemMailbox,
  type ThreadSummary,
} from '@/domain/mail';
import type { PerformAction } from './actions';

/**
 * Native HTML5 drag & drop. Two things can be dragged: conversations (rows) onto sidebar targets,
 * and a sidebar label onto conversations. `dragover` cannot read `dataTransfer` data, so what is
 * being dragged lives in a tiny module-level session; the custom MIME types only mark the drag as
 * ours (and give WebKit data to start a drag with).
 */
export type DragSession = { kind: 'threads'; ids: ID[] } | { kind: 'label'; labelId: ID } | null;
type Live<K extends NonNullable<DragSession>['kind']> = Extract<DragSession, { kind: K }>;

const THREADS_MIME = 'application/x-zusteller-threads';
const LABEL_MIME = 'application/x-zusteller-label';

let session: DragSession = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function endDrag() {
  if (session === null) return;
  session = null;
  emit();
}
const useDragSession = () =>
  useSyncExternalStore(
    subscribe,
    () => session,
    () => null,
  );

// The source row may unmount (it was moved away) before its own `dragend` fires, and Escape never
// reaches a drop target, so the session is also closed at the window.
if (typeof window !== 'undefined') {
  window.addEventListener('dragend', endDrag);
  window.addEventListener('drop', endDrag);
}

const GHOST_PAD = 16;

/** Hands a detached element to the browser as the drag image; it only needs to exist for a tick. */
function showDragImage(e: DragEvent, el: HTMLElement, x: number, y: number) {
  document.body.append(el);
  e.dataTransfer.setDragImage?.(el, x, y);
  setTimeout(() => el.remove(), 0);
}

/** Label chip: colour dot + name. */
function labelGhost(e: DragEvent, label: Label) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-chip';
  const dot = document.createElement('span');
  dot.className = 'drag-chip-dot';
  dot.style.background = label.color ?? 'var(--muted)';
  ghost.append(dot, label.name);
  showDragImage(e, ghost, 14, 16);
}

/**
 * The grabbed row itself, lifted off the list. Several conversations show as a small pile of
 * tilted cards behind it with the total in a badge. The image is anchored so the card sits
 * exactly where the row was grabbed.
 */
function threadGhost(e: DragEvent, count: number) {
  const row = e.currentTarget as HTMLElement;
  const rect = row.getBoundingClientRect();
  const w = Math.min(rect.width, 420);
  const h = rect.height;

  const ghost = document.createElement('div');
  ghost.className = 'drag-stack';
  ghost.style.width = `${w + GHOST_PAD * 2}px`;
  ghost.style.height = `${h + GHOST_PAD * 2}px`;

  const card = (el: HTMLElement) => {
    el.classList.add('drag-card');
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    ghost.append(el);
    return el;
  };
  // Back to front, so the grabbed row ends up on top.
  const tilts = count > 2 ? [4, 2] : count > 1 ? [2] : [];
  for (const deg of tilts)
    card(document.createElement('div')).style.transform = `rotate(${deg}deg)`;

  const front = row.cloneNode(true) as HTMLElement;
  for (const n of [front, ...front.querySelectorAll<HTMLElement>('[id]')]) n.removeAttribute('id');
  front.removeAttribute('data-drop');
  front.style.outline = 'none';
  card(front);

  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'drag-badge';
    badge.textContent = String(count);
    ghost.append(badge);
  }
  showDragImage(
    e,
    ghost,
    Math.min(e.clientX - rect.left, w) + GHOST_PAD,
    e.clientY - rect.top + GHOST_PAD,
  );
}

export function beginThreadDrag(e: DragEvent, ids: ID[]) {
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData(THREADS_MIME, JSON.stringify(ids));
  threadGhost(e, ids.length);
  session = { kind: 'threads', ids };
  emit();
}

export function beginLabelDrag(e: DragEvent, label: Label) {
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(LABEL_MIME, label.id);
  labelGhost(e, label);
  session = { kind: 'label', labelId: label.id };
  emit();
}

export type DropTarget =
  { kind: 'mailbox'; mailbox: SystemMailbox } | { kind: 'label'; labelId: ID };
export type ThreadDropPlan = { action: PerformAction; labelId?: ID };

const has = (t: ThreadSummary, id: ID) => t.labelIds.includes(id);

/**
 * What dropping `threads` on `target` does, or null when it would change nothing (the target then
 * refuses the drop). `copy` (Option held) only matters for labels: add the label, keep Inbox.
 */
export function planThreadDrop(
  target: DropTarget,
  threads: ThreadSummary[],
  copy: boolean,
): ThreadDropPlan | null {
  if (threads.length === 0) return null;
  if (target.kind === 'label') {
    const lacks = threads.some((t) => !has(t, target.labelId));
    if (copy) return lacks ? { action: 'addLabel', labelId: target.labelId } : null;
    const inInbox = threads.some((t) => has(t, SYSTEM_LABEL.inbox));
    return lacks || inInbox ? { action: 'moveToLabel', labelId: target.labelId } : null;
  }
  switch (target.mailbox) {
    case 'inbox':
      return threads.some((t) => !has(t, SYSTEM_LABEL.inbox)) ? { action: 'restore' } : null;
    case 'all':
      return threads.some((t) => has(t, SYSTEM_LABEL.inbox)) ? { action: 'archive' } : null;
    case 'trash':
      return threads.some((t) => !has(t, SYSTEM_LABEL.trash)) ? { action: 'trash' } : null;
    case 'starred':
      return threads.some((t) => !t.isStarred) ? { action: 'star' } : null;
    default:
      return null;
  }
}

/** Option held? `altKey` where the engine provides it, else the effect it narrowed the drag to. */
const wantsCopy = (e: DragEvent) =>
  e.altKey || e.dataTransfer.effectAllowed === 'copy' || e.dataTransfer.dropEffect === 'copy';

export type DropState = 'idle' | 'valid' | 'invalid' | 'over';

/**
 * Makes an element accept drags of kind `accepts`. `props` go on the element; `state` is for
 * styling (`idle` outside a matching drag; `invalid` targets get no drop cursor).
 */
export function useDropZone<K extends NonNullable<DragSession>['kind']>(
  accepts: K,
  opts: {
    canDrop: (s: Live<K>) => boolean;
    onDrop: (s: Live<K>, mods: { copy: boolean }) => void;
    /**
     * Forces the drop effect. Leave it out to follow the modifier keys (Option = copy).
     */
    effect?: (e: DragEvent) => 'move' | 'copy' | undefined;
  },
): { props: HTMLAttributes<HTMLElement>; state: DropState } {
  const s = useDragSession();
  // `overFor` is keyed to a session object, so a drag that ended without leaving can't stick.
  const [overFor, setOverFor] = useState<DragSession>(null);
  const depth = useRef<{ s: DragSession; n: number }>({ s: null, n: 0 });
  // WKWebView never sets `altKey` during a drag. It narrows `effectAllowed` to what the held
  // modifier permits instead (Option -> 'copy'), so that is the signal; remembered from `dragover`.
  const alt = useRef(false);

  const live = s && s.kind === accepts ? (s as Live<K>) : null;
  const ok = live !== null && opts.canDrop(live);
  const state: DropState = !live ? 'idle' : !ok ? 'invalid' : overFor === s ? 'over' : 'valid';

  const props: HTMLAttributes<HTMLElement> = {
    onDragEnter: (e) => {
      if (!ok) return;
      e.preventDefault();
      if (depth.current.s !== s) depth.current = { s, n: 0 };
      depth.current.n++;
      setOverFor(s);
    },
    onDragOver: (e) => {
      if (!ok) return;
      e.preventDefault();
      alt.current = wantsCopy(e);
      // Left alone, WebKit shows the "+" (copy) cursor for every copyMove drag; say move unless
      // Option is actually held.
      e.dataTransfer.dropEffect = opts.effect?.(e) ?? (alt.current ? 'copy' : 'move');
    },
    onDragLeave: () => {
      if (!ok || depth.current.s !== s) return;
      if (--depth.current.n <= 0) setOverFor(null);
    },
    onDrop: (e) => {
      if (!ok) return;
      e.preventDefault();
      depth.current = { s: null, n: 0 };
      setOverFor(null);
      opts.onDrop(live, { copy: wantsCopy(e) || alt.current });
      alt.current = false;
      endDrag();
    },
  };
  return { props, state };
}
