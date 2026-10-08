import { Fragment } from 'react';

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

export function PlainTextBody({ text, onOpenLink }: PlainTextBodyProps) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return (
    <div
      className="plain-text-body"
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
    >
      {lines.map((line, i) => {
        const quoted = line.trimStart().startsWith('>');
        return (
          <Fragment key={i}>
            <div className={quoted ? 'plain-text-quote opacity-60' : undefined}>
              {line === '' ? '​' : linkify(line, onOpenLink)}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
