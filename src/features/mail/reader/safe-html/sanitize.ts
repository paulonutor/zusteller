import createDOMPurify from 'dompurify';
import { MIN_COLLAPSE_CHARS, countAttributions, isAttribution, quotePreview } from './quotes';

export interface SanitizeOptions {
  allowRemoteImages?: boolean;
  /** The reader is in dark mode: `prefers-color-scheme` rules resolve against this, not the OS. */
  dark?: boolean;
}

export interface SanitizeResult {
  html: string;
  /** Sanitized inline style of the message's own <body>, applied to the wrapper by the frame. */
  bodyStyle: string;
  /** Sanitized `<style>` rules, scoped to the `.mail` wrapper. Empty when the message has none. */
  css: string;
  /** The message ships `prefers-color-scheme: dark` rules, so it can be shown on a dark page. */
  supportsDark: boolean;
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
  'dir', 'lang', 'background', 'class', 'id',
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
  quotes: Set<Element>;
}

let purify: Purify | null = null;
let state: RunState = { allowRemote: false, blocked: false, pixels: new Set(), quotes: new Set() };

function getPurify(): Purify {
  if (purify) return purify;
  const p = createDOMPurify(window);
  // Class and id are stripped by the allowlist, so quote containers are recognised up front.
  p.addHook('beforeSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    const c = node.classList;
    if (
      node.tagName.toLowerCase() === 'blockquote' ||
      c.contains('gmail_quote') ||
      c.contains('yahoo_quoted') ||
      node.id === 'divRplyFwdMsg' ||
      node.id === 'appendonsend'
    ) {
      state.quotes.add(node);
    }
  });
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

function toHttps(url: string): string {
  return url.replace(/^(?:https?:)?\/\//i, 'https://');
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
      if (!state.allowRemote) {
        state.blocked = true;
        img.removeAttribute('src');
        if (isPixel) state.pixels.add(img);
      } else {
        // The CSP only allows https images, so upgrade http: and protocol-relative URLs.
        img.setAttribute('src', toHttps(src));
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
    const ok = state.allowRemote && urls.length > 0 && urls.every((u) => REMOTE_URL.test(u));
    if (ok) {
      img.setAttribute(
        'srcset',
        srcset.replace(/(^|,)(\s*)(\S+)/g, (_m, sep, ws, u) => sep + ws + toHttps(u)),
      );
    } else {
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

/** Returns the safe `prop: value` declaration, or null when it must be dropped. */
function filterDeclaration(prop: string, value: string): string | null {
  if (!/^[a-z-]+$/.test(prop) || prop.startsWith('--')) return null;
  if (DANGEROUS_CSS.test(prop) || DANGEROUS_CSS.test(value)) return null;
  if (prop === 'z-index' || prop === 'content' || prop === 'behavior') return null;
  if (prop === 'position' && /fixed|absolute|sticky/i.test(value)) return null;
  return urlsAllowed(value) ? `${prop}: ${value}` : null;
}

function sanitizeInlineStyle(style: string): string {
  if (style.length > MAX_STYLE_LENGTH) return '';
  const kept: string[] = [];
  for (const raw of splitDeclarations(normalizeCss(style))) {
    const decl = raw.trim();
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const kept1 = filterDeclaration(
      decl.slice(0, idx).trim().toLowerCase(),
      decl.slice(idx + 1).trim(),
    );
    if (kept1) kept.push(kept1);
  }
  return kept.join('; ');
}

const MAX_STYLESHEET_LENGTH = 100_000;
const MAX_STYLE_RULES = 3_000;

/** Splits a selector list on top-level commas (not those inside parens, brackets or quotes). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Confines a selector to the message wrapper; `html`, `body` and `:root` become the wrapper. */
function scopeSelector(selector: string): string {
  const sel = selector.trim();
  if (!sel || /[{}<]/.test(sel)) return '';
  const root = /^(?:html|body|:root)(?![\w-])/i;
  let rest = sel;
  let attached = false;
  let hadRoot = false;
  for (let m = root.exec(rest); m; m = root.exec(rest)) {
    hadRoot = true;
    rest = rest.slice(m[0].length);
    attached = !/^\s/.test(rest);
    rest = rest.trimStart();
  }
  if (!hadRoot) return `.mail ${sel}`;
  if (!rest) return '.mail';
  return attached && /^[.#:[]/.test(rest) ? `.mail${rest}` : `.mail ${rest}`;
}

/**
 * Resolves a media query. Pure colour-scheme queries are decided by the reader theme; anything
 * else that mentions colour scheme or print is dropped. Returns null to drop the block, '' to
 * inline its rules, or the condition text to keep wrapped in @media.
 */
function resolveMedia(text: string, dark: boolean): string | null {
  const t = text.trim().toLowerCase();
  if (/print|url\(|[{}<@\\]/.test(t)) return null;
  if (t.includes('prefers-color-scheme')) {
    const m =
      /^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/.exec(
        t,
      );
    if (!m) return null;
    return (m[1] === 'dark') === dark ? '' : null;
  }
  return /^[a-z0-9\s:()\-.,/<>=]*$/.test(t) ? t : null;
}

interface SheetOutput {
  css: string;
  supportsDark: boolean;
}

function collectRules(
  rules: CSSRuleList,
  dark: boolean,
  out: SheetOutput,
  budget: { rules: number },
): string {
  const parts: string[] = [];
  for (const rule of Array.from(rules)) {
    if (budget.rules-- <= 0) break;
    if (rule instanceof CSSStyleRule) {
      const decls: string[] = [];
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style.item(i).toLowerCase();
        const value = rule.style.getPropertyValue(prop).trim();
        const kept = filterDeclaration(prop, normalizeCss(value));
        if (kept) {
          decls.push(
            kept + (rule.style.getPropertyPriority(prop) === 'important' ? ' !important' : ''),
          );
        }
      }
      if (decls.length === 0) continue;
      const selectors = splitSelectors(rule.selectorText).map(scopeSelector).filter(Boolean);
      if (selectors.length > 0) parts.push(`${selectors.join(', ')}{${decls.join('; ')}}`);
    } else if (rule instanceof CSSMediaRule) {
      const text = rule.media.mediaText;
      if (/prefers-color-scheme\s*:\s*dark/i.test(text)) out.supportsDark = true;
      const condition = resolveMedia(text, dark);
      if (condition === null) continue;
      const inner = collectRules(rule.cssRules, dark, out, budget);
      if (!inner) continue;
      parts.push(condition ? `@media ${condition}{${inner}}` : inner);
    }
    // @import, @font-face, @keyframes, @supports and the rest are dropped.
  }
  return parts.join('\n');
}

/**
 * <style> blocks are removed by the sanitizer. Their rules are re-emitted here through the same
 * declaration filter as inline styles, scoped to `.mail`, so remote loads, positioning tricks
 * and @import stay blocked while class-based layout, media queries and dark mode keep working.
 */
function sanitizeStyleSheets(html: string, dark: boolean): SheetOutput {
  const out: SheetOutput = { css: '', supportsDark: false };
  if (!/<style[\s>]/i.test(html)) return out;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const budget = { rules: MAX_STYLE_RULES };
  const sheets: string[] = [];
  let total = 0;
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const text = style.textContent ?? '';
    total += text.length;
    if (total > MAX_STYLESHEET_LENGTH) break;
    // A constructed sheet is never attached to a document, so nothing is applied or fetched.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    sheets.push(collectRules(sheet.cssRules, dark, out, budget));
  }
  // Keep `</style>` and friends from ever being spelled out in the generated sheet.
  out.css = sheets.filter(Boolean).join('\n').replace(/</g, '\\3c ');
  return out;
}

/** Mail often sets its page background and base font on <body>, which the sanitizer discards. */
function extractBodyStyle(html: string): string {
  if (!/<body[\s>]/i.test(html)) return '';
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const parts: string[] = [];
  const bg = (body.getAttribute('bgcolor') ?? '').trim();
  if (/^#?[0-9a-z]{3,20}$/i.test(bg))
    parts.push(`background-color: ${/^[0-9a-f]{6}$/i.test(bg) ? `#${bg}` : bg}`);
  const own = sanitizeInlineStyle(body.getAttribute('style') ?? '');
  if (own) parts.push(own);
  return sanitizeInlineStyle(parts.join(';'))
    .split(';')
    .map((d) => d.trim())
    .filter((d) =>
      /^(?:background(?:-color)?|color|font(?:-family|-size|-style|-weight)?|line-height|letter-spacing|text-align)\s*:/i.test(
        d,
      ),
    )
    .join('; ');
}

export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): SanitizeResult {
  const p = getPurify();
  state = {
    allowRemote: opts.allowRemoteImages === true,
    blocked: false,
    pixels: new Set(),
    quotes: new Set(),
  };
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
  collapseQuotes(body, state.quotes);
  const sheets = sanitizeStyleSheets(html, opts.dark === true);
  const result = {
    html: body.innerHTML,
    css: sheets.css,
    supportsDark: sheets.supportsDark,
    bodyStyle: extractBodyStyle(html),
    blockedRemoteContent: state.blocked,
  };
  state = { allowRemote: false, blocked: false, pixels: new Set(), quotes: new Set() };
  return result;
}

/**
 * Wraps each outermost quote in a native <details> so it collapses without script. Runs after
 * DOMPurify; only fixed markup and text nodes are generated here.
 */
const MAX_COLLAPSED_QUOTES = 50;

function collapseQuotes(body: HTMLElement, quotes: Set<Element>): void {
  const doc = body.ownerDocument;
  if (quotes.size === 0) return;
  const compact = (t: string | null) => (t ?? '').replace(/\s+/g, '');
  const bodyText = compact(body.textContent);
  let handled = 0;
  for (const el of quotes) {
    if (handled >= MAX_COLLAPSED_QUOTES) break;
    if (!body.contains(el) || el.parentElement?.closest('details.zq')) continue;
    // Apple Mail puts the "On … wrote:" line in a sibling just before the blockquote.
    const prev = el.previousElementSibling;
    const attribution =
      prev && quotes.size > 0 && !quotes.has(prev) && isAttribution(blockText(prev)) ? prev : null;
    const text = (attribution ? `${blockText(attribution)}\n` : '') + blockText(el);
    if (
      text.replace(/\s+/g, ' ').length < MIN_COLLAPSE_CHARS ||
      compact(el.textContent) === bodyText
    )
      continue;
    handled++;

    const details = doc.createElement('details');
    details.className = 'zq';
    const summary = doc.createElement('summary');
    const chevron = doc.createElement('span');
    chevron.className = 'zq-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const count = doc.createElement('span');
    count.className = 'zq-count';
    count.textContent = `${countAttributions(text)} earlier`;
    const preview = doc.createElement('span');
    preview.className = 'zq-preview';
    preview.textContent = quotePreview(text);
    summary.append(chevron, count, preview);
    el.replaceWith(details);
    details.append(summary);
    if (attribution) details.append(attribution);
    details.append(el);
  }
}

/** Text content with a line break after each block element, so attributions sit on their own line. */
function blockText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll('div,p,br,li,tr,blockquote,h1,h2,h3,h4,h5,h6')) {
    node.after('\n');
  }
  return (clone.textContent ?? '').replace(/[ \t]+/g, ' ').trim();
}
