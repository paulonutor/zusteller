/** Quote detection shared by the plain-text and HTML readers. */

/** A single-line "On <date>, <name> wrote:" / "Am <date> schrieb <name>:" attribution. */
const ATTRIBUTION = /^(?:On|Am)\s.+\b(?:wrote|schrieb)\b.*:\s*$/i;
const QUOTE_PREFIX = /^(?:\s*>)+ ?/;
const SENDER = /,\s*([^<>,:]+?)\s*(?:<[^>]*>)?\s*(?:wrote|schrieb)\b/i;
const SENDER_DE = /\bschrieb\s+([^<>,:]+?)\s*(?:<[^>]*>)?\s*:/i;

/** Quotes shorter than this many non-blank lines (or characters in HTML) stay expanded. */
export const MIN_COLLAPSE_LINES = 3;
export const MIN_COLLAPSE_CHARS = 120;
const PREVIEW_LENGTH = 140;

export type PlainSegment =
  | { kind: 'text'; lines: string[] }
  | { kind: 'quote'; lines: string[]; count: number; preview: string };

const isQuoteLine = (line: string): boolean => /^\s*>/.test(line);
const isBlank = (line: string): boolean => line.trim() === '';
const stripQuote = (line: string): string => line.replace(QUOTE_PREFIX, '');

export const isAttribution = (line: string): boolean => ATTRIBUTION.test(line.trim());

export function countAttributions(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) if (ATTRIBUTION.test(stripQuote(line).trim())) n++;
  return Math.max(1, n);
}

/** "Name: first words of the quoted text", with the attribution line removed. */
export function quotePreview(text: string): string {
  const flat = text
    .split('\n')
    .map((l) => stripQuote(l).trim())
    .filter(Boolean);
  const attr = flat.find((l) => ATTRIBUTION.test(l));
  const name = attr ? (SENDER.exec(attr)?.[1] ?? SENDER_DE.exec(attr)?.[1] ?? '') : '';
  const body = flat
    .filter((l) => !ATTRIBUTION.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const excerpt = body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH)}…` : body;
  return name ? `${name}: ${excerpt}` : excerpt;
}

/** Length of an attribution starting at `i` (1 or 2 wrapped lines), or 0. */
function attributionLength(lines: string[], i: number): number {
  const first = (lines[i] ?? '').trim();
  if (!/^(?:On|Am)\s/i.test(first) || isQuoteLine(first)) return 0;
  if (ATTRIBUTION.test(first)) return 1;
  const next = lines[i + 1];
  if (next !== undefined && !isQuoteLine(next) && ATTRIBUTION.test(`${first} ${next.trim()}`)) {
    return 2;
  }
  return 0;
}

/** Splits a plain-text body into alternating text and quote segments (inline replies). */
export function splitPlainTextQuotes(text: string): PlainSegment[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: PlainSegment[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length) out.push({ kind: 'text', lines: pending });
    pending = [];
  };

  let i = 0;
  while (i < lines.length) {
    const attr = attributionLength(lines, i);
    const afterAttr = lines[i + attr];
    const starts =
      attr > 0 ? afterAttr !== undefined && isQuoteLine(afterAttr) : isQuoteLine(lines[i] ?? '');
    if (!starts) {
      pending.push(lines[i] ?? '');
      i++;
      continue;
    }
    flush();
    const block = lines.slice(i, i + attr);
    i += attr;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (isQuoteLine(line)) {
        block.push(line);
        i++;
        continue;
      }
      // A blank line between two quoted lines belongs to the quote.
      let j = i;
      while (j < lines.length && isBlank(lines[j] ?? '')) j++;
      if (j > i && j < lines.length && isQuoteLine(lines[j] ?? '')) {
        block.push(...lines.slice(i, j));
        i = j;
        continue;
      }
      break;
    }
    const joined = block.join('\n');
    out.push({
      kind: 'quote',
      lines: block,
      count: countAttributions(joined),
      preview: quotePreview(joined),
    });
  }
  flush();
  return out;
}

/** True when the quote is long enough to collapse. */
export const isCollapsibleQuote = (lines: string[]): boolean =>
  lines.filter((l) => !isBlank(l)).length >= MIN_COLLAPSE_LINES;
