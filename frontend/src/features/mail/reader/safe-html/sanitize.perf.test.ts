import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './sanitize';

describe('hostile style performance', () => {
  it.each([
    ['unclosed url(', 'background:' + 'url('.repeat(40_000)],
    ["unclosed url('", 'background:' + "url('".repeat(40_000)],
    ['unclosed comments', 'color:red' + '/*'.repeat(100_000)],
  ])('sanitizes a ~200 KB hostile style attribute (%s) quickly', (_name, style) => {
    sanitizeEmailHtml('<p style="color:red">warm-up</p>');
    const t = performance.now();
    const r = sanitizeEmailHtml(`<p style="${style}">x</p>`);
    expect(performance.now() - t).toBeLessThan(200);
    expect(r.html).not.toContain('url(');
  });

  it('still blocks previously-blocked url payloads', () => {
    for (const s of [
      'background:url(javascript:alert(1))',
      "background:url('http://evil.test/x.png')",
      'background:url(data:text/html,hi)',
      'background:url(//evil.test/x.png)',
      'background:url(url(x)',
    ]) {
      expect(sanitizeEmailHtml(`<p style="${s}">x</p>`).html).not.toMatch(/url\(/);
    }
  });

  it('keeps cid urls', () => {
    expect(sanitizeEmailHtml('<p style="background:url(cid:a1)">x</p>').html).toContain('cid:a1');
  });
});
