import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import type { PlatformService } from '@/platform';

let mail: MockMailService;

function setup(opts: { offline?: boolean } = {}) {
  mail = new MockMailService(createSeedData(), { latency: 0 });
  if (opts.offline) mail.setOffline(true);
  const platform: PlatformService = {
    showNotification: vi.fn().mockResolvedValue(undefined),
    setBadge: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    setWindowTheme: vi.fn().mockResolvedValue(undefined),
    subscribeMenuActions: () => () => {},
  };
  const user = userEvent.setup();
  render(<App services={{ mail, platform }} />);
  return user;
}

const rows = () => screen.queryAllByRole('option');
const waitForRows = () => waitFor(() => expect(rows().length).toBeGreaterThan(0));

/**
 * axe in jsdom: structure/ARIA/name rules only. Colour contrast needs real layout and is covered
 * by `npm run a11y` (Playwright); `region` is a page-level rule that jsdom's body can't satisfy.
 */
async function expectNoViolations() {
  const res = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(
    res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

beforeEach(() => localStorage.clear());

describe('axe (structure, names, roles)', () => {
  it('inbox idle', async () => {
    setup();
    await waitForRows();
    await expectNoViolations();
  });

  it('thread open', async () => {
    const user = setup();
    await waitForRows();
    await user.click(rows()[0]!);
    await screen.findAllByRole('article');
    await expectNoViolations();
  });

  it('multi-selection', async () => {
    const user = setup();
    await waitForRows();
    await user.click(rows()[0]!);
    await user.keyboard('{Shift>}');
    await user.click(rows()[2]!);
    await user.keyboard('{/Shift}');
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    await expectNoViolations();
  });

  it('labels menu open', async () => {
    const user = setup();
    await waitForRows();
    await user.click(rows()[0]!);
    await user.click(await screen.findByRole('button', { name: 'Labels' }));
    await screen.findByRole('menu');
    await expectNoViolations();
  });

  it('empty search result', async () => {
    const user = setup();
    await waitForRows();
    await user.type(screen.getByRole('searchbox'), 'zzzzqqqq');
    await screen.findByText(/No results for/);
    expect(screen.queryByRole('listbox')).toBeNull(); // no options => no listbox
    await expectNoViolations();
  });

  it('loading / offline', async () => {
    setup({ offline: true });
    await screen.findByText('Loading conversations');
    await expectNoViolations();
  });
});

describe('keyboard-only walkthrough', () => {
  // Press Tab until `pred` matches the focused element (bounded, so a trap fails the test).
  async function tabTo(user: ReturnType<typeof userEvent.setup>, pred: (e: Element) => boolean) {
    for (let i = 0; i < 40; i++) {
      await user.tab();
      if (document.activeElement && pred(document.activeElement)) return document.activeElement;
    }
    throw new Error(`Never reached target; stuck on ${document.activeElement?.outerHTML}`);
  }
  const named = (name: string) => (e: Element) => e.getAttribute('aria-label') === name;

  it('reaches every region, filters, stars, labels and archives without a mouse', async () => {
    const user = setup();
    await waitForRows();

    // Sidebar: first tab stop is a mailbox button; the appearance radiogroup is a single stop.
    await tabTo(user, (e) => e.textContent?.startsWith('Inbox') === true);
    await tabTo(user, (e) => e.getAttribute('role') === 'radio');
    expect(document.activeElement).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowLeft}'); // back to the original preference, focus follows
    expect(document.activeElement).toHaveAttribute('role', 'radio');

    // Search.
    await tabTo(user, (e) => e.getAttribute('type') === 'search');
    await user.keyboard('{Tab}'); // not trapped by the search box (nothing typed => no clear button)

    // Filter tabs: roving tabindex, arrows move focus, Enter activates.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(tabs[2]).toHaveFocus();
    await user.keyboard('{Home}{Enter}');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await user.tab(); // leaves the tablist (one stop), lands on select-all
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveFocus();

    // List: arrow to a row, star with S, open with Enter.
    const list = screen.getByRole('listbox');
    await tabTo(user, (e) => e === list);
    await user.keyboard('{ArrowDown}');
    const first = rows()[0]!;
    expect(list).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('s');
    await waitFor(() => expect(within(rows()[0]!).getByText(/^Starred,/)).toBeInTheDocument());
    await user.keyboard('{Enter}');
    await screen.findAllByRole('article');

    // Reader toolbar reachable from the list; label via the Labels menu.
    await tabTo(user, named('Labels'));
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0);
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // Focus returns to the trigger (no trap).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Labels' })).toHaveFocus());

    // Archive via the toolbar button (keyboard activation).
    const subject = first.textContent;
    screen.getByRole('button', { name: 'Archive' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(rows().some((r) => r.textContent === subject)).toBe(false));
  });

  it('plain-key shortcut archives the focused row too', async () => {
    const user = setup();
    await waitForRows();
    const before = rows().length;
    screen.getByRole('listbox').focus();
    await user.keyboard('{ArrowDown}e');
    await waitFor(() => expect(rows().length).toBe(before - 1));
  });
});
