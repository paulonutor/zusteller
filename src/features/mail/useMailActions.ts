import { useCallback, useRef } from 'react';
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { mailKeys, type ID, type Page, type ThreadSummary } from '@/domain/mail';
import { useServices } from '@/app/services';
import { useToast } from '@/app/toast';
import type { PerformAction } from './actions';

type ListData = InfiniteData<Page<ThreadSummary>, string | undefined>;
type Patch = (t: ThreadSummary) => ThreadSummary;

const VERBS: Record<PerformAction, string> = {
  archive: 'archive',
  trash: 'move to Trash',
  restore: 'restore',
  markRead: 'mark as read',
  markUnread: 'mark as unread',
  star: 'update star',
  unstar: 'update star',
  addLabel: 'add label',
  removeLabel: 'remove label',
  moveToLabel: 'move to label',
};

/** Optimistically patch flags in every cached list. Only used for trivial, semantics-free flags. */
async function patchLists(qc: QueryClient, accountId: ID, ids: Set<ID>, patch: Patch) {
  const key = mailKeys.threads(accountId);
  await qc.cancelQueries({ queryKey: key });
  const snapshot = qc.getQueriesData<ListData>({ queryKey: key });
  qc.setQueriesData<ListData>({ queryKey: key }, (data) =>
    data && 'pages' in data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((t) => (ids.has(t.id) ? patch(t) : t)),
          })),
        }
      : data,
  );
  return () => snapshot.forEach(([k, v]) => qc.setQueryData(k, v));
}

/** Accounts and labels never change in V1; lists, counts and threads do. */
const isMutable = (q: { queryKey: readonly unknown[] }) =>
  ['threads', 'counts', 'thread'].includes(String(q.queryKey[1]));

export type RunOptions = { labelId?: ID };

/** Executes mail actions against MailService with correct cache updates. */
export function useMailActions(accountId: ID | undefined) {
  const { mail } = useServices();
  const qc = useQueryClient();
  const toast = useToast();

  // Identical action on identical threads already in flight (double-click, key mashing) is one
  // mutation: later callers share the first call's result instead of firing the service again.
  const inFlight = useRef(new Map<string, Promise<boolean>>());

  const execute = useCallback(
    async (action: PerformAction, threadIds: ID[], opts: RunOptions) => {
      if (!accountId) return false;
      const ids = new Set(threadIds);
      let rollback: (() => void) | undefined;
      try {
        switch (action) {
          case 'markRead':
          case 'markUnread': {
            const read = action === 'markRead';
            rollback = await patchLists(qc, accountId, ids, (t) => ({ ...t, isRead: read }));
            await mail.markRead(accountId, threadIds, read);
            break;
          }
          case 'star':
          case 'unstar': {
            const starred = action === 'star';
            rollback = await patchLists(qc, accountId, ids, (t) => ({ ...t, isStarred: starred }));
            await mail.setStarred(accountId, threadIds, starred);
            break;
          }
          case 'archive':
            await mail.archive(accountId, threadIds);
            break;
          case 'trash':
            await mail.trash(accountId, threadIds);
            break;
          case 'restore':
            await mail.restore(accountId, threadIds);
            break;
          case 'addLabel':
            await mail.addLabel(accountId, threadIds, opts.labelId!);
            break;
          case 'moveToLabel':
            // Gmail's "move to": file under the label and take it out of the Inbox.
            await mail.addLabel(accountId, threadIds, opts.labelId!);
            await mail.archive(accountId, threadIds);
            break;
          case 'removeLabel':
            await mail.removeLabel(accountId, threadIds, opts.labelId!);
            break;
        }
        return true;
      } catch (e) {
        rollback?.();
        const reason = e instanceof Error ? e.message : 'Unknown error';
        toast.show(`Couldn't ${VERBS[action]}. ${reason}`, 'error');
        return false;
      } finally {
        // Counts, lists and open threads may all be affected; refetch them.
        void qc.invalidateQueries({ queryKey: mailKeys.all, predicate: isMutable });
      }
    },
    [accountId, mail, qc, toast],
  );

  const run = useCallback(
    (action: PerformAction, threadIds: ID[], opts: RunOptions = {}): Promise<boolean> => {
      if (!accountId || threadIds.length === 0) return Promise.resolve(false);
      const dedupeKey = `${action}|${opts.labelId ?? ''}|${[...new Set(threadIds)].sort().join(',')}`;
      const pending = inFlight.current.get(dedupeKey);
      if (pending) return pending;
      const p = execute(action, threadIds, opts).finally(() => inFlight.current.delete(dedupeKey));
      inFlight.current.set(dedupeKey, p);
      return p;
    },
    [accountId, execute],
  );

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: mailKeys.all, predicate: isMutable }),
    [qc],
  );
  return { run, refresh };
}
