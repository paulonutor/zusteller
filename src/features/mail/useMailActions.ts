import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mailKeys, type ID } from '@/domain/mail';
import { useServices } from '@/app/services';
import { useToast } from '@/app/toast';
import type { PerformAction } from './actions';

import { OptimisticFlags, type Flag } from './optimisticFlags';

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
  markJunk: 'mark as junk',
  notJunk: 'mark as not junk',
  deleteForever: 'delete permanently',
};

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
  const latestIntent = useRef(new Map<string, string>());
  const flagQueues = useRef(new Map<string, Promise<void>>());
  const pendingCount = useRef(0);
  const optimistic = useRef<OptimisticFlags | null>(null);
  optimistic.current ??= new OptimisticFlags(qc);

  const execute = useCallback(
    async (action: PerformAction, threadIds: ID[], opts: RunOptions) => {
      if (!accountId) return false;
      let settle: ((success: boolean) => void) | undefined;
      let success = false;
      const writeFlag = async (flag: Flag, value: boolean, write: () => Promise<void>) => {
        const key = JSON.stringify([accountId, flag]);
        const previous = flagQueues.current.get(key) ?? Promise.resolve();
        const patch = optimistic.current!.patch(accountId, threadIds, flag, value);
        const next = (async () => {
          settle = await patch;
          await previous;
          await write();
        })();
        const done = next.catch(() => undefined);
        flagQueues.current.set(key, done);
        try {
          await next;
        } finally {
          if (flagQueues.current.get(key) === done) flagQueues.current.delete(key);
        }
      };
      try {
        switch (action) {
          case 'markRead':
          case 'markUnread': {
            const read = action === 'markRead';
            await writeFlag('isRead', read, () => mail.markRead(accountId, threadIds, read));
            break;
          }
          case 'star':
          case 'unstar': {
            const starred = action === 'star';
            await writeFlag('isStarred', starred, () =>
              mail.setStarred(accountId, threadIds, starred),
            );
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
          case 'markJunk':
            await mail.markJunk(accountId, threadIds);
            break;
          case 'notJunk':
            await mail.notJunk(accountId, threadIds);
            break;
          case 'deleteForever':
            await mail.deleteForever(accountId, threadIds);
            break;
          case 'addLabel':
            await mail.addLabel(accountId, threadIds, opts.labelId!);
            break;
          case 'moveToLabel':
            await mail.moveToLabel(accountId, threadIds, opts.labelId!);
            break;
          case 'removeLabel':
            await mail.removeLabel(accountId, threadIds, opts.labelId!);
            break;
        }
        success = true;
        return true;
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'Unknown error';
        toast.show(`Couldn't ${VERBS[action]}. ${reason}`, 'error');
        return false;
      } finally {
        settle?.(success);
      }
    },
    [accountId, mail, toast],
  );

  const run = useCallback(
    (action: PerformAction, threadIds: ID[], opts: RunOptions = {}): Promise<boolean> => {
      if (!accountId || threadIds.length === 0) return Promise.resolve(false);
      const ids = [...new Set(threadIds)].sort();
      const target = JSON.stringify([
        accountId,
        action === 'star' || action === 'unstar'
          ? 'star'
          : action === 'markRead' || action === 'markUnread'
            ? 'read'
            : action,
        opts.labelId,
        ids,
      ]);
      const dedupeKey = JSON.stringify([target, action]);
      const pending = inFlight.current.get(dedupeKey);
      if (pending && latestIntent.current.get(target) === action) return pending;
      latestIntent.current.set(target, action);
      pendingCount.current++;
      const p = execute(action, ids, opts).finally(() => {
        if (inFlight.current.get(dedupeKey) === p) inFlight.current.delete(dedupeKey);
        if (--pendingCount.current === 0) {
          latestIntent.current.clear();
          void qc.invalidateQueries({ queryKey: mailKeys.all, predicate: isMutable });
        }
      });
      inFlight.current.set(dedupeKey, p);
      return p;
    },
    [accountId, execute, qc],
  );

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: mailKeys.all, predicate: isMutable }),
    [qc],
  );
  return { run, refresh };
}
