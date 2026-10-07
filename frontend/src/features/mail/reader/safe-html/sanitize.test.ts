import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './sanitize';

const clean = (html: string, allow = false) =>
  sanitizeEmailHtml(html, { allowRemoteImages: allow });

describe('sanitizeEmailHtml hostile input', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['script', '<p>a</p><script>alert(1)</script>', /script|alert/i],
    ['onerror', '<img src="cid:x" onerror="alert(1)">', /onerror|alert/i],
    ['onclick', '<div onclick="alert(1)">x</div>', /onclick|alert/i],
    ['onload', '<body onload="alert(1)"><p>x</p></body>', /onload|alert/i],
    ['javascript link', '<a href="javascript:alert(1)">x</a>', /javascript/i],
    ['obfuscated js', '<a href="jAvA\nscript:alert(1)">x</a>', /script:|alert/i],
    ['tab js', '<a href=" \tJaVaScRiPt:alert(1)">x</a>', /script:|alert/i],
    ['entity js', '<a href="&#106;avascript:alert(1)">x</a>', /script:|alert/i],
    ['vbscript', '<a href="vbscript:msgbox(1)">x</a>', /vbscript/i],
    ['data html link', '<a href="data:text/html,<script>alert(1)</script>">x</a>', /data:|alert/i],
    ['data html img', '<img src="data:text/html;base64,AAAA">', /data:text/i],
    ['iframe', '<iframe src="https://evil.test"></iframe>', /iframe|evil/i],
    ['object', '<object data="https://evil.test/x.swf"></object>', /object|evil/i],
    ['embed', '<embed src="https://evil.test/x.swf">', /embed|evil/i],
    [
      'form',
      '<form action="https://evil.test"><input name=a><button>x</button></form>',
      /form|input|button|evil/i,
    ],
    [
      'meta refresh',
      '<meta http-equiv="refresh" content="0;url=https://evil.test">',
      /meta|refresh|evil/i,
    ],
    ['base', '<base href="https://evil.test/"><a href="x">x</a>', /<base|evil/i],
    ['link', '<link rel="stylesheet" href="https://evil.test/a.css">', /<link|evil/i],
    ['svg onload', '<svg onload="alert(1)"><script>alert(2)</script></svg>', /svg|onload|alert/i],
    [
      'style tag',
      '<style>@import url(https://evil.test/a.css);p{color:red}</style><p>x</p>',
      /<style|@import|evil/i,
    ],
    ['css url', '<p style="background:url(https://evil.test/a.png)">x</p>', /evil|url\(/i],
    ['css import', '<p style="@import url(https://evil.test)">x</p>', /import|evil/i],
    ['css expression', '<p style="width:expression(alert(1))">x</p>', /expression|alert/i],
    [
      'css escape expression',
      '<p style="width:\\65 xpression(alert(1))">x</p>',
      /xpression|alert/i,
    ],
    ['css behavior', '<p style="behavior:url(x.htc)">x</p>', /behavior|htc/i],
    ['css fixed', '<p style="position:fixed;z-index:99999;color:red">x</p>', /fixed|z-index/i],
    ['css js url', '<p style="background:url(javascript:alert(1))">x</p>', /javascript|alert/i],
    [
      'background attr',
      '<table background="https://evil.test/a.png"><tr><td>x</td></tr></table>',
      /evil|background/i,
    ],
    [
      'srcset',
      '<img srcset="https://evil.test/a.png 1x, https://evil.test/b.png 2x">',
      /evil|srcset/i,
    ],
    [
      'mxss noscript',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
      /onerror|alert/i,
    ],
  ];

  it.each(cases)('neutralises %s', (_name, input, forbidden) => {
    const out = clean(input).html;
    expect(out).not.toMatch(forbidden);
  });

  it('keeps benign content and styles', () => {
    const out = clean('<p style="color: red; font-size:14px">Hi <b>there</b></p>').html;
    expect(out).toContain('<b>there</b>');
    expect(out).toMatch(/color: red/);
    expect(out).toMatch(/font-size: 14px/);
  });
});

describe('remote content blocking', () => {
  it('blocks remote images by default and flags it', () => {
    const r = clean('<img src="https://cdn.test/a.png" width="200" alt="hero">');
    expect(r.html).not.toContain('cdn.test');
    expect(r.html).toContain('alt="hero"');
    expect(r.blockedRemoteContent).toBe(true);
  });

  it('removes tracking pixels entirely', () => {
    const r = clean('<p>x</p><img src="https://t.test/p.gif" width="1" height="1">');
    expect(r.html).not.toContain('<img');
    expect(r.blockedRemoteContent).toBe(true);
  });

  it('blocks srcset, background attr and css url, flagging each', () => {
    expect(clean('<img src="cid:a" srcset="https://x.test/a.png 2x">').blockedRemoteContent).toBe(
      true,
    );
    expect(
      clean('<table background="https://x.test/a.png"><tr><td>x</td></tr></table>')
        .blockedRemoteContent,
    ).toBe(true);
    expect(
      clean('<p style="background:url(https://x.test/a.png)">x</p>').blockedRemoteContent,
    ).toBe(true);
  });

  it('does not flag when nothing remote exists, and keeps cid and data:image', () => {
    const r = clean('<img src="cid:logo"><img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(r.blockedRemoteContent).toBe(false);
    expect(r.html).toContain('cid:logo');
    expect(r.html).toContain('data:image/png');
  });

  it('keeps https images when allowRemoteImages is true', () => {
    const r = clean(
      '<img src="https://cdn.test/a.png"><img src="https://t.test/p.gif" width="1" height="1">',
      true,
    );
    expect(r.html).toContain('https://cdn.test/a.png');
    expect(r.blockedRemoteContent).toBe(false);
  });

  it('still drops javascript urls when remote images are allowed', () => {
    const r = clean(
      '<p style="background:url(javascript:alert(1))">x</p><img src="javascript:alert(1)">',
      true,
    );
    expect(r.html).not.toMatch(/javascript/i);
  });
});

describe('links', () => {
  it('adds rel, removes target, keeps href', () => {
    const out = clean('<a href="https://example.test/x" target="_blank">x</a>').html;
    expect(out).toContain('href="https://example.test/x"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).not.toContain('target');
  });

  it('keeps mailto links', () => {
    expect(clean('<a href="mailto:a@b.test">m</a>').html).toContain('mailto:a@b.test');
  });
});
