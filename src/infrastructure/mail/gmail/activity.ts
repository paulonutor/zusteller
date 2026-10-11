import type { MailActivity, MailActivityAction } from '@/domain/mail/connection';
import { invokeHost, listenHost } from '@/platform/tauri';

const REQUEST = 'zusteller://gmail-activity-action';
const RESULT = 'zusteller://gmail-activity-result';

type Listen = typeof listenHost;
type Invoke = typeof invokeHost;

export function createGmailActivity(
  invoke: Invoke = invokeHost,
  listen: Listen = listenHost,
): MailActivity {
  return {
    getSnapshot: () => invoke('gmail_activity_snapshot'),
    publish: (snapshot) => invoke('gmail_activity_publish', { snapshot }),
    subscribeActions(handler) {
      let off: (() => void) | undefined;
      let cancelled = false;
      void listen(REQUEST, (payload) => {
        if (cancelled) return;
        const request = payload as { requestId: string; action: MailActivityAction };
        void handler(request.action)
          .then(
            () => invoke('gmail_activity_result', { requestId: request.requestId, error: null }),
            (error) =>
              invoke('gmail_activity_result', {
                requestId: request.requestId,
                error: error instanceof Error ? error.message : 'Could not update Gmail',
              }),
          )
          .catch(() => undefined);
      })
        .then((unlisten) => (cancelled ? unlisten() : (off = unlisten)))
        .catch(() => undefined);
      return () => {
        cancelled = true;
        off?.();
      };
    },
    async perform(action) {
      const requestId = crypto.randomUUID();
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const result = new Promise<void>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      const off = await listen(RESULT, (payload) => {
        const response = payload as { requestId: string; error?: string };
        if (response.requestId !== requestId) return;
        if (response.error) reject(new Error(response.error));
        else resolve();
      });
      // OAuth itself times out after three minutes. Bound the bridge as well.
      const timeout = setTimeout(
        () => reject(new Error('The main window did not respond. Try again.')),
        200_000,
      );
      try {
        await Promise.all([invoke('gmail_activity_action', { requestId, action }), result]);
      } finally {
        clearTimeout(timeout);
        off();
      }
    },
  };
}
