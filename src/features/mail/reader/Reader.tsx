import { dragRegionProps } from '@/platform/hostChrome';
import { useState } from 'react';
import { AlertCircle, ChevronsDownUp, ChevronsUpDown, MailOpen } from 'lucide-react';
import type { ID, Label, Thread, ThreadSummary } from '@/domain/mail';
import { SYSTEM_LABEL } from '@/domain/mail';
import { Button } from '@/components/ui/Button';
import { ActionBar } from '../ActionBar';
import { LabelChip } from '../LabelChip';
import { useThreadActions, type Perform } from '../useThreadActions';
import type { MailView } from '../view';
import { MessageView } from './MessageView';

type Props = {
  /** Selected summaries from the list (1 = open thread, >1 = bulk). */
  selected: ThreadSummary[];
  thread: Thread | undefined;
  isLoading: boolean;
  error: Error | null;
  retryAfter?: number;
  onRetry: () => void;
  view: MailView;
  labels: Label[];
  perform: Perform;
  onOpenLink: (url: string) => void;
};

function Toolbar({
  selected,
  view,
  labels,
  perform,
}: Pick<Props, 'selected' | 'view' | 'labels' | 'perform'>) {
  const { actions, labelItems, none, hasLabels, canLabel } = useThreadActions(
    selected,
    view,
    labels,
    perform,
  );
  return (
    <div
      {...dragRegionProps}
      className="mail-reader-toolbar drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4"
    >
      <ActionBar
        actions={actions}
        labelItems={labelItems}
        showLabels={canLabel}
        labelsDisabled={none || !hasLabels}
        ids={selected.map((t) => t.id)}
        perform={perform}
      />
    </div>
  );
}

export function Reader(p: Props) {
  const empty = p.selected.length === 0;
  const multi = p.selected.length > 1;

  return (
    <section aria-label="Conversation" className="flex h-full min-w-0 flex-col bg-background">
      <Toolbar selected={p.selected} view={p.view} labels={p.labels} perform={p.perform} />
      {empty ? (
        <Placeholder>No conversation selected</Placeholder>
      ) : multi ? (
        <Placeholder>{p.selected.length} conversations selected</Placeholder>
      ) : p.retryAfter && !p.thread ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted"
          role="status"
          aria-label="Waiting for request limit"
        >
          <p className="text-[13px]">Waiting for Gmail’s request limit.</p>
          <p className="text-[12px]">
            This conversation will load automatically when requests resume.
          </p>
        </div>
      ) : p.error && !p.thread ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
          <AlertCircle size={22} />
          <p className="text-[13px]">Couldn’t open this conversation.</p>
          <p className="max-w-sm px-4 text-center text-[12px]">{p.error.message}</p>
          <Button variant="subtle" onClick={p.onRetry}>
            Try again
          </Button>
        </div>
      ) : !p.thread ? (
        <div className="space-y-3 p-6" role="status" aria-busy aria-label="Loading conversation">
          <div className="skeleton h-6 w-1/2" />
          <div className="skeleton h-3 w-1/3" />
          <div className="skeleton mt-6 h-3 w-full" />
          <div className="skeleton h-3 w-5/6" />
          <div className="skeleton h-3 w-2/3" />
        </div>
      ) : (
        <ThreadBody
          key={`${p.thread.id}:${p.thread.messageCount}`}
          thread={p.thread}
          labels={p.labels}
          onOpenLink={p.onOpenLink}
        />
      )}
    </section>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
      <MailOpen size={30} strokeWidth={1.25} />
      <p className="text-[13px]">{children}</p>
    </div>
  );
}

function ThreadBody({
  thread,
  labels,
  onOpenLink,
}: {
  thread: Thread;
  labels: Label[];
  onOpenLink: (u: string) => void;
}) {
  const lastId = thread.messages[thread.messages.length - 1]?.id;
  const [open, setOpen] = useState<Set<ID>>(() => new Set(lastId ? [lastId] : []));
  const chips = thread.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l && l.type === 'user');
  const trashed = thread.labelIds.includes(SYSTEM_LABEL.trash);
  const junk = thread.labelIds.includes(SYSTEM_LABEL.junk) && !trashed;

  const toggle = (id: ID) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="mail-thread-header selectable sticky top-0 z-10 bg-background px-5 pb-2 pt-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 text-[17px] font-semibold leading-snug">{thread.subject}</h2>
          {chips.map((l) => (
            <LabelChip key={l.id} label={l} className="max-w-64" />
          ))}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-muted">
            {trashed && <span className="rounded bg-hover px-1.5">In Trash</span>}
            {junk && <span className="rounded bg-hover px-1.5">In Junk</span>}
            {thread.messageCount > 1 && <span>{thread.messageCount} messages</span>}
            {thread.messageCount > 1 && (
              <button
                type="button"
                className="flex items-center rounded p-0.5 hover:text-foreground"
                aria-label={open.size === thread.messages.length ? 'Collapse all' : 'Expand all'}
                title={open.size === thread.messages.length ? 'Collapse all' : 'Expand all'}
                onClick={() =>
                  setOpen(
                    open.size === thread.messages.length
                      ? new Set(lastId ? [lastId] : [])
                      : new Set(thread.messages.map((m) => m.id)),
                  )
                }
              >
                {open.size === thread.messages.length ? (
                  <ChevronsDownUp size={16} />
                ) : (
                  <ChevronsUpDown size={16} />
                )}
              </button>
            )}
          </span>
        </div>
      </header>
      <div className="mail-thread-messages flex flex-1 flex-col border-t border-border">
        {thread.messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            expanded={open.has(m.id)}
            collapsible={thread.messages.length > 1}
            junk={junk}
            onToggle={() => toggle(m.id)}
            onOpenLink={onOpenLink}
          />
        ))}
      </div>
    </div>
  );
}
