import { useEffect, useState, type RefObject } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  mailKeys,
  matchesMembership,
  type ID,
  type ThreadQuery,
  type ThreadSummary,
  type Page,
} from '@/domain/mail';
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
  const seen = new Set<ID>();
  const items: ThreadSummary[] =
    result.data?.pages
      .flatMap((p) => p.items)
      .filter((t) => !query || matchesMembership(t, query))
      .filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      }) ?? [];
  return { ...result, items };
}

export function useThread(accountId: ID | undefined, threadId: ID | null) {
  const { mail } = useServices();
  const client = useQueryClient();
  const result = useQuery({
    queryKey: mailKeys.thread(accountId ?? '', threadId ?? ''),
    queryFn: () => mail.getThread(accountId!, threadId!),
    enabled: !!accountId && !!threadId,
  });
  useEffect(() => {
    if (result.data) replaceSummary(client, result.data);
  }, [client, result.data]);
  return result;
}

function replaceSummary(client: ReturnType<typeof useQueryClient>, summary: ThreadSummary) {
  const lists = client.getQueriesData<InfiniteData<Page<ThreadSummary>>>({
    queryKey: mailKeys.threads(summary.accountId),
  });
  for (const [key, data] of lists) {
    if (!data?.pages.some((p) => p.items.some((t) => t.id === summary.id && t.metadataPending)))
      continue;
    client.setQueryData(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((t) => (t.id === summary.id && t.metadataPending ? summary : t)),
      })),
    });
  }
}

/** Mounted overscan/selection rows must not fetch until they intersect the list viewport. */
export function useLazySummary(
  thread: ThreadSummary,
  row: RefObject<HTMLDivElement | null>,
  viewport: RefObject<HTMLDivElement | null>,
) {
  const { mail } = useServices();
  const client = useQueryClient();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!mail.getThreadSummary || !row.current || !viewport.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      root: viewport.current,
    });
    observer.observe(row.current);
    return () => observer.disconnect();
  }, [mail.getThreadSummary, row, viewport]);
  const result = useQuery({
    queryKey: mailKeys.summary(thread.accountId, thread.id),
    queryFn: ({ signal }) => mail.getThreadSummary!(thread.accountId, thread.id, signal),
    enabled: !!mail.getThreadSummary && !!thread.metadataPending && visible,
    // The provider checks history before returning cached metadata. Avoid replaying stale
    // query data when a later list response marks this conversation as changed.
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (!visible && thread.metadataPending) {
      void client.cancelQueries({ queryKey: mailKeys.summary(thread.accountId, thread.id) });
    }
  }, [client, visible, thread.accountId, thread.id, thread.metadataPending]);
  useEffect(() => {
    if (visible && result.data && !result.isFetching && !result.isError && thread.metadataPending) {
      replaceSummary(client, result.data);
    }
  }, [client, visible, result.data, result.isFetching, result.isError, thread.metadataPending]);
  return result;
}
