import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildSrcDoc } from './buildSrcDoc';
import { SafeHtmlFrame } from './SafeHtmlFrame';

function setup(html: string, extra: Partial<React.ComponentProps<typeof SafeHtmlFrame>> = {}) {
  const onOpenLink = vi.fn();
  const utils = render(
    <SafeHtmlFrame html={html} dark={false} title="Mail" onOpenLink={onOpenLink} {...extra} />,
  );
  const iframe = utils.container.querySelector('iframe') as HTMLIFrameElement;
  return { ...utils, iframe, onOpenLink };
}

function frameDoc(iframe: HTMLIFrameElement): Document {
  // jsdom does not always process srcdoc synchronously; fall back to writing it ourselves.
  const doc = iframe.contentDocument as Document;
  if (!doc.body || !doc.querySelector('.mail')) {
    doc.open();
    doc.write(iframe.getAttribute('srcdoc') ?? '');
    doc.close();
  }
  return doc;
}

describe('SafeHtmlFrame', () => {
  it('uses a locked-down sandbox', () => {
    const { iframe } = setup('<p>hi</p>');
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toBe('allow-same-origin');
    expect(sandbox).not.toMatch(/allow-scripts|allow-top-navigation|allow-popups|allow-forms/);
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('embeds a CSP and sanitized content in srcDoc', () => {
    const { iframe } = setup('<p>hi</p><script>alert(1)</script><img src="https://t.test/a.png">');
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).not.toMatch(/<script|alert|t\.test/);
    expect(srcdoc).not.toMatch(/img-src[^"]*https:/);
  });

  it('allows https images in CSP only when requested', () => {
    expect(buildSrcDoc('', { dark: false, allowRemoteImages: true })).toMatch(
      /img-src[^;"]*https:/,
    );
    expect(buildSrcDoc('', { dark: true })).not.toMatch(/img-src[^;"]*https:/);
  });

  it('reports blocked remote content', () => {
    const cb = vi.fn();
    setup('<img src="https://cdn.test/a.png" width="50">', { onBlockedRemoteContent: cb });
    expect(cb).toHaveBeenLastCalledWith(true);
    const cb2 = vi.fn();
    setup('<p>plain</p>', { onBlockedRemoteContent: cb2 });
    expect(cb2).toHaveBeenLastCalledWith(false);
  });

  it('only forwards safe link clicks and always prevents navigation', () => {
    const { iframe, onOpenLink } = setup(
      '<a href="https://example.test/x">a</a><a href="mailto:x@y.test">b</a>' +
        '<a href="javascript:alert(1)">c</a><a href="/relative">d</a>',
    );
    const doc = frameDoc(iframe);
    fireEvent.load(iframe);
    const click = (index: number) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      doc.querySelectorAll('a')[index]!.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(click(0)).toBe(true);
    expect(click(1)).toBe(true);
    expect(click(2)).toBe(true);
    expect(click(3)).toBe(true);
    expect(onOpenLink.mock.calls.map((c) => c[0])).toEqual([
      'https://example.test/x',
      'mailto:x@y.test',
    ]);
  });

  it('removes listeners on unmount', () => {
    const { iframe, onOpenLink, unmount } = setup('<a href="https://example.test/">a</a>');
    const doc = frameDoc(iframe);
    fireEvent.load(iframe);
    unmount();
    doc
      .getElementById('a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onOpenLink).not.toHaveBeenCalled();
  });
});
