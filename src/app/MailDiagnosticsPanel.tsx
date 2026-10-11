import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MailConnection, MailDiagnosticEntry } from '@/domain/mail/connection';
import { Button } from '@/components/ui/Button';

function formatEntry(entry: MailDiagnosticEntry) {
  const parts = [new Date(entry.timestamp).toLocaleTimeString(), entry.operation, entry.outcome];
  if (entry.status !== null) parts.push(`HTTP ${entry.status}`);
  if (entry.quotaUnits) parts.push(`${entry.quotaUnits} units`);
  if (entry.durationMs) parts.push(`${entry.durationMs} ms`);
  if (entry.waitMs) parts.push(`paced ${entry.waitMs} ms`);
  if (entry.reason) parts.push(entry.reason);
  if (entry.retryAfter !== null) parts.push(`retry in ${entry.retryAfter} s`);
  if (entry.count !== null) parts.push(`${entry.count} summaries`);
  return parts.join(' · ');
}

export function MailDiagnosticsPanel({ connection }: { connection: MailConnection }) {
  const log = useQuery({
    queryKey: ['mail-diagnostics'],
    queryFn: () => connection.getDiagnostics!(),
    refetchInterval: 2_000,
    retry: false,
  });
  const [copyStatus, setCopyStatus] = useState('');
  const data = log.data;
  const summary = data
    ? `${data.requests} requests · ${data.quotaUnits} quota units · ${data.rateLimits} rate limits · ${data.cacheHits} cached summaries reused`
    : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        [
          'Gmail diagnostics · current app session',
          summary,
          ...(data?.entries.map(formatEntry) ?? []),
        ].join('\n'),
      );
      setCopyStatus('Log copied');
    } catch {
      setCopyStatus('Could not copy the log');
    }
  };

  return (
    <section
      id="gmail-diagnostics"
      aria-label="Gmail diagnostics"
      className="no-drag flex min-h-[220px] flex-1 flex-col rounded-xl border border-border bg-background p-4 text-[12px]"
    >
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Gmail diagnostics</h2>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="subtle" disabled={!data} onClick={() => void copy()}>
            Copy log
          </Button>
        </div>
      </div>
      <p className="mt-1 text-muted">{summary || 'Loading diagnostics…'}</p>
      {data?.retryAt && (
        <p className="mt-1 text-muted">
          Next sync retry at {new Date(data.retryAt).toLocaleTimeString()}
        </p>
      )}
      <p className="mt-1 text-muted">
        Last 200 events from this app session. Mail content and credentials are excluded.
      </p>
      {copyStatus && (
        <p role="status" className="mt-1">
          {copyStatus}
        </p>
      )}
      {log.isError && <p role="alert">Could not read Gmail diagnostics.</p>}
      <pre
        aria-label="Gmail diagnostic events"
        tabIndex={0}
        className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md bg-hover p-3 font-mono text-[11px] leading-5"
      >
        {data?.entries.length
          ? [...data.entries].reverse().map(formatEntry).join('\n')
          : 'No Gmail activity recorded yet.'}
      </pre>
    </section>
  );
}
