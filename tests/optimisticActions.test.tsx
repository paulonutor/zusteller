import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/services';
import { ToastProvider } from '@/app/toast';
import { mailKeys, type Page, type ThreadSummary } from '@/domain/mail';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import { useMailActions } from '@/features/mail/useMailActions';
import { createTestPlatform, deferred } from './helpers/mail';

async function setup() {
  const mail = new MockMailService(createSeedData(), { latency: 0 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = mailKeys.threadList({ accountId: 'acct-1', mailbox: 'inbox' });
  const page = await mail.getThreads({ accountId: 'acct-1', mailbox: 'inbox' });
  qc.setQueryData(key, { pages: [page], pageParams: [undefined] });
  const services = { mail, platform: createTestPlatform() };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </ServicesProvider>
  );
  const { result } = renderHook(() => useMailActions('acct-1'), { wrapper });
  const cached = (id: string) =>
    qc
      .getQueryData<InfiniteData<Page<ThreadSummary>>>(key)!
      .pages.flatMap((p) => p.items)
      .find((t) => t.id === id)!;
  const flush = async () =>
    act(async () => {
      await Promise.resolve();
    });
  return { mail, qc, result, cached, flush, rows: page.items };
}

describe('overlapping optimistic actions', () => {
  it("rolling back a star preserves another row and the same row's read change", async () => {
    const { mail, result, cached, flush, rows } = await setup();
    const a = rows.find((t) => !t.isRead && !t.isStarred)!;
    const b = rows.find((t) => t.id !== a.id && !t.isStarred)!;
    const failed = deferred<void>();
    vi.spyOn(mail, 'setStarred').mockImplementationOnce(() => failed.promise);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    let read!: Promise<boolean>;
    act(() => {
      first = result.current.run('star', [a.id]);
      second = result.current.run('star', [b.id]);
      read = result.current.run('markRead', [a.id]);
    });
    await flush();
    expect(cached(a.id).isStarred).toBe(true);
    expect(cached(b.id).isStarred).toBe(true);
    await act(async () => {
      failed.reject(new Error('Star failed'));
      expect(await first).toBe(false);
      expect(await second).toBe(true);
      expect(await read).toBe(true);
    });
    expect(cached(a.id).isStarred).toBe(false);
    expect(cached(a.id).isRead).toBe(true);
    expect(cached(b.id).isStarred).toBe(true);
  });

  it('keeps a newer toggle visible and restores the original flag if both writes fail', async () => {
    const { mail, result, cached, flush, rows } = await setup();
    const row = rows.find((t) => !t.isStarred)!;
    const a = deferred<void>();
    const b = deferred<void>();
    const spy = vi
      .spyOn(mail, 'setStarred')
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => b.promise);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.run('star', [row.id]);
      second = result.current.run('unstar', [row.id]);
    });
    await flush();
    expect(cached(row.id).isStarred).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      a.reject(new Error('First failed'));
      await first;
    });
    expect(cached(row.id).isStarred).toBe(false);
    await act(async () => {
      b.reject(new Error('Second failed'));
      await second;
    });
    expect(cached(row.id).isStarred).toBe(false);
  });

  it('does not deduplicate a new star intent across an intervening unstar', async () => {
    const { mail, result, cached, flush, rows } = await setup();
    const row = rows.find((t) => !t.isStarred)!;
    const gate = deferred<void>();
    const real = mail.setStarred.bind(mail);
    const spy = vi.spyOn(mail, 'setStarred').mockImplementationOnce(async (...args) => {
      await gate.promise;
      await real(...args);
    });
    let calls!: Promise<boolean>[];
    act(() => {
      calls = [
        result.current.run('star', [row.id]),
        result.current.run('unstar', [row.id]),
        result.current.run('star', [row.id]),
      ];
    });
    await flush();
    expect(cached(row.id).isStarred).toBe(true);
    await act(async () => {
      gate.resolve();
      await Promise.all(calls);
    });
    expect(spy.mock.calls.map((c) => c[2])).toEqual([true, false, true]);
    expect((await mail.getThread('acct-1', row.id)).isStarred).toBe(true);
    expect(cached(row.id).isStarred).toBe(true);
  });
});
