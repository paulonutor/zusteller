import { memo } from 'react';
import { Paperclip, Star } from 'lucide-react';
import { SYSTEM_LABEL, type ID, type Label, type ThreadSummary } from '@/domain/mail';
import { Checkbox } from '@/components/ui/Checkbox';
import { ContextMenu, type MenuItemSpec } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import { beginThreadDrag, endDrag, useDropZone } from '../dnd';
import { LabelChip } from '../LabelChip';
import { LabelOverflow } from './LabelOverflow';
import { avatarHue, displayName, formatListDate, initials } from '../format';

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
  /** Ids a drag from this row carries: the whole selection if the row is part of it. */
  dragIds: () => ID[];
  onDropLabel: (labelId: ID) => void;
  /** Set when the list is windowed: total rows (-1 = unknown) and 1-based position. */
  setSize?: number;
  posInSet?: number;
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

  // A sidebar label dragged onto the row. Refused when the row already has it (unless it is part
  // of a selection, where other rows may still lack it).
  const labelDrop = useDropZone('label', {
    canDrop: (s) => p.selected || !t.labelIds.includes(s.labelId),
    onDrop: (s) => p.onDropLabel(s.labelId),
    effect: () => 'copy',
  });

  return (
    <ContextMenu items={p.buildContextItems} onOpenChange={(o) => o && p.onContextOpen()}>
      <div
        role="option"
        id={`row-${t.id}`}
        aria-selected={p.selected}
        aria-setsize={p.setSize}
        aria-posinset={p.posInSet}
        data-unread={!t.isRead}
        data-focused={p.focused && p.listHasFocus}
        onClick={p.onClick}
        draggable
        onDragStart={(e) => beginThreadDrag(e, p.dragIds())}
        onDragEnd={endDrag}
        {...labelDrop.props}
        data-drop={labelDrop.state === 'idle' ? undefined : labelDrop.state}
        className={cn(
          'data-[drop=over]:bg-accent/20 data-[drop=over]:outline-2 data-[drop=over]:-outline-offset-2 data-[drop=over]:outline-accent',
          'mail-thread-row group relative flex h-[68px] cursor-default gap-2 border-b border-border/70 px-2.5 py-2',
          p.selected
            ? p.listHasFocus
              ? 'bg-selection'
              : 'bg-selection-inactive'
            : 'hover:bg-hover',
          p.focused && p.listHasFocus && 'outline-2 -outline-offset-2 outline-accent/70',
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
              aria-hidden="true"
              className="size-2 rounded-full bg-unread group-hover:hidden"
            />
          ) : null}
          {/* Pointer-only: a nested control inside role=option is invalid ARIA. Keyboard: Space
              toggles the focused row; selection is exposed through aria-selected. */}
          <Checkbox
            decorative
            label={`Select conversation: ${t.subject}`}
            checked={p.selected}
            onChange={p.onToggleSelect}
            className={cn(!t.isRead && !p.selected && 'hidden group-hover:flex')}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              data-sender
              className={cn('truncate text-[13.5px]', !t.isRead ? 'font-semibold' : 'font-medium')}
            >
              {!t.isRead && <span className="sr-only">Unread, </span>}
              {senders(t, p.accountEmail)}
            </span>
            {t.messageCount > 1 && (
              <span className="shrink-0 text-[11px] text-muted">{t.messageCount}</span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-muted">
              {t.hasAttachments && (
                <>
                  <Paperclip size={12} aria-hidden="true" />
                  <span className="sr-only">Has attachments, </span>
                </>
              )}
              {t.isStarred && <span className="sr-only">Starred, </span>}
              {formatListDate(t.lastMessageAt)}
            </span>
            {/* Pointer-only (see checkbox above). Keyboard: S; also toolbar and context menu. */}
            {!inTrash && (
              <span
                data-star
                data-starred={t.isStarred}
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  p.onToggleStar();
                }}
                className="no-drag -mr-1 inline-flex rounded p-0.5 text-faint hover:text-muted"
              >
                <Star size={15} className={cn(t.isStarred && 'fill-star text-star')} />
              </span>
            )}
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
                <LabelChip key={l.id} label={l} />
              ))}
              {chips.length > 2 && <LabelOverflow labels={chips.slice(2)} />}
            </div>
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});
