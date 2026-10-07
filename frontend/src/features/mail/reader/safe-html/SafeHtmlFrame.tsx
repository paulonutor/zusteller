import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSrcDoc } from './buildSrcDoc';
import { sanitizeEmailHtml } from './sanitize';

export interface SafeHtmlFrameProps {
  html: string;
  dark: boolean;
  allowRemoteImages?: boolean;
  onOpenLink: (url: string) => void;
  onBlockedRemoteContent?: (blocked: boolean) => void;
  title: string;
}

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

export function SafeHtmlFrame({
  html,
  dark,
  allowRemoteImages = false,
  onOpenLink,
  onBlockedRemoteContent,
  title,
}: SafeHtmlFrameProps) {
  const { srcDoc, blocked } = useMemo(() => {
    const result = sanitizeEmailHtml(html, { allowRemoteImages });
    return {
      srcDoc: buildSrcDoc(result.html, { dark, allowRemoteImages }),
      blocked: result.blockedRemoteContent,
    };
  }, [html, dark, allowRemoteImages]);

  const [height, setHeight] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onOpenLinkRef.current = onOpenLink;
  }, [onOpenLink]);

  useEffect(() => {
    onBlockedRemoteContent?.(blocked);
  }, [blocked, onBlockedRemoteContent]);

  const detach = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  useEffect(() => detach, [detach]);

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLIFrameElement>) => {
      detach();
      const doc = event.currentTarget.contentDocument;
      if (!doc?.body) return;
      const win = doc.defaultView;

      const measure = () => {
        const body = doc.body;
        if (!body) return;
        const h = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height, 0));
        setHeight((prev) => (prev === h ? prev : h));
      };

      const onClick = (e: Event) => {
        const target = e.target as Element | null;
        const anchor = target?.closest?.('a');
        if (!anchor) return;
        e.preventDefault();
        const href = (anchor.getAttribute('href') ?? '').trim();
        if (e.type === 'click' && SAFE_LINK.test(href)) onOpenLinkRef.current(href);
      };

      doc.addEventListener('click', onClick);
      doc.addEventListener('auxclick', onClick);
      doc.addEventListener('load', measure, true);
      doc.addEventListener('error', measure, true);

      const RO = win && 'ResizeObserver' in win ? win.ResizeObserver : globalThis.ResizeObserver;
      const observer = typeof RO === 'function' ? new RO(measure) : null;
      observer?.observe(doc.body);

      measure();

      cleanupRef.current = () => {
        doc.removeEventListener('click', onClick);
        doc.removeEventListener('auxclick', onClick);
        doc.removeEventListener('load', measure, true);
        doc.removeEventListener('error', measure, true);
        observer?.disconnect();
      };
    },
    [detach],
  );

  return (
    <iframe
      title={title}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      onLoad={handleLoad}
      scrolling="no"
      style={{
        display: 'block',
        width: '100%',
        maxWidth: '100%',
        border: 0,
        background: 'transparent',
        height: height > 0 ? height : undefined,
      }}
    />
  );
}
