import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { mailKeys, type ID, type ThreadQuery, type ThreadSummary } from '@/domain/mail';
import { useServices } from '@/app/services';

export function useAccounts() {
  const { mail } = useServices();
  return useQuery({
    queryKey: mailKeys.accounts(),
    queryFn: () => mail.getAccounts(),
    staleTime: Infinity,
  });
}

export function useLabels(accountId: ID | undefined) {
  const { mail } = useServices();
  return useQuery({
    queryKey: mailKeys.labels(accountId ?? ''),
    queryFn: () => mail.getLabels(accountId!),
    enabled: !!accountId,
    staleTime: Infinity,
  });
}

export function useCounts(accountId: ID | undefined) {
  const { mail } = useServices();
  return useQuery({
    queryKey: mailKeys.counts(accountId ?? ''),
    queryFn: () => mail.getMailboxCounts(accountId!),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useThreadList(query: Omit<ThreadQuery, 'cursor'> | undefined) {
  const { mail } = useServices();
  const result = useInfiniteQuery({
    queryKey: query ? mailKeys.threadList(query) : mailKeys.all,
    queryFn: ({ pageParam }) => mail.getThreads({ ...query!, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!query,
    // Keep rows on screen while a new search/view/refetch is in flight.
    placeholderData: keepPreviousData,
  });
  const items: ThreadSummary[] = result.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...result, items };
}

export function useThread(accountId: ID | undefined, threadId: ID | null) {
  const { mail } = useServices();
  return useQuery({
    queryKey: mailKeys.thread(accountId ?? '', threadId ?? ''),
    queryFn: () => mail.getThread(accountId!, threadId!),
    enabled: !!accountId && !!threadId,
  });
}
