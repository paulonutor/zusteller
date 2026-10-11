import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mailKeys } from '@/domain/mail';
import { Button } from '@/components/ui/Button';
import { useServices } from './services';
import { MailActivityButton } from './MailActivityButton';

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
  const busyRef = useRef(false);
  const run = useCallback(
    async (task: () => Promise<void>, clear = false) => {
      if (busyRef.current) throw new Error('A Gmail connection action is already running');
      busyRef.current = true;
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
        throw e;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [qc],
  );
  useEffect(() => {
    void connection.activity
      ?.publish({ account, status, busy, message: error })
      .catch(() => undefined);
  }, [connection, account, status, busy, error]);
  useEffect(
    () =>
      connection.activity?.subscribeActions(async (action) => {
        if (action === 'cancelConnect') return connection.cancelConnect();
        if (action === 'connect') return run(() => connection.connect(), true);
        if (action === 'refresh') return run(() => connection.refresh());
        if (!account) throw new Error('No Gmail account is connected');
        if (action === 'reset') return run(() => connection.resetLocalChanges(account.id));
        return run(() => connection.disconnect(account.id), true);
      }),
    [connection, account, run],
  );
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
              onClick={() => void run(() => connection.connect(), true).catch(() => undefined)}
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
          <MailActivityButton />
        </div>
      </main>
    );
  }

  return (
    <div key={account.id} className="h-full min-h-0">
      {children}
    </div>
  );
}
