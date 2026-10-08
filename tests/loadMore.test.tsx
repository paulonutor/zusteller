import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { MAX_AUTO_PAGES } from '@/features/mail/list/ThreadList';
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => localStorage.clear());

describe('load more', () => {
  it('does not loop when a follow-up page fails', async () => {
    const mail = new MockMailService(createSeedData(), { latency: 0 });
    const real = mail.getThreads.bind(mail);
    const spy = vi.spyOn(mail, 'getThreads').mockImplementation((q) => {
      if (q.cursor) return Promise.reject(new Error('boom'));
      return real(q);
    });
    render(<App services={{ mail, platform }} />);
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    await sleep(600);
    const withCursor = spy.mock.calls.filter(([q]) => q.cursor).length;
    // TanStack retries a failing query a few times itself; the point is that it is bounded.
    expect(withCursor).toBeLessThanOrEqual(5);
    const settled = spy.mock.calls.length;
    await sleep(600);
    expect(spy.mock.calls.length).toBe(settled);
  });

  it('caps automatic page fetching for the Unread tab', async () => {
    const mail = new MockMailService(createSeedData(), { latency: 0 });
    const spy = vi.spyOn(mail, 'getThreads');
    const user = userEvent.setup();
    render(<App services={{ mail, platform }} />);
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Starred/ }));
    await sleep(600);
    const settled = spy.mock.calls.length;
    await sleep(600);
    expect(spy.mock.calls.length).toBe(settled);
    // initial page + at most MAX_AUTO_PAGES per (filter) context
    expect(settled).toBeLessThanOrEqual(1 + MAX_AUTO_PAGES * 2);
  });
});
