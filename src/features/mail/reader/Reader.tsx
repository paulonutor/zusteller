import { dragRegionProps } from '@/platform/hostChrome';
import { useState } from 'react';
import { AlertCircle, MailOpen } from 'lucide-react';
import type { ID, Label, Thread, ThreadSummary } from '@/domain/mail';
import { SYSTEM_LABEL } from '@/domain/mail';
import { Button } from '@/components/ui/Button';
import { ActionBar } from '../ActionBar';
import { labelChipStyle } from '../format';
import { useThreadActions, type Perform } from '../useThreadActions';
import type { MailView } from '../view';
import { MessageView } from './MessageView';

type Props = {
  /** Selected summaries from the list (1 = open thread, >1 = bulk). */
  selected: ThreadSummary[];
  thread: Thread | undefined;
  isLoading: boolean;
  error: Error | null;
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
  const { actions, labelItems, none, hasLabels } = useThreadActions(
    selected,
    view,
    labels,
    perform,
  );
  return (
    <div
      {...dragRegionProps}
      className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4"
    >
      <ActionBar
        actions={actions}
        labelItems={labelItems}
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
      ) : p.error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
          <AlertCircle size={22} />
          <p className="text-[13px]">Couldn’t open this conversation.</p>
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

  const toggle = (id: ID) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="selectable px-5 pb-3 pt-4">
        <h2 className="text-[20px] font-semibold leading-snug">{thread.subject}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span>
            {thread.messageCount} {thread.messageCount === 1 ? 'message' : 'messages'}
          </span>
          {trashed && <span className="rounded bg-hover px-1.5">In Trash</span>}
          {chips.map((l) => (
            <span
              key={l.id}
              className="rounded px-1.5 leading-[18px]"
              style={labelChipStyle(l.color)}
            >
              {l.name}
            </span>
          ))}
          {thread.messageCount > 1 && (
            <button
              type="button"
              className="ml-auto hover:text-foreground"
              onClick={() =>
                setOpen(
                  open.size === thread.messages.length
                    ? new Set(lastId ? [lastId] : [])
                    : new Set(thread.messages.map((m) => m.id)),
                )
              }
            >
              {open.size === thread.messages.length ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      </header>
      <div className="border-t border-border">
        {thread.messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            expanded={open.has(m.id)}
            onToggle={() => toggle(m.id)}
            onOpenLink={onOpenLink}
          />
        ))}
      </div>
    </div>
  );
}
