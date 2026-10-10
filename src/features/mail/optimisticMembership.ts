import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  applyMailboxAction,
  mailKeys,
  SYSTEM_LABEL,
  type ID,
  type MailboxAction,
  type Page,
  type ThreadSummary,
} from '@/domain/mail';

type ListData = InfiniteData<Page<ThreadSummary>, string | undefined>;
type Write = { action: MailboxAction };
type Pending = { base: ID[]; writes: Write[] };
const touched = new Set<ID>([SYSTEM_LABEL.inbox, SYSTEM_LABEL.trash, SYSTEM_LABEL.junk]);

/** Retains rows in their pages so rollback preserves order, cursors and unrelated fields. */
export class OptimisticMembership {
  private pending = new Map<string, Pending>();

  constructor(private qc: QueryClient) {}

  async patch(accountId: ID, ids: ID[], action: MailboxAction) {
    const key = mailKeys.threads(accountId);
    await this.qc.cancelQueries({ queryKey: key });
    const write = { action };
    const changed = new Map<ID, Pending>();
    for (const [, data] of this.qc.getQueriesData<ListData>({ queryKey: key })) {
      for (const thread of data?.pages.flatMap((p) => p.items) ?? []) {
        if (!ids.includes(thread.id) || changed.has(thread.id)) continue;
        const id = JSON.stringify([accountId, thread.id]);
        const entry = this.pending.get(id) ?? {
          base: thread.labelIds.filter((label) => touched.has(label)),
          writes: [],
        };
        entry.writes.push(write);
        this.pending.set(id, entry);
        changed.set(thread.id, entry);
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
                const labels = entry.writes.reduce(
                  (labels, write) => applyMailboxAction(labels, write.action),
                  entry.base,
                );
                return {
                  ...thread,
                  labelIds: [...thread.labelIds.filter((id) => !touched.has(id)), ...labels],
                };
              }),
            })),
          },
      );
    };
    update();
    // Writes run in order per account. A failed earlier action cannot undo a later intent.
    return (success: boolean) => {
      for (const [id, entry] of changed) {
        if (success) entry.base = applyMailboxAction(entry.base, action);
        entry.writes = entry.writes.filter((w) => w !== write);
        if (!entry.writes.length) this.pending.delete(JSON.stringify([accountId, id]));
      }
      update();
    };
  }
}
