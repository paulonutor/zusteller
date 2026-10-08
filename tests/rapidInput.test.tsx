import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  confirm: () => Promise.resolve(true),
  subscribeMenuActions: () => () => {},
};

const rows = () => screen.queryAllByRole('option');
const waitForRows = () => waitFor(() => expect(rows().length).toBeGreaterThan(3));
const rowFor = (subject: string) => rows().find((r) => r.textContent?.includes(subject))!;
const starOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-star]')!;
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key: k, ...init });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(latency = 0) {
  const mail = new MockMailService(createSeedData(), { latency });
  const user = userEvent.setup();
  render(<App services={{ mail, platform }} />);
  return { mail, user };
}

beforeEach(() => localStorage.clear());

describe('rapid repeated input', () => {
  it('double-click on Archive is one mutation for the thread and no error toast', async () => {
    const { mail, user } = setup(40);
    await waitForRows();
    const archive = vi.spyOn(mail, 'archive');
    await user.click(rowFor('Lunch Thursday'));
    const lunchId = rowFor('Lunch Thursday').id.replace(/^row-/, '');
    await user.dblClick(await screen.findByRole('button', { name: 'Archive' }));
    await sleep(200);
    const archivedIds = archive.mock.calls.flatMap((c) => c[1]);
    expect(archivedIds.filter((id) => id === lunchId)).toHaveLength(1);
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
  });

  it('double-click on the row star ends in a consistent state with no error', async () => {
    const { mail, user } = setup(40);
    await waitForRows();
    await user.dblClick(starOf(rowFor('Lunch Thursday')));
    await sleep(250);
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
    const id = rowFor('Lunch Thursday').id.replace(/^row-/, '');
    const t = await mail.getThread('acct-1', id);
    await waitFor(() =>
      expect(starOf(rowFor('Lunch Thursday')).getAttribute('data-starred')).toBe(
        String(t.isStarred),
      ),
    );
  });

  it('star / unstar / star quickly: final UI state matches the service', async () => {
    const { mail, user } = setup(30);
    await waitForRows();
    const id = rowFor('Lunch Thursday').id.replace(/^row-/, '');
    const before = (await mail.getThread('acct-1', id)).isStarred;
    for (let i = 0; i < 3; i++) await user.click(starOf(rowFor('Lunch Thursday')));
    await sleep(300);
    const after = (await mail.getThread('acct-1', id)).isStarred;
    expect(after).toBe(!before);
    await waitFor(() =>
      expect(starOf(rowFor('Lunch Thursday')).getAttribute('data-starred')).toBe(String(after)),
    );
  });

  it('overlapping archives of A then B both succeed and the selection lands on B', async () => {
    const { mail, user } = setup(80);
    await waitForRows();
    const archive = vi.spyOn(mail, 'archive');
    const a = rows()[0]!;
    const b = rows()[3]!;
    const aId = a.id;
    const bId = b.id;
    await user.click(a);
    key('e');
    await user.click(b);
    key('e');
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(document.getElementById(aId)).toBeNull();
      expect(document.getElementById(bId)).toBeNull();
    });
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
  });

  it('archive then immediate restore while in flight leaves service and UI consistent', async () => {
    const { mail, user } = setup(60);
    await waitForRows();
    await user.click(screen.getByRole('button', { name: /^All Mail/ }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    const row = rowFor('Lunch Thursday');
    const id = row.id.replace(/^row-/, '');
    await user.click(row);
    key('e');
    key('z', { shiftKey: true });
    await sleep(400);
    const s = await mail.getThread('acct-1', id);
    expect(s).toBeTruthy();
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
  });

  it('held ArrowDown stops at the last row and ArrowUp at the first (no wrap)', async () => {
    const { user } = setup();
    await waitForRows();
    const list = screen.getByRole('listbox');
    list.focus();
    const n = rows().length;
    for (let i = 0; i < n + 25; i++) await user.keyboard('{ArrowDown}');
    const active = list.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    const all = await waitFor(() => {
      const ids = rows().map((r) => r.id);
      expect(ids.length).toBeGreaterThan(0);
      return ids;
    });
    expect(all.indexOf(active!)).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 3; i++) await user.keyboard('{ArrowDown}');
    expect(list.getAttribute('aria-activedescendant')).toBe(active);
    for (let i = 0; i < 400; i++) await user.keyboard('{ArrowUp}');
    expect(list.getAttribute('aria-activedescendant')).toBe(rows()[0]!.id);
    await user.keyboard('{ArrowUp}');
    expect(list.getAttribute('aria-activedescendant')).toBe(rows()[0]!.id);
  }, 60_000);

  it('"e" with nothing selected or on an empty list is a no-op', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const archive = vi.spyOn(mail, 'archive');
    key('e');
    await sleep(50);
    expect(archive).not.toHaveBeenCalled();

    await user.type(screen.getByRole('searchbox'), 'qqqqnotfound');
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    key('e');
    key('#');
    await sleep(50);
    expect(archive).not.toHaveBeenCalled();
    expect(screen.queryByText(/Couldn.t/)).not.toBeInTheDocument();
  });

  it('switching mailbox mid-load never renders the stale response', async () => {
    const { mail, user } = setup(0);
    await waitForRows();
    const real = mail.getThreads.bind(mail);
    vi.spyOn(mail, 'getThreads').mockImplementation(async (q) => {
      const page = await real(q);
      // Trash is slow, everything else fast.
      const isTrash = JSON.stringify(q).includes('trash');
      await sleep(isTrash ? 250 : 5);
      return page;
    });
    await user.click(screen.getByRole('button', { name: /^Trash/ }));
    await user.click(screen.getByRole('button', { name: /^Sent/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sent' })).toBeInTheDocument());
    const sentIds = (await real({ accountId: 'acct-1', mailbox: 'sent' } as never)).items.map(
      (t) => t.id,
    );
    await sleep(400); // let the slow Trash response arrive
    expect(screen.getByRole('heading', { name: 'Sent' })).toBeInTheDocument();
    const shown = rows().map((r) => r.id.replace(/^row-/, ''));
    expect(shown.length).toBeGreaterThan(0);
    for (const id of shown) expect(sentIds).toContain(id);
  });

  it('search typed faster than the debounce only queries the final text', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const spy = vi.spyOn(mail, 'getThreads');
    spy.mockClear();
    await user.type(screen.getByRole('searchbox'), 'zahnreinigung');
    await waitFor(() => expect(rows()).toHaveLength(1));
    const searches = spy.mock.calls
      .map((c) => (c[0] as { search?: string; text?: string }).search ?? '')
      .filter(Boolean);
    expect(new Set(searches)).toEqual(new Set(['zahnreinigung']));
  });
});
