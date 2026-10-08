import createDOMPurify from 'dompurify';

export interface SanitizeOptions {
  allowRemoteImages?: boolean;
}

export interface SanitizeResult {
  html: string;
  blockedRemoteContent: boolean;
}

const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'big', 'blockquote', 'br', 'caption', 'center',
  'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'font', 'footer', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'li', 'main', 'mark', 'nav',
  'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strike', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul', 'wbr',
]; // prettier-ignore

const ALLOWED_ATTR = [
  'href', 'src', 'srcset', 'alt', 'title', 'width', 'height', 'align', 'valign', 'bgcolor',
  'color', 'face', 'size', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'style',
  'dir', 'lang', 'background',
]; // prettier-ignore

const FORBID_CONTENTS = [
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'title',
  'svg', 'math', 'head', 'form', 'select', 'frameset', 'frame', 'applet', 'xmp', 'noembed',
  'noframes', 'plaintext',
]; // prettier-ignore

// Anything with another scheme (javascript:, vbscript:, data:text/html, ...) or a relative path is
// dropped by DOMPurify. Remote images are handled separately in the attribute hook.
const URI_REGEXP = /^(?:(?:https?|mailto|cid):|data:image\/|#|\/\/)/i;
const LINK_REGEXP = /^(?:https?:|mailto:)/i;
const RASTER_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon);/i;
const REMOTE_URL = /^(?:https?:)?\/\//i;

type Purify = ReturnType<typeof createDOMPurify>;

interface RunState {
  allowRemote: boolean;
  blocked: boolean;
  pixels: Set<Element>;
}

let purify: Purify | null = null;
let state: RunState = { allowRemote: false, blocked: false, pixels: new Set() };

function getPurify(): Purify {
  if (purify) return purify;
  const p = createDOMPurify(window);
  p.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'a') {
      const href = node.getAttribute('href');
      if (href !== null && !LINK_REGEXP.test(stripControl(href))) {
        node.removeAttribute('href');
      }
      node.removeAttribute('target');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }

    if (tag === 'img') handleImage(node);

    if (node.hasAttribute('background')) {
      const value = (node.getAttribute('background') ?? '').trim();
      if (REMOTE_URL.test(value)) {
        if (!state.allowRemote || /^\/\//.test(value)) {
          state.blocked = true;
          node.removeAttribute('background');
        }
      } else if (!RASTER_DATA_URI.test(value) && !/^cid:/i.test(value)) {
        node.removeAttribute('background');
      }
    }

    if (node.hasAttribute('style')) {
      const cleaned = sanitizeInlineStyle(node.getAttribute('style') ?? '');
      if (cleaned) node.setAttribute('style', cleaned);
      else node.removeAttribute('style');
    }
  });
  purify = p;
  return p;
}

function stripControl(value: string): string {
  return value
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 0x20)
    .join('');
}

function isTinyDimension(value: string | null): boolean {
  if (value === null) return false;
  const n = parseInt(value, 10);
  return !Number.isNaN(n) && n <= 1;
}

function handleImage(img: Element) {
  const src = (img.getAttribute('src') ?? '').trim();
  if (src) {
    if (REMOTE_URL.test(src)) {
      const isPixel =
        isTinyDimension(img.getAttribute('width')) ||
        isTinyDimension(img.getAttribute('height')) ||
        /(?:^|;)\s*(?:width|height)\s*:\s*[01](?:px)?\s*(?:;|$)/i.test(
          img.getAttribute('style') ?? '',
        );
      if (!state.allowRemote || /^\/\//.test(src)) {
        state.blocked = true;
        img.removeAttribute('src');
        if (isPixel) state.pixels.add(img);
      }
    } else if (!/^cid:/i.test(src) && !RASTER_DATA_URI.test(src)) {
      img.removeAttribute('src');
    }
  }
  const srcset = img.getAttribute('srcset');
  if (srcset !== null) {
    const urls = srcset
      .split(',')
      .map((c) => c.trim().split(/\s+/)[0] ?? '')
      .filter(Boolean);
    const ok = state.allowRemote && urls.length > 0 && urls.every((u) => /^https?:\/\//i.test(u));
    if (!ok) {
      if (urls.some((u) => REMOTE_URL.test(u))) state.blocked = true;
      img.removeAttribute('srcset');
    }
  }
}

/** Splits a declaration list on top-level semicolons (ignoring those in parens/quotes). */
function splitDeclarations(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function normalizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/\\/g, '')
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 0x1f || ch === '\t' || ch === '\n' || ch === '\r')
    .join('');
}

const DANGEROUS_CSS =
  /expression\s*\(|behaviou?r\s*:|-moz-binding|javascript:|vbscript:|@import|@charset|image-set\s*\(|\bsrc\s*\(|-webkit-image-set/i;

/** Inline styles larger than this are dropped wholesale (bounds all per-declaration work). */
const MAX_STYLE_LENGTH = 8_000;

/**
 * Linear-time check of every `url(...)` token in a declaration value. Returns false when any
 * URL is not allowed (or a `url(` is unterminated). Records blocked remote content in `state`.
 */
function urlsAllowed(value: string): boolean {
  const lower = value.toLowerCase();
  let ok = true;
  let from = 0;
  for (;;) {
    const start = lower.indexOf('url(', from);
    if (start < 0) return ok;
    let i = start + 4;
    while (i < value.length && /\s/.test(value[i] ?? '')) i++;
    const q = value[i] === '"' || value[i] === "'" ? (value[i] as string) : '';
    let url: string;
    let end: number;
    if (q) {
      const close = value.indexOf(q, i + 1);
      if (close < 0) return false;
      url = value.slice(i + 1, close);
      end = close + 1;
      while (end < value.length && /\s/.test(value[end] ?? '')) end++;
      if (value[end] !== ')') return false;
    } else {
      const close = value.indexOf(')', i);
      if (close < 0) return false;
      url = value.slice(i, close);
      end = close;
    }
    url = url.trim();
    if (REMOTE_URL.test(url)) {
      state.blocked = true;
      if (!state.allowRemote || /^\/\//.test(url)) ok = false;
    } else if (!/^cid:/i.test(url) && !RASTER_DATA_URI.test(url)) {
      ok = false;
    }
    from = end + 1;
  }
}

function sanitizeInlineStyle(style: string): string {
  if (style.length > MAX_STYLE_LENGTH) return '';
  const kept: string[] = [];
  for (const raw of splitDeclarations(normalizeCss(style))) {
    const decl = raw.trim();
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!/^[a-z-]+$/.test(prop) || prop.startsWith('--')) continue;
    if (DANGEROUS_CSS.test(prop) || DANGEROUS_CSS.test(value)) continue;
    if (prop === 'z-index' || prop === 'content' || prop === 'behavior') continue;
    if (prop === 'position' && /fixed|absolute|sticky/i.test(value)) continue;

    const ok = urlsAllowed(value);
    if (ok) kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): SanitizeResult {
  const p = getPurify();
  state = { allowRemote: opts.allowRemoteImages === true, blocked: false, pixels: new Set() };
  const body: HTMLElement = p.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: URI_REGEXP,
    ADD_URI_SAFE_ATTR: ALLOWED_ATTR.filter(
      (a) => !['href', 'src', 'srcset', 'background'].includes(a),
    ),
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_CONTENTS,
    RETURN_DOM: true,
  }) as HTMLElement;
  for (const pixel of state.pixels) pixel.remove();
  const result = { html: body.innerHTML, blockedRemoteContent: state.blocked };
  state = { allowRemote: false, blocked: false, pixels: new Set() };
  return result;
}
