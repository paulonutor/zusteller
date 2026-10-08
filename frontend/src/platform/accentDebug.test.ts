import { describe, expect, it } from 'vitest';
import { showAccentDebug, wantsAccentDebug } from './accentDebug';

describe('accent debug panel', () => {
  it('is opt-in via ?debug=accent', () => {
    expect(wantsAccentDebug('?debug=accent')).toBe(true);
    expect(wantsAccentDebug('?debug=other')).toBe(false);
    expect(wantsAccentDebug('')).toBe(false);
  });

  it('renders every probed keyword and the effective --accent', () => {
    Object.assign(CSS, { supports: (_p: string, v: string) => v === 'AccentColor' });
    showAccentDebug('?debug=accent');
    const panel = document.querySelector('[role="status"]');
    expect(panel?.textContent).toContain('AccentColor');
    expect(panel?.textContent).toContain('-apple-system-control-accent: unsupported');
    expect(panel?.textContent).toContain('--accent =');
    panel?.remove();
  });
});
