import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mailKeys } from '@/domain/mail';
import { Button } from '@/components/ui/Button';
import { useServices } from './services';

/** Shared account UI depends only on the optional provider lifecycle contract. */
export function MailConnectionGate({ children }: { children: ReactNode }) {
  const { mail, platform } = useServices();
  const qc = useQueryClient();
  const connection = mail.connection!;
  const status = useSyncExternalStore(connection.subscribeStatus, connection.getStatus);
  const accounts = useQuery({
    queryKey: mailKeys.accounts(),
    queryFn: () => mail.getAccounts(),
    staleTime: Infinity,
  });
  const account = accounts.data?.[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (task: () => Promise<void>, clear = false) => {
    setBusy(true);
    setError(undefined);
    try {
      await task();
      if (clear) {
        await qc.cancelQueries({ queryKey: mailKeys.all });
        qc.removeQueries({ queryKey: mailKeys.all });
      }
      await qc.invalidateQueries({ queryKey: mailKeys.all });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the Gmail connection');
    } finally {
      setBusy(false);
    }
  };
  const connecting = status.state === 'connecting';
  const feedback = error ?? status.message;

  if (!account) {
    return (
      <main data-shell className="flex h-full items-center justify-center bg-background">
        <div className="no-drag flex max-w-md flex-col gap-4 px-8 text-[13px]">
          <h1 className="text-xl font-semibold">Connect your Gmail account</h1>
          <p className="text-muted">
            Read real mail in Zusteller. Stars, labels, read status and mailbox actions stay on this
            Mac. Gmail is never changed.
          </p>
          <ol className="list-decimal space-y-2 pl-4 text-muted">
            <li>Enable Gmail API in a Google Cloud project.</li>
            <li>
              Set Google Auth Platform to External / Testing and add your Gmail address as a test
              user.
            </li>
            <li>
              Create a Desktop app OAuth client and download its JSON file outside this repository.
            </li>
          </ol>
          <p className="text-muted">
            Connect Gmail will ask for that file, then open Google sign-in in your browser. Testing
            credentials expire after seven days and need reconnecting.
          </p>
          {feedback && <p role="alert">{feedback}</p>}
          {accounts.isError && <p role="alert">{accounts.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || accounts.isPending}
              onClick={() => void run(() => connection.connect(), true)}
            >
              {connecting
                ? 'Waiting for Google…'
                : accounts.isPending
                  ? 'Loading…'
                  : 'Connect Gmail'}
            </Button>
            {connecting && (
              <Button variant="subtle" onClick={() => void connection.cancelConnect()}>
                Cancel sign-in
              </Button>
            )}
            <Button
              variant="subtle"
              onClick={() =>
                void platform.openExternal('https://console.cloud.google.com/auth/overview')
              }
            >
              Google Cloud setup
            </Button>
            {accounts.isError && (
              <Button variant="subtle" onClick={() => void accounts.refetch()}>
                Try again
              </Button>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div key={account.id} className="min-h-0 flex-1">
        {children}
      </div>
      <div
        role="region"
        aria-label="Gmail connection"
        className="no-drag flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-sidebar px-3 py-1 text-[11px]"
      >
        <span>Read-only Gmail · actions are local</span>
        <span className="text-muted" role="status">
          {status.state === 'syncing'
            ? 'Syncing…'
            : (feedback ??
              (status.lastSyncedAt
                ? 'Synced · unread counts are estimates'
                : 'Cached mail · connecting to Google…'))}
        </span>
        <div className="ml-auto flex gap-3">
          <button
            disabled={busy}
            className="hover:underline disabled:opacity-50"
            onClick={() => void run(() => connection.refresh())}
          >
            Refresh Gmail
          </button>
          <button
            disabled={busy}
            className="hover:underline disabled:opacity-50"
            onClick={() => void run(() => connection.resetLocalChanges(account.id))}
          >
            Reset local changes
          </button>
          <button
            disabled={busy}
            className="hover:underline disabled:opacity-50"
            onClick={() => void run(() => connection.connect(), true)}
          >
            Reconnect
          </button>
          <button
            disabled={busy}
            className="hover:underline disabled:opacity-50"
            onClick={() => void run(() => connection.disconnect(account.id), true)}
          >
            Disconnect
          </button>
          {connecting && (
            <button onClick={() => void connection.cancelConnect()}>Cancel sign-in</button>
          )}
        </div>
      </div>
    </div>
  );
}
