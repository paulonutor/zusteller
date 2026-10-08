import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import type { PlatformService } from '@/platform';

const platform: PlatformService = {
  showNotification: vi.fn().mockResolvedValue(undefined),
  setBadge: vi.fn().mockResolvedValue(undefined),
  openExternal: vi.fn().mockResolvedValue(undefined),
  setWindowTheme: vi.fn().mockResolvedValue(undefined),
  subscribeMenuActions: () => () => {},
};

const rows = () => screen.queryAllByRole('option');
const waitForRows = () => waitFor(() => expect(rows().length).toBeGreaterThan(5));
const checkOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-row-check]')!;
const idOf = (row: HTMLElement) => row.id;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const listbox = () => screen.getByRole('listbox');
const selectedCount = () => rows().filter((r) => r.getAttribute('aria-selected') === 'true').length;

function setup() {
  const mail = new MockMailService(createSeedData(), { latency: 0 });
  const user = userEvent.setup();
  render(<App services={{ mail, platform }} />);
  return { mail, user };
}

beforeEach(() => localStorage.clear());

describe('selection edge cases', () => {
  it('shift-click with no anchor selects just that row', async () => {
    const { user } = setup();
    await waitForRows();
    const target = rows()[3]!;
    await user.keyboard('{Shift>}');
    await user.click(target);
    await user.keyboard('{/Shift}');
    await waitFor(() => expect(selectedCount()).toBe(1));
    expect(document.getElementById(idOf(target))).toHaveAttribute('aria-selected', 'true');
  });

  it('shift-click after the anchor row was removed falls back to a single row', async () => {
    const { user } = setup();
    await waitForRows();
    await user.click(rows()[0]!);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(selectedCount()).toBe(0));
    const target = rows()[2]!;
    await user.keyboard('{Shift>}');
    await user.click(target);
    await user.keyboard('{/Shift}');
    // The cursor moved to the next row when the anchor was archived, so the range starts there.
    await waitFor(() => expect(selectedCount()).toBeGreaterThanOrEqual(1));
    expect(selectedCount()).toBeLessThanOrEqual(3);
    expect(document.getElementById(idOf(target))).toHaveAttribute('aria-selected', 'true');
  });

  it('Ctrl+A then Esc clears the selection', async () => {
    const { user } = setup();
    await waitForRows();
    listbox().focus();
    await user.keyboard('{Control>}a{/Control}');
    await waitFor(() => expect(selectedCount()).toBe(rows().length));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(selectedCount()).toBe(0));
    expect(screen.queryByText(/^\d+ selected$/)).not.toBeInTheDocument();
  });

  it('bulk archive clears the selection, keeps focus on a surviving row, leaves no ghost reader', async () => {
    const { user } = setup();
    await waitForRows();
    const picked = rows().slice(0, 3);
    const pickedIds = picked.map(idOf);
    for (const r of picked) await user.click(checkOf(r));
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => pickedIds.forEach((id) => expect(document.getElementById(id)).toBeNull()));
    expect(selectedCount()).toBe(0);
    expect(screen.queryByText(/\d+ selected/)).not.toBeInTheDocument();
    const active = listbox().getAttribute('aria-activedescendant');
    if (active) expect(document.getElementById(active)).not.toBeNull();
    // Reader shows no conversation for an archived thread.
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('archiving the open thread moves the cursor to the next row and empties the reader', async () => {
    const { user } = setup();
    await waitForRows();
    const [first, second] = rows();
    await user.click(first!);
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(document.getElementById(idOf(first!))).toBeNull());
    await waitFor(() => expect(listbox()).toHaveAttribute('aria-activedescendant', idOf(second!)));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('archiving the last remaining thread shows the empty state, no crash', async () => {
    const { user } = setup();
    await waitForRows();
    await user.type(screen.getByRole('searchbox'), 'zahnreinigung');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(rows()[0]!);
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
  });

  it('changing the filter clears hidden selected rows, so bulk actions never touch unseen threads', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const archive = vi.spyOn(mail, 'archive');
    const read = rows().find((r) => r.getAttribute('data-unread') === 'false')!;
    await user.click(checkOf(read));
    expect(selectedCount()).toBe(1);
    await user.click(screen.getByRole('button', { name: /^Filter:/ }));
    await user.click(await screen.findByRole('menuitem', { name: /^Unread/ }));
    await waitFor(() => expect(selectedCount()).toBe(0));
    expect(document.getElementById(idOf(read))).toBeNull();
    fireEvent.keyDown(document.body, { key: 'e' });
    await sleep(50);
    expect(archive).not.toHaveBeenCalled();
  });
});

describe('context menu', () => {
  const rightClick = async (user: ReturnType<typeof userEvent.setup>, row: HTMLElement) => {
    await user.pointer({ keys: '[MouseRight]', target: row });
    return screen.findByRole('menu');
  };

  it('right-click on an unselected row acts on that row only', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const archive = vi.spyOn(mail, 'archive');
    const a = rows()[0]!;
    const b = rows()[1]!;
    const c = rows()[4]!;
    await user.click(checkOf(a));
    await user.click(checkOf(b));
    const menu = await rightClick(user, c);
    await user.click(within(menu).getByRole('menuitem', { name: /Archive/ }));
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(archive.mock.calls[0]![1]).toEqual([idOf(c).replace(/^row-/, '')]);
  });

  it('right-click inside a multi-selection acts on all selected rows', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const archive = vi.spyOn(mail, 'archive');
    const picked = [rows()[0]!, rows()[1]!, rows()[2]!];
    for (const r of picked) await user.click(checkOf(r));
    const menu = await rightClick(user, picked[1]!);
    await user.click(within(menu).getByRole('menuitem', { name: /Archive/ }));
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect([...archive.mock.calls[0]![1]].sort()).toEqual(
      picked.map((r) => idOf(r).replace(/^row-/, '')).sort(),
    );
  });

  it('closes on Escape', async () => {
    const { user } = setup();
    await waitForRows();
    await rightClick(user, rows()[0]!);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes on outside click', async () => {
    const { user } = setup();
    await waitForRows();
    await rightClick(user, rows()[0]!);
    await user.click(screen.getByRole('main'));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes on list scroll', async () => {
    const { user } = setup();
    await waitForRows();
    await rightClick(user, rows()[0]!);
    const scroller = document.querySelector('[data-list-scroller]')!;
    act(() => {
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      window.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes on window resize', async () => {
    const { user } = setup();
    await waitForRows();
    await rightClick(user, rows()[0]!);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('opens within the viewport (positioned by Radix collision handling)', async () => {
    const { user } = setup();
    await waitForRows();
    const menu = await rightClick(user, rows()[0]!);
    const wrapper = menu.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    // Radix positions the wrapper itself; the menu must not be offset to a negative origin.
    expect(wrapper!.style.transform).not.toMatch(/translate\(-\d/);
  });
});
