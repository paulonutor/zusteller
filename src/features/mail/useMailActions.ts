import { useCallback } from 'react';
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { mailKeys, type ID, type Page, type ThreadSummary } from '@/domain/mail';
import { useServices } from '@/app/services';
import { useToast } from '@/app/toast';
import type { MailActionId } from './actions';

type ListData = InfiniteData<Page<ThreadSummary>, string | undefined>;
type Patch = (t: ThreadSummary) => ThreadSummary;

const VERBS: Record<MailActionId | 'addLabel' | 'removeLabel', string> = {
  archive: 'archive',
  trash: 'move to Trash',
  restore: 'restore',
  markRead: 'mark as read',
  markUnread: 'mark as unread',
  star: 'update star',
  unstar: 'update star',
  addLabel: 'add label',
  removeLabel: 'remove label',
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

  const run = useCallback(
    async (
      action: MailActionId | 'addLabel' | 'removeLabel',
      threadIds: ID[],
      opts: RunOptions = {},
    ) => {
      if (!accountId || threadIds.length === 0) return false;
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

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: mailKeys.all, predicate: isMutable }),
    [qc],
  );
  return { run, refresh };
}
