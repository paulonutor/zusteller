import { useServices } from '@/app/services';
import { useToast } from '@/app/toast';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, ImageOff, Paperclip, Star } from 'lucide-react';
import type { Message } from '@/domain/mail';
import { useTheme } from '@/app/theme';
import { cn } from '@/lib/cn';
import {
  avatarHue,
  displayName,
  formatAddress,
  formatFullDate,
  formatSize,
  initials,
} from '../format';
import { PlainTextBody } from './safe-html/PlainTextBody';

// DOMPurify + iframe frame are only needed once an HTML mail is opened.
const SafeHtmlFrame = lazy(() =>
  import('./safe-html/SafeHtmlFrame').then((mod) => ({ default: mod.SafeHtmlFrame })),
);

type Props = {
  message: Message;
  expanded: boolean;
  /** False for a single-message thread: plain message, no toggle, always expanded. */
  collapsible?: boolean;
  /** Message is in Junk: remote images are never loaded automatically, only on request. */
  junk?: boolean;
  onToggle: () => void;
  onOpenLink: (url: string) => void;
};

export function MessageView({
  message: m,
  expanded: expandedProp,
  collapsible = true,
  junk = false,
  onToggle,
  onOpenLink,
}: Props) {
  const { mail } = useServices();
  const toast = useToast();
  const [downloading, setDownloading] = useState<string>();
  const download = async (attachment: Message['attachments'][number]) => {
    setDownloading(attachment.id);
    try {
      await mail.downloadAttachment?.(m.accountId, m.threadId, m.id, attachment);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not download attachment', 'error');
    } finally {
      setDownloading(undefined);
    }
  };
  const expanded = collapsible ? expandedProp : true;
  const { resolved } = useTheme();
  const [showRemote, setShowRemote] = useState(false);
  const allowRemoteImages = !junk || showRemote;
  const [blocked, setBlocked] = useState(false);

  const preview = (m.plainText ?? '').replace(/\s+/g, ' ').slice(0, 120);

  const status = (
    <>
      {m.isStarred && (
        <Star size={13} className="shrink-0 fill-star text-star" aria-label="Starred" />
      )}
      {m.attachments.length > 0 && (
        <Paperclip size={13} className="shrink-0 text-muted" aria-label="Has attachments" />
      )}
      <time dateTime={m.sentAt} className="shrink-0 text-[12px] text-muted">
        {formatFullDate(m.sentAt)}
      </time>
      {collapsible &&
        (expanded ? (
          <ChevronDown size={14} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted" />
        ))}
    </>
  );

  const sender = (
    <>
      {expanded ? (
        <span className="min-w-0 flex-1 truncate">
          <span className="text-[13.5px] font-semibold">{displayName(m.from)}</span>
          <span className="ml-1.5 text-[12.5px] text-muted">&lt;{m.from.email}&gt;</span>
        </span>
      ) : (
        <>
          <span className="shrink-0 text-[13.5px] font-semibold">{displayName(m.from)}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{preview}</span>
        </>
      )}
      {status}
    </>
  );

  const avatar = (
    <span
      data-reader-avatar
      aria-hidden="true"
      style={{ '--av-h': avatarHue(m.from.email) } as React.CSSProperties}
      className={cn('self-start', expanded && 'row-span-2')}
    >
      {initials(m.from)}
    </span>
  );

  const rowClass = 'flex min-h-10 min-w-0 items-center gap-2 text-left';

  return (
    <article
      aria-label={`Message from ${displayName(m.from)}`}
      data-flat={collapsible ? undefined : 'true'}
      className="border-b border-border last:border-b-0"
    >
      <div
        className={cn(
          'mail-message-head grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 px-5',
          expanded ? 'pb-1 pt-3' : 'py-2.5',
        )}
      >
        {avatar}
        {collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className={cn('mail-message-toggle rounded-md hover:bg-hover', rowClass)}
          >
            {sender}
          </button>
        ) : (
          <div className={rowClass}>{sender}</div>
        )}
        {expanded && <Recipients message={m} />}
      </div>

      {expanded && (
        <div className="selectable px-5 pb-5 pt-2">
          {m.html ? (
            <>
              {blocked && !allowRemoteImages && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-hover px-3 py-1.5 text-[12px] text-muted">
                  <ImageOff size={14} />
                  This message is in Junk. Images are not loaded automatically.
                  <button
                    type="button"
                    className="ml-auto text-[color-mix(in_srgb,var(--accent)_75%,var(--foreground))] hover:underline"
                    onClick={() => setShowRemote(true)}
                  >
                    Load images
                  </button>
                </div>
              )}
              <Suspense
                fallback={
                  <div aria-hidden className="space-y-2 py-2">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-current opacity-10" />
                    <div className="h-3 w-full animate-pulse rounded bg-current opacity-10" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-current opacity-10" />
                  </div>
                }
              >
                <SafeHtmlFrame
                  title={`Message body: ${m.subject}`}
                  html={m.html}
                  dark={resolved === 'dark'}
                  allowRemoteImages={allowRemoteImages}
                  onOpenLink={onOpenLink}
                  onBlockedRemoteContent={setBlocked}
                />
              </Suspense>
            </>
          ) : (
            <PlainTextBody text={m.plainText ?? ''} onOpenLink={onOpenLink} />
          )}

          {m.attachments.length > 0 && (
            <ul className="mail-attachments mt-4 flex flex-wrap gap-2" aria-label="Attachments">
              {m.attachments.map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    'flex max-w-64 items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12px]',
                  )}
                >
                  <FileText size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.filename}</span>
                    <span className="text-muted">{formatSize(a.size)}</span>
                  </span>
                  {mail.downloadAttachment && (
                    <button
                      type="button"
                      className="ml-2 hover:underline disabled:opacity-50"
                      disabled={!!downloading}
                      aria-label={`Save ${a.filename}`}
                      onClick={() => void download(a)}
                    >
                      {downloading === a.id ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

/** "to Paul" line under the sender; the caret opens a popover with the full header fields. */
function Recipients({ message: m }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cc = m.cc ?? [];
  return (
    <div ref={ref} className="relative -mt-0.5 min-w-0 text-[12px] text-muted">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Details, to ${m.to.map(displayName).join(', ')}`}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-0.5 rounded hover:text-foreground"
      >
        <span className="truncate">
          to {m.to.map(displayName).join(', ')}
          {cc.length ? `, Cc ${cc.map(displayName).join(', ')}` : ''}
        </span>
        <ChevronDown size={12} className={cn('shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <dl
          aria-label="Message details"
          className="selectable absolute left-0 top-full z-20 mt-1 grid w-max max-w-[min(32rem,100%)] grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-raised p-3 text-[12px] shadow-lg"
        >
          <dt className="text-right">from</dt>
          <dd className="text-foreground">{formatAddress(m.from)}</dd>
          <dt className="text-right">to</dt>
          <dd className="text-foreground">{m.to.map(formatAddress).join(', ')}</dd>
          {cc.length > 0 && (
            <>
              <dt className="text-right">cc</dt>
              <dd className="text-foreground">{cc.map(formatAddress).join(', ')}</dd>
            </>
          )}
          <dt className="text-right">date</dt>
          <dd className="text-foreground">{formatFullDate(m.sentAt)}</dd>
        </dl>
      )}
    </div>
  );
}
