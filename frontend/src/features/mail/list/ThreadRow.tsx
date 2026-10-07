import { memo } from 'react';
import { Paperclip, Star } from 'lucide-react';
import type { ID, Label, ThreadSummary } from '@/domain/mail';
import { SYSTEM_LABEL } from '@/domain/mail';
import { Checkbox } from '@/components/ui/Checkbox';
import { ContextMenu, type MenuItemSpec } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import { avatarHue, displayName, formatListDate, initials, labelChipStyle } from '../format';

type Props = {
  thread: ThreadSummary;
  accountEmail: string | undefined;
  labelsById: Map<ID, Label>;
  selected: boolean;
  focused: boolean;
  listHasFocus: boolean;
  onClick: (e: React.MouseEvent) => void;
  onToggleSelect: () => void;
  onToggleStar: () => void;
  buildContextItems: () => MenuItemSpec[];
  onContextOpen: () => void;
};

/** The correspondent shown on the avatar: first participant who isn't me. */
function leadSender(t: ThreadSummary, me: string | undefined) {
  return (
    t.participants.find((x) => x.email.toLowerCase() !== me?.toLowerCase()) ?? t.participants[0]
  );
}

/** Sender line: other participants first; "me" only if I'm the sole participant. */
function senders(t: ThreadSummary, me: string | undefined): string {
  const others = t.participants.filter((p) => p.email.toLowerCase() !== me?.toLowerCase());
  const list = others.length ? others : t.participants;
  // A lone correspondent gets their full name; groups get first names to fit.
  const names =
    list.length === 1
      ? [displayName(list[0]!)]
      : list.slice(0, 3).map((p) => displayName(p).split(' ')[0]);
  return names.join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
}

export const ThreadRow = memo(function ThreadRow(p: Props) {
  const t = p.thread;
  const chips = t.labelIds
    .map((id) => p.labelsById.get(id))
    .filter((l): l is Label => !!l && l.type === 'user');
  const lead = leadSender(t, p.accountEmail);
  const inTrash = t.labelIds.includes(SYSTEM_LABEL.trash);

  return (
    <ContextMenu items={p.buildContextItems} onOpenChange={(o) => o && p.onContextOpen()}>
      <div
        role="option"
        id={`row-${t.id}`}
        aria-selected={p.selected}
        data-unread={!t.isRead}
        data-focused={p.focused && p.listHasFocus}
        onClick={p.onClick}
        className={cn(
          'group relative flex h-[68px] cursor-default gap-2 border-b border-border/70 px-2.5 py-2',
          p.selected
            ? p.listHasFocus
              ? 'bg-selection'
              : 'bg-selection-inactive'
            : 'hover:bg-hover',
          p.focused && p.listHasFocus && 'outline-2 -outline-offset-2 outline-accent/70',
          inTrash && 'opacity-70',
        )}
      >
        <div data-lead className="relative flex size-8 shrink-0 items-center justify-center">
          {lead ? (
            <span
              data-avatar
              aria-hidden="true"
              style={{ '--av-h': avatarHue(lead.email) } as React.CSSProperties}
            >
              {initials(lead)}
            </span>
          ) : null}
          {!t.isRead ? (
            <span
              data-unread-dot
              className="size-2 rounded-full bg-unread group-hover:hidden"
              aria-label="Unread"
            />
          ) : null}
          <Checkbox
            label={`Select conversation: ${t.subject}`}
            checked={p.selected}
            onChange={p.onToggleSelect}
            className={cn(!t.isRead && !p.selected && 'hidden group-hover:flex')}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              data-sender
              className={cn('truncate text-[13.5px]', !t.isRead ? 'font-semibold' : 'font-medium')}
            >
              {senders(t, p.accountEmail)}
            </span>
            {t.messageCount > 1 && (
              <span className="shrink-0 text-[11px] text-muted">{t.messageCount}</span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-muted">
              {t.hasAttachments && <Paperclip size={12} aria-label="Has attachments" />}
              {formatListDate(t.lastMessageAt)}
            </span>
            <button
              type="button"
              data-star
              tabIndex={-1}
              aria-label={t.isStarred ? 'Remove star' : 'Add star'}
              aria-pressed={t.isStarred}
              onClick={(e) => {
                e.stopPropagation();
                p.onToggleStar();
              }}
              className="no-drag -mr-1 rounded p-0.5 text-faint hover:text-muted"
            >
              <Star size={15} className={cn(t.isStarred && 'fill-star text-star')} />
            </button>
          </div>
          <div data-line2 className="min-w-0">
            <div
              data-subject
              className={cn(
                'truncate text-[13px]',
                !t.isRead ? 'font-medium' : 'text-foreground/90',
              )}
            >
              {t.subject}
            </div>
            <div data-snippet-row className="flex items-center gap-1.5">
              <span data-snippet className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                {t.snippet}
              </span>
              {chips.slice(0, 2).map((l) => (
                <span
                  key={l.id}
                  className="max-w-24 shrink-0 truncate rounded px-1.5 text-[11px] leading-[16px]"
                  style={labelChipStyle(l.color)}
                >
                  {l.name}
                </span>
              ))}
              {chips.length > 2 && (
                <span className="shrink-0 text-[11px] text-muted">+{chips.length - 2}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});
