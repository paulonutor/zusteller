import { describe, expect, it } from 'vitest';
import { splitPlainTextQuotes } from './quotes';
import { sanitizeEmailHtml } from './sanitize';

describe('splitPlainTextQuotes', () => {
  it('groups the attribution with its quoted lines and keeps text between quotes', () => {
    const text = [
      'Yes.',
      '',
      'On Mon, 5 Oct 2026 at 14:20, Lena Hoffmann <lena@x.test> wrote:',
      '> first',
      '',
      '> second',
      'Inline answer',
      '> third',
      'Bye',
    ].join('\n');
    const kinds = splitPlainTextQuotes(text).map((s) => s.kind);
    expect(kinds).toEqual(['text', 'quote', 'text', 'quote', 'text']);
    const quote = splitPlainTextQuotes(text)[1];
    expect(quote).toMatchObject({
      kind: 'quote',
      count: 1,
      preview: 'Lena Hoffmann: first second',
    });
  });

  it('handles wrapped and German attributions and counts nested ones', () => {
    const text = [
      'Ok',
      'Am 04.10.2026 um 18:42 schrieb Daniel Reuter <d@x.test>:',
      '> Hallo',
      '> Am 03.10.2026 um 10:00 schrieb Paul <p@x.test>:',
      '>> Servus',
    ].join('\n');
    const quote = splitPlainTextQuotes(text)[1];
    expect(quote).toMatchObject({ kind: 'quote', count: 2 });
    expect(quote && quote.kind === 'quote' && quote.preview).toMatch(/^Daniel Reuter: Hallo/);
  });
});

describe('sanitizeEmailHtml quote collapsing', () => {
  const long = 'This is a long quoted paragraph that should be collapsed behind a bar. '.repeat(3);

  it('wraps a gmail quote in details and keeps text after it visible', () => {
    const html = `<div>Reply</div><div class="gmail_quote"><div>On Mon, Max Müller &lt;m@x.test&gt; wrote:</div><blockquote>${long}</blockquote></div><div>After the quote</div>`;
    const doc = new DOMParser().parseFromString(sanitizeEmailHtml(html).html, 'text/html');
    const details = doc.querySelectorAll('details.zq');
    expect(details).toHaveLength(1);
    expect(details[0]?.querySelector('.zq-preview')?.textContent).toContain('Max Müller:');
    expect(details[0]?.nextElementSibling?.textContent).toBe('After the quote');
  });

  it('collapses only the outermost quote and leaves short or sole quotes alone', () => {
    const nested = `<p>Hi</p><blockquote>${long}<blockquote>${long}</blockquote></blockquote>`;
    expect(sanitizeEmailHtml(nested).html.match(/<details/g)).toHaveLength(1);
    expect(sanitizeEmailHtml('<p>Hi</p><blockquote>short</blockquote>').html).not.toContain(
      '<details',
    );
    expect(sanitizeEmailHtml(`<blockquote>${long}</blockquote>`).html).not.toContain('<details');
  });
});
