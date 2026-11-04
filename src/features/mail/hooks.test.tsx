import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ServicesProvider } from '@/app/services';
import type { MailService, Thread, ThreadSummary } from '@/domain/mail';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import { createTestPlatform } from '../../../tests/helpers/mail';
import { useThread } from './hooks';

it('keeps the open body on unrelated syncs and refreshes it when its metadata changes', async () => {
  const mock = new MockMailService(createSeedData(), { latency: 0 });
  const account = (await mock.getAccounts())[0]!.id;
  const first = (await mock.getThreads({ accountId: account, mailbox: 'inbox' })).items[0]!;
  let thread: Thread = await mock.getThread(account, first.id);
  const getThread = vi.fn(async () => thread);
  const summary = (): ThreadSummary => {
    const { messages, ...value } = thread;
    void messages;
    return value;
  };
  const getThreadSummary = vi.fn(async () => summary());
  let notify = () => {};
  const mail: MailService = Object.assign(mock, {
    getThread,
    getThreadSummary,
    subscribe: (listener: () => void) => {
      notify = listener;
      return () => {
        notify = () => {};
      };
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={{ mail, platform: createTestPlatform() }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ServicesProvider>
  );
  const { result } = renderHook(() => useThread(account, first.id), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  await act(async () => {
    notify();
  });
  expect(getThreadSummary).toHaveBeenCalledTimes(1);
  expect(getThread).toHaveBeenCalledTimes(1);
  thread = { ...thread, messageCount: thread.messageCount + 1, snippet: 'A new reply' };
  await act(async () => {
    notify();
  });
  await waitFor(() => expect(result.current.data?.snippet).toBe('A new reply'));
  expect(getThread).toHaveBeenCalledTimes(2);
  getThreadSummary.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    notify();
  });
  expect(result.current.data?.snippet).toBe('A new reply');
  expect(getThread).toHaveBeenCalledTimes(2);
});
