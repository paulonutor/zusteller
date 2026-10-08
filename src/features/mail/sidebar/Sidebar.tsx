import { dragRegionProps } from '@/platform/hostChrome';
import {
  Archive,
  Inbox,
  Monitor,
  Moon,
  Send,
  ShieldAlert,
  Star,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Account, ID, Label, MailboxCounts, SystemMailbox } from '@/domain/mail';
import { MAILBOXES, userLabels } from '@/domain/mail';
import { useTheme, type ThemePreference } from '@/app/theme';
import { cn } from '@/lib/cn';
import { dropTargetKey } from '../dropAnimation';
import { beginLabelDrag, endDrag, useDropZone, type DropTarget } from '../dnd';
import { viewKey, type MailView } from '../view';

const ICONS: Record<SystemMailbox, LucideIcon> = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  junk: ShieldAlert,
  trash: Trash2,
  all: Archive,
};

type Props = {
  account: Account | undefined;
  labels: Label[];
  counts: MailboxCounts | undefined;
  view: MailView;
  onSelectView: (v: MailView) => void;
  /** Drag & drop of conversations onto mailboxes and labels. */
  canDropThreads: (target: DropTarget, ids: ID[]) => boolean;
  onDropThreads: (target: DropTarget, ids: ID[], copy: boolean) => void;
};

/** A sidebar entry that accepts dragged conversations and, for labels, can itself be dragged. */
function Item({
  target,
  active,
  label,
  canDropThreads,
  onDropThreads,
  children,
}: {
  target: DropTarget;
  /** The view being shown: dropping onto it (or dragging it onto its own rows) is meaningless. */
  active: boolean;
  label?: Label;
  canDropThreads: Props['canDropThreads'];
  onDropThreads: Props['onDropThreads'];
  children: React.ReactNode;
}) {
  const zone = useDropZone('threads', {
    canDrop: (s) => !active && canDropThreads(target, s.ids),
    onDrop: (s, { copy }) => onDropThreads(target, s.ids, copy),
    // Option only means something for labels (add without leaving the Inbox); elsewhere it's a move.
    effect: () => (target.kind === 'label' ? undefined : 'move'),
  });
  return (
    <li
      {...zone.props}
      data-drop-target={dropTargetKey(target)}
      data-drop={zone.state === 'idle' ? undefined : zone.state}
      draggable={label && !active ? true : undefined}
      onDragStart={label && !active ? (e) => beginLabelDrag(e, label) : undefined}
      onDragEnd={label && !active ? endDrag : undefined}
      className="rounded-md data-[drop=invalid]:opacity-40 data-[drop=over]:bg-accent/20 data-[drop=over]:ring-2 data-[drop=over]:ring-inset data-[drop=over]:ring-accent"
    >
      {children}
    </li>
  );
}

function Row({
  active,
  onClick,
  icon,
  label,
  count,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={title}
      className={cn(
        'no-drag flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
        active ? 'bg-active font-medium' : 'hover:bg-hover',
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {!!count && (
        <span className="text-[12px] tabular-nums text-muted">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">, {count} unread</span>
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  account,
  labels,
  counts,
  view,
  onSelectView,
  canDropThreads,
  onDropThreads,
}: Props) {
  const dnd = { canDropThreads, onDropThreads };
  const active = viewKey(view);
  return (
    <nav aria-label="Mailboxes" className="flex h-full flex-col bg-sidebar">
      {/* Reserves room for the native traffic lights when a desktop host overlays the titlebar. */}
      <div {...dragRegionProps} className="drag-region flex h-[52px] shrink-0 items-end px-3 pb-2">
        <div className="min-w-0 pl-0.5">
          <div className="truncate text-[13px] font-semibold">{account?.displayName ?? '…'}</div>
          <div className="truncate text-[11px] text-muted">{account?.email}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-px">
          {MAILBOXES.map((m) => {
            const Icon = ICONS[m.id];
            const isActive = active === viewKey({ kind: 'mailbox', mailbox: m.id });
            return (
              <Item
                key={m.id}
                target={{ kind: 'mailbox', mailbox: m.id }}
                active={isActive}
                {...dnd}
              >
                <Row
                  active={isActive}
                  onClick={() => onSelectView({ kind: 'mailbox', mailbox: m.id })}
                  icon={
                    <Icon
                      size={15}
                      data-mailbox-icon
                      className={cn(isActive ? 'text-accent' : 'text-muted')}
                    />
                  }
                  label={m.name}
                  // Only Inbox and Junk show an unread count; the others would be noise.
                  count={m.id === 'inbox' || m.id === 'junk' ? counts?.mailboxes[m.id] : undefined}
                />
              </Item>
            );
          })}
        </ul>

        <h2 className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Labels
        </h2>
        <ul className="space-y-px">
          {userLabels(labels).map((l) => {
            const isActive = active === viewKey({ kind: 'label', labelId: l.id });
            return (
              <Item
                key={l.id}
                target={{ kind: 'label', labelId: l.id }}
                active={isActive}
                label={l}
                {...dnd}
              >
                <Row
                  active={isActive}
                  onClick={() => onSelectView({ kind: 'label', labelId: l.id })}
                  icon={<span className="size-2.5 rounded-full" style={{ background: l.color }} />}
                  label={l.name}
                  count={counts?.labels[l.id]}
                />
              </Item>
            );
          })}
        </ul>
      </div>

      <ThemeSwitch />
    </nav>
  );
}

const THEMES: { id: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { id: 'system', label: 'System appearance', Icon: Monitor },
  { id: 'light', label: 'Light appearance', Icon: Sun },
  { id: 'dark', label: 'Dark appearance', Icon: Moon },
];

function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="shrink-0 border-t border-border p-2">
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="no-drag flex rounded-md bg-hover p-0.5"
      >
        {THEMES.map(({ id, label, Icon }, i) => (
          <button
            key={id}
            type="button"
            role="radio"
            id={`theme-${id}`}
            aria-checked={preference === id}
            // Radio group: one tab stop (the checked one), arrows move + select.
            tabIndex={preference === id ? 0 : -1}
            onKeyDown={(e) => {
              const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
              if (!d) return;
              e.preventDefault();
              const n = THEMES[(i + d + THEMES.length) % THEMES.length]!;
              setPreference(n.id);
              document.getElementById(`theme-${n.id}`)?.focus();
            }}
            aria-label={label}
            title={label}
            onClick={() => setPreference(id)}
            className={cn(
              'flex h-6 flex-1 items-center justify-center rounded text-muted transition-colors',
              preference === id && 'bg-surface-raised text-foreground shadow-sm',
            )}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}
