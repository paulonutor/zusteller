import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { isCollapsibleQuote, splitPlainTextQuotes } from './quotes';

export interface PlainTextBodyProps {
  text: string;
  onOpenLink: (url: string) => void;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}>]+$/;

function linkify(line: string, onOpenLink: (url: string) => void) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = m[0].replace(TRAILING, '');
    if (url.length <= 'https://'.length - 1) continue;
    if (start > last) parts.push(line.slice(last, start));
    parts.push(
      <a
        key={start}
        href={url}
        rel="noopener noreferrer nofollow"
        className="plain-text-link underline"
        onClick={(e) => {
          e.preventDefault();
          onOpenLink(url);
        }}
        onAuxClick={(e) => e.preventDefault()}
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function Lines({
  lines,
  quoted,
  onOpenLink,
}: {
  lines: string[];
  quoted: boolean;
  onOpenLink: (url: string) => void;
}) {
  return (
    <>
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            quoted || line.trimStart().startsWith('>') ? 'plain-text-quote opacity-60' : undefined
          }
        >
          {line === '' ? '\u200b' : linkify(line, onOpenLink)}
        </div>
      ))}
    </>
  );
}

function CollapsedQuote({
  lines,
  count,
  preview,
  onOpenLink,
}: {
  lines: string[];
  count: number;
  preview: string;
  onOpenLink: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} quoted text`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg bg-hover px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-active"
        style={{ whiteSpace: 'normal' }}
      >
        <ChevronRight size={12} aria-hidden className={open ? 'shrink-0 rotate-90' : 'shrink-0'} />
        <span className="shrink-0 rounded-full bg-border px-1.5 text-[11px]">{count} earlier</span>
        {!open && <span className="min-w-0 flex-1 truncate">{preview}</span>}
      </button>
      {open && (
        <div className="mt-1">
          <Lines lines={lines} quoted onOpenLink={onOpenLink} />
        </div>
      )}
    </div>
  );
}

export function PlainTextBody({ text, onOpenLink }: PlainTextBodyProps) {
  const segments = splitPlainTextQuotes(text);
  // A body that is only quoted text is shown in full: there is nothing to collapse it under.
  const hasOwnText = segments.some(
    (s) => s.kind === 'text' && s.lines.some((l) => l.trim() !== ''),
  );
  return (
    <div
      className="plain-text-body"
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
    >
      {segments.map((s, i) =>
        s.kind === 'quote' && hasOwnText && isCollapsibleQuote(s.lines) ? (
          <CollapsedQuote
            key={i}
            lines={s.lines}
            count={s.count}
            preview={s.preview}
            onOpenLink={onOpenLink}
          />
        ) : (
          <Lines key={i} lines={s.lines} quoted={false} onOpenLink={onOpenLink} />
        ),
      )}
    </div>
  );
}
