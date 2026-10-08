import type { ID, ThreadQuery } from './types';

export const mailKeys = {
  all: ['mail'] as const,
  accounts: () => [...mailKeys.all, 'accounts'] as const,
  labels: (accountId: ID) => [...mailKeys.all, 'labels', accountId] as const,
  counts: (accountId: ID) => [...mailKeys.all, 'counts', accountId] as const,
  threads: (accountId: ID) => [...mailKeys.all, 'threads', accountId] as const,
  threadList: (query: Omit<ThreadQuery, 'cursor'>) =>
    [...mailKeys.threads(query.accountId), query] as const,
  thread: (accountId: ID, threadId: ID) =>
    [...mailKeys.all, 'thread', accountId, threadId] as const,
};
