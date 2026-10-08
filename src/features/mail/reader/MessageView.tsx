import { lazy, Suspense, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, ImageOff, Paperclip, Star } from 'lucide-react';
import type { Message } from '@/domain/mail';
import { useTheme } from '@/app/theme';
import { cn } from '@/lib/cn';
import { displayName, formatAddress, formatFullDate, formatSize } from '../format';
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
  onToggle: () => void;
  onOpenLink: (url: string) => void;
};

export function MessageView({
  message: m,
  expanded: expandedProp,
  collapsible = true,
  onToggle,
  onOpenLink,
}: Props) {
  const expanded = collapsible ? expandedProp : true;
  const { resolved } = useTheme();
  const [showRemote, setShowRemote] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [details, setDetails] = useState(false);

  const preview = (m.plainText ?? '').replace(/\s+/g, ' ').slice(0, 120);

  const summary = (
    <>
      {collapsible &&
        (expanded ? (
          <ChevronDown size={14} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted" />
        ))}
      <span className="shrink-0 text-[13.5px] font-semibold">{displayName(m.from)}</span>
      {!expanded && (
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{preview}</span>
      )}
      {expanded && <span className="flex-1" />}
      {m.isStarred && (
        <Star size={13} className="shrink-0 fill-star text-star" aria-label="Starred" />
      )}
      {m.attachments.length > 0 && (
        <Paperclip size={13} className="shrink-0 text-muted" aria-label="Has attachments" />
      )}
      <time dateTime={m.sentAt} className="shrink-0 text-[12px] text-muted">
        {formatFullDate(m.sentAt)}
      </time>
    </>
  );

  return (
    <article
      aria-label={`Message from ${displayName(m.from)}`}
      className="border-b border-border last:border-b-0"
    >
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-5 py-2.5 text-left hover:bg-hover"
        >
          {summary}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 px-5 py-2.5">{summary}</div>
      )}

      {expanded && (
        <div className="selectable px-5 pb-5 pl-[38px]">
          <div className="mb-3 text-[12px] text-muted">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setDetails((d) => !d)}
              aria-expanded={details}
            >
              To {m.to.map(displayName).join(', ')}
              {m.cc?.length ? `, Cc ${m.cc.map(displayName).join(', ')}` : ''}
              <span className="ml-1 underline-offset-2 hover:underline">
                {details ? 'Hide' : 'Details'}
              </span>
            </button>
            {details && (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt>From</dt>
                <dd>{formatAddress(m.from)}</dd>
                <dt>To</dt>
                <dd>{m.to.map(formatAddress).join(', ')}</dd>
                {!!m.cc?.length && (
                  <>
                    <dt>Cc</dt>
                    <dd>{m.cc.map(formatAddress).join(', ')}</dd>
                  </>
                )}
                <dt>Date</dt>
                <dd>{formatFullDate(m.sentAt)}</dd>
              </dl>
            )}
          </div>

          {m.html ? (
            <>
              {blocked && !showRemote && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-hover px-3 py-1.5 text-[12px] text-muted">
                  <ImageOff size={14} /> Remote content is blocked to protect your privacy.
                  <button
                    type="button"
                    className="ml-auto text-[color-mix(in_srgb,var(--accent)_75%,var(--foreground))] hover:underline"
                    onClick={() => setShowRemote(true)}
                  >
                    Load remote images
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
                  allowRemoteImages={showRemote}
                  onOpenLink={onOpenLink}
                  onBlockedRemoteContent={setBlocked}
                />
              </Suspense>
            </>
          ) : (
            <PlainTextBody text={m.plainText ?? ''} onOpenLink={onOpenLink} />
          )}

          {m.attachments.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Attachments">
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
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
