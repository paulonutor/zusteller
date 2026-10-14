import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlainTextBody } from './PlainTextBody';

describe('PlainTextBody', () => {
  it('linkifies http(s) urls without trailing punctuation and calls onOpenLink', () => {
    const onOpenLink = vi.fn();
    render(
      <PlainTextBody
        text={'See https://example.test/a?b=1, or http://x.test.'}
        onOpenLink={onOpenLink}
      />,
    );
    const first = screen.getByText('https://example.test/a?b=1');
    expect(first.tagName).toBe('A');
    expect(fireEvent.click(first)).toBe(false); // default prevented
    expect(onOpenLink).toHaveBeenCalledWith('https://example.test/a?b=1');
    fireEvent.click(screen.getByText('http://x.test'));
    expect(onOpenLink).toHaveBeenLastCalledWith('http://x.test');
  });

  it('does not linkify javascript: or other schemes', () => {
    const { container } = render(
      <PlainTextBody
        text={'javascript:alert(1) data:text/html,x ftp://a.test'}
        onOpenLink={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('javascript:alert(1)');
  });

  it('mutes quoted lines and preserves whitespace', () => {
    const { container } = render(
      <PlainTextBody text={'hello\n> quoted\n\n  indented'} onOpenLink={vi.fn()} />,
    );
    const quotes = container.querySelectorAll('.plain-text-quote');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.textContent).toBe('> quoted');
    expect((container.firstChild as HTMLElement).style.whiteSpace).toBe('pre-wrap');
    expect(container.textContent).toContain('  indented');
  });

  it('collapses a long quote behind a toggle and keeps text after it visible', () => {
    const text = [
      'Reply',
      'On Mon, 5 Oct 2026 at 14:20, Lena <l@x.test> wrote:',
      '> one',
      '> two',
      '> three',
      'Inline answer',
    ].join('\n');
    render(<PlainTextBody text={text} onOpenLink={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Show quoted text' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('> two')).toBeNull();
    expect(screen.getByText('Inline answer')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('> two')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not collapse a body that is only a quote', () => {
    render(<PlainTextBody text={'> one\n> two\n> three\n> four'} onOpenLink={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('> four')).toBeInTheDocument();
  });
});
