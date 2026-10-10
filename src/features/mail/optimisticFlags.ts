import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { mailKeys, type ID, type Page, type ThreadSummary } from '@/domain/mail';

type ListData = InfiniteData<Page<ThreadSummary>, string | undefined>;
export type Flag = 'isRead' | 'isStarred';
type Write = { value: boolean };
type PendingFlag = { base: boolean; writes: Write[] };

/** Tracks only changed flags. Failed writes cannot restore unrelated rows or newer intents. */
export class OptimisticFlags {
  private pending = new Map<string, PendingFlag>();

  constructor(private qc: QueryClient) {}

  async patch(accountId: ID, ids: ID[], flag: Flag, value: boolean) {
    const key = mailKeys.threads(accountId);
    await this.qc.cancelQueries({ queryKey: key });
    const write = { value };
    const changed = new Map<ID, PendingFlag>();
    const lists = this.qc.getQueriesData<ListData>({ queryKey: key });
    for (const [, data] of lists) {
      for (const page of data?.pages ?? []) {
        for (const thread of page.items) {
          if (!ids.includes(thread.id) || changed.has(thread.id)) continue;
          const id = JSON.stringify([accountId, thread.id, flag]);
          const entry = this.pending.get(id) ?? { base: thread[flag], writes: [] };
          entry.writes.push(write);
          this.pending.set(id, entry);
          changed.set(thread.id, entry);
        }
      }
    }
    const update = () => {
      this.qc.setQueriesData<ListData>(
        { queryKey: key },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((thread) => {
                const entry = changed.get(thread.id);
                if (!entry) return thread;
                const latest = entry.writes.at(-1);
                return { ...thread, [flag]: latest?.value ?? entry.base };
              }),
            })),
          },
      );
    };
    update();
    // Service writes for the same account/flag run in order, so successful writes advance the base.
    return (success: boolean) => {
      for (const [id, entry] of changed) {
        if (success) entry.base = value;
        entry.writes = entry.writes.filter((w) => w !== write);
        if (!entry.writes.length) this.pending.delete(JSON.stringify([accountId, id, flag]));
      }
      update();
    };
  }
}
