import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MailActivityAction } from '@/domain/mail/connection';
import { Button } from '@/components/ui/Button';
import { useServices } from './services';
import { MailDiagnosticsPanel } from './MailDiagnosticsPanel';

export function MailActivityWindow() {
  const { mail, platform } = useServices();
  const connection = mail.connection;
  const activity = connection?.activity;
  const snapshot = useQuery({
    queryKey: ['mail-activity'],
    queryFn: () => activity!.getSnapshot(),
    enabled: !!activity,
    refetchInterval: 500,
    retry: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const data = snapshot.data;
  const status = data?.status;
  const connecting = status?.state === 'connecting';
  const busy = pending || data?.busy || connecting;
  const feedback = error ?? data?.message ?? status?.message;
  const close = () => {
    void platform.closeMailActivityWindow?.().catch(() => setError('Could not close this window'));
  };
  const perform = async (action: MailActivityAction) => {
    setError(undefined);
    if (action !== 'cancelConnect') setPending(true);
    try {
      await activity!.perform(action);
      await snapshot.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update Gmail');
    } finally {
      if (action !== 'cancelConnect') setPending(false);
    }
  };
  const state = !data
    ? 'Loading connection…'
    : connecting
      ? 'Waiting for Google sign-in…'
      : status?.state === 'syncing'
        ? 'Syncing…'
        : status?.state === 'reauth'
          ? 'Reconnect required'
          : status?.state === 'error'
            ? 'Sync paused'
            : data.account
              ? status?.lastSyncedAt
                ? 'Synced · unread counts are estimates'
                : 'Cached mail · connecting to Google…'
              : 'Not connected';

  return (
    <main
      className="no-drag flex h-full min-h-0 flex-col gap-4 overflow-auto bg-background p-5 text-[13px]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <header className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Gmail activity</h1>
          <p className="mt-1 text-muted">Connection, sync and request log</p>
        </div>
        <Button variant="subtle" onClick={close}>
          Close
        </Button>
      </header>
      <section
        aria-label="Gmail connection"
        className="shrink-0 rounded-xl border border-border bg-sidebar p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{data?.account?.email ?? 'Gmail connection'}</h2>
          <p role="status">{state}</p>
        </div>
        <p className="mt-2 text-muted">Read-only Gmail · actions are local</p>
        {status?.lastSyncedAt && (
          <p className="mt-1 text-muted">
            Last sync at {new Date(status.lastSyncedAt).toLocaleTimeString()}
          </p>
        )}
        {status?.retryAt && (
          <p className="mt-1 text-muted">
            Next sync retry at {new Date(status.retryAt).toLocaleTimeString()}
          </p>
        )}
        {feedback && (
          <p role="alert" className="mt-2 break-words">
            {feedback}
          </p>
        )}
        {snapshot.isError && (
          <p role="alert" className="mt-2">
            Could not read the connection status.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {data?.account ? (
            <>
              <Button variant="subtle" disabled={!!busy} onClick={() => void perform('refresh')}>
                Refresh Gmail
              </Button>
              <Button disabled={!!busy} onClick={() => void perform('reset')}>
                Reset local changes
              </Button>
              <Button disabled={!!busy} onClick={() => void perform('connect')}>
                Reconnect
              </Button>
              <Button disabled={!!busy} onClick={() => void perform('disconnect')}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              variant="subtle"
              disabled={!data || !!busy}
              onClick={() => void perform('connect')}
            >
              Connect Gmail
            </Button>
          )}
          {connecting && (
            <Button onClick={() => void perform('cancelConnect')}>Cancel sign-in</Button>
          )}
        </div>
      </section>
      {connection?.getDiagnostics && <MailDiagnosticsPanel connection={connection} />}
    </main>
  );
}
