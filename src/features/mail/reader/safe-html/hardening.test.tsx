import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildCsp, buildSrcDoc } from './buildSrcDoc';
import { sanitizeEmailHtml } from './sanitize';
import { SafeHtmlFrame } from './SafeHtmlFrame';

const clean = (html: string, allow = false) =>
  sanitizeEmailHtml(html, { allowRemoteImages: allow });

function mount(html: string) {
  const onOpenLink = vi.fn();
  const utils = render(
    <SafeHtmlFrame html={html} dark={false} title="Mail" onOpenLink={onOpenLink} />,
  );
  const iframe = utils.container.querySelector('iframe') as HTMLIFrameElement;
  const doc = iframe.contentDocument as Document;
  if (!doc.querySelector('.mail')) {
    doc.open();
    doc.write(iframe.getAttribute('srcdoc') ?? '');
    doc.close();
  }
  fireEvent.load(iframe);
  return { iframe, doc, onOpenLink };
}

describe('iframe guard', () => {
  it('sandbox is exactly allow-same-origin', () => {
    const { iframe } = mount('<p>x</p>');
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin');
  });

  it('CSP is present, restrictive and never allows script', () => {
    for (const allow of [false, true]) {
      const csp = buildCsp(allow);
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(csp).not.toMatch(/script-src|unsafe-eval|frame-src|connect-src/);
    }
    expect(buildCsp(false)).toContain('img-src data: cid:;');
    const doc = buildSrcDoc('<p>x</p>', { dark: false });
    expect(doc).toMatch(/<meta http-equiv="Content-Security-Policy"/);
    expect(doc).not.toMatch(/<script/i);
  });
});

describe('extra neutralisation', () => {
  it.each([
    ['nested svg script', '<svg><g><script>alert(1)</script></g></svg><p>ok</p>'],
    [
      'svg foreignObject iframe',
      '<svg><foreignObject><iframe src="https://e.test"></iframe></foreignObject></svg>',
    ],
    ['nested iframe in object', '<object><iframe src="https://e.test"></iframe></object>'],
    ['math', '<math><mtext><script>alert(1)</script></mtext></math>'],
    ['multiple handlers', '<img src=x onerror="alert(1)" onload="alert(2)">'],
    ['quoted css url', '<p style="background:url(&quot;https://e.test/a&quot;)">x</p>'],
  ])('%s', (_n, input) => {
    const out = clean(input).html;
    expect(out).not.toMatch(/<script|<iframe|<object|<svg|<math|onerror|onload|alert|e\.test/i);
  });
});

describe('links', () => {
  it('only http(s) and mailto hrefs survive sanitising', () => {
    const out = clean(
      [
        'file:///etc/passwd',
        'data:text/html,hi',
        'javascript:alert(1)',
        'ftp://x.test/f',
        'https://ok.test/',
        'mailto:a@b.test',
        'tel:123',
      ]
        .map((h) => `<a href="${h}">l</a>`)
        .join(''),
    ).html;
    const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['https://ok.test/', 'mailto:a@b.test']);
  });

  it('clicks never navigate and file:/data: are never opened', () => {
    const { doc, onOpenLink } = mount(
      '<a href="file:///etc/passwd">a</a><a href="data:text/html,x">b</a><a href="https://ok.test/">c</a>',
    );
    const prevented = [...doc.querySelectorAll('a')].map((a) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toEqual([true, true, true]);
    expect(onOpenLink.mock.calls).toEqual([['https://ok.test/']]);
  });

  it('middle click (auxclick) is prevented and not opened', () => {
    const { doc, onOpenLink } = mount('<a href="https://ok.test/">c</a>');
    const ev = new MouseEvent('auxclick', { bubbles: true, cancelable: true });
    doc.querySelector('a')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
  });
});

describe('remote images', () => {
  it('are blocked by default and only allowed explicitly', () => {
    const html =
      '<img src="https://cdn.test/a.png" width="40"><img srcset="https://cdn.test/b.png 2x">';
    const blocked = clean(html);
    expect(blocked.blockedRemoteContent).toBe(true);
    expect(blocked.html).not.toContain('cdn.test');
    expect(clean(html, true).html).toContain('https://cdn.test/a.png');
  });
});

describe('large and hostile inputs', () => {
  it('2 MB of HTML sanitises in reasonable time', () => {
    const chunk = '<p style="color:red">Hello <b>world</b> <a href="https://x.test/">link</a></p>';
    const html = chunk.repeat(Math.ceil((2 * 1024 * 1024) / chunk.length));
    const t = performance.now();
    const r = clean(html);
    expect(performance.now() - t).toBeLessThan(15_000);
    expect(r.html.length).toBeGreaterThan(1_000_000);
  });

  it('deeply nested tables do not throw or hang', () => {
    const depth = 400;
    const html = '<table><tr><td>'.repeat(depth) + 'deep' + '</td></tr></table>'.repeat(depth);
    const t = performance.now();
    const r = clean(html);
    expect(performance.now() - t).toBeLessThan(5_000);
    expect(r.html).toContain('deep');
  });

  it('10k links stay responsive and safe', () => {
    const html = Array.from({ length: 10_000 }, (_, i) =>
      i % 2 ? `<a href="https://x.test/${i}">l</a>` : `<a href="javascript:alert(${i})">l</a>`,
    ).join(' ');
    const t = performance.now();
    const r = clean(html);
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(r.html).not.toContain('javascript');
    expect(r.html.match(/href="/g)?.length).toBe(5000);
  });
});

describe('auto-resize', () => {
  it('does not loop: repeated measure triggers keep a stable height', () => {
    const { iframe, doc } = mount('<p>hi</p>');
    Object.defineProperty(doc.body, 'scrollHeight', { configurable: true, value: 123 });
    for (let i = 0; i < 50; i++) doc.body.dispatchEvent(new Event('load'));
    for (let i = 0; i < 50; i++) doc.body.dispatchEvent(new Event('error'));
    expect(iframe.getAttribute('scrolling')).toBe('no');
    expect(iframe.style.height === '' || iframe.style.height === '123px').toBe(true);
  });
});
