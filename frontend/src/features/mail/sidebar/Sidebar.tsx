import {
  Archive,
  Inbox,
  Monitor,
  Moon,
  Send,
  Star,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Account, Label, MailboxCounts, SystemMailbox } from '@/domain/mail';
import { MAILBOXES, userLabels } from '@/domain/mail';
import { useTheme, type ThemePreference } from '@/app/theme';
import { cn } from '@/lib/cn';
import { viewKey, type MailView } from '../view';

const ICONS: Record<SystemMailbox, LucideIcon> = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  trash: Trash2,
  all: Archive,
};

type Props = {
  account: Account | undefined;
  labels: Label[];
  counts: MailboxCounts | undefined;
  view: MailView;
  onSelectView: (v: MailView) => void;
};

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
        <span className="text-[12px] tabular-nums text-muted" aria-label={`${count} unread`}>
          {count}
        </span>
      )}
    </button>
  );
}

export function Sidebar({ account, labels, counts, view, onSelectView }: Props) {
  const active = viewKey(view);
  return (
    <nav aria-label="Mailboxes" className="flex h-full flex-col bg-sidebar">
      {/* Reserves room for the native traffic lights when a desktop host overlays the titlebar. */}
      <div className="drag-region flex h-[52px] shrink-0 items-end px-3 pb-2">
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
              <li key={m.id}>
                <Row
                  active={isActive}
                  onClick={() => onSelectView({ kind: 'mailbox', mailbox: m.id })}
                  icon={<Icon size={15} className={cn(isActive ? 'text-accent' : 'text-muted')} />}
                  label={m.name}
                  // Only the Inbox shows a count, like Mail/Gmail; others would be noise.
                  count={m.id === 'inbox' ? counts?.mailboxes.inbox : undefined}
                />
              </li>
            );
          })}
        </ul>

        <h2 className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Labels
        </h2>
        <ul className="space-y-px">
          {userLabels(labels).map((l) => (
            <li key={l.id}>
              <Row
                active={active === viewKey({ kind: 'label', labelId: l.id })}
                onClick={() => onSelectView({ kind: 'label', labelId: l.id })}
                icon={<span className="size-2.5 rounded-full" style={{ background: l.color }} />}
                label={l.name}
                count={counts?.labels[l.id]}
              />
            </li>
          ))}
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
        {THEMES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={preference === id}
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
