import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { mailKeys, type MailService, type ThreadSummary } from '@/domain/mail';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import { createTestPlatform, deferred } from './helpers/mail';

const observers = new Map<Element, IntersectionObserverCallback>();
function intersect(row: Element, visible: boolean) {
  const callback = observers.get(row);
  expect(callback).toBeDefined();
  act(() =>
    callback!(
      [{ target: row, isIntersecting: visible } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
}
beforeEach(() => {
  localStorage.clear();
  observers.clear();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        observers.set(target, this.callback);
      }
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const mail = new MockMailService(createSeedData(), { latency: 0 }) as MockMailService &
    MailService;
  const account = (await mail.getAccounts())[0]!;
  const originals = (await mail.getThreads({ accountId: account.id, mailbox: 'inbox', limit: 3 }))
    .items;
  const pending = originals.map((t) => ({
    ...t,
    subject: '',
    participants: [],
    isRead: true,
    metadataPending: true,
  }));
  const headers = vi.fn(async (_account: string, id: string) =>
    originals.find((t) => t.id === id)!,
  );
  mail.getThreadSummary = headers;
  vi.spyOn(mail, 'getThreads').mockResolvedValue({ items: pending });
  const bodies = vi.spyOn(mail, 'getThread');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  render(<App services={{ mail, platform: createTestPlatform() }} queryClient={client} />);
  await screen.findAllByRole('option', { name: /Loading conversation/ });
  return { originals, headers, bodies, client, account };
}

describe('lazy conversation rows', () => {
  it('loads only intersecting rows and keeps bodies unopened until clicked', async () => {
    const { originals, headers, bodies } = await setup();
    expect(headers).not.toHaveBeenCalled();
    expect(bodies).not.toHaveBeenCalled();
    const first = document.getElementById(`row-${originals[0]!.id}`)!;
    intersect(first, true);
    await screen.findByRole('option', { name: new RegExp(originals[0]!.subject) });
    expect(headers).toHaveBeenCalledOnce();
    expect(bodies).not.toHaveBeenCalled();
    expect(screen.getAllByRole('option', { name: /Loading conversation/ })).toHaveLength(2);
    await userEvent.setup().click(first);
    await waitFor(() => expect(bodies).toHaveBeenCalled());
    expect(bodies.mock.calls.every(([, id]) => id === originals[0]!.id)).toBe(true);
  });

  it('does not replace changed rows with stale metadata while fresh headers are loading', async () => {
    const { originals, headers, client, account } = await setup();
    const first = document.getElementById(`row-${originals[0]!.id}`)!;
    intersect(first, true);
    await screen.findByRole('option', { name: new RegExp(originals[0]!.subject) });
    const changed = deferred<ThreadSummary>();
    headers.mockImplementationOnce(() => changed.promise);
    intersect(first, false);
    await act(async () => {
      await client.invalidateQueries({ queryKey: mailKeys.threads(account.id) });
    });
    expect(headers).toHaveBeenCalledOnce();
    intersect(first, true);
    await waitFor(() => expect(headers).toHaveBeenCalledTimes(2));
    expect(first).toHaveTextContent('Loading conversation');
    await act(async () => changed.resolve({ ...originals[0]!, subject: 'Changed on the server' }));
    await screen.findByRole('option', { name: /Changed on the server/ });
    expect(headers).toHaveBeenCalledTimes(2);
  });
});
