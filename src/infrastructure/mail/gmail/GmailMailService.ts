import {
  MailServiceError,
  type Account,
  type Attachment,
  type ID,
  type Label,
  type MailboxCounts,
  type MailService,
  type Page,
  type Thread,
  type ThreadQuery,
  type ThreadSummary,
} from '@/domain/mail';
import type {
  MailConnection,
  ConnectionStatus,
  MailDiagnostics,
  MailActivity,
} from '@/domain/mail/connection';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Desktop provider. OAuth, network access, persistence and local actions live in Rust. */
export class GmailMailService implements MailService, MailConnection {
  readonly localPreview = true;
  readonly connection = this;
  private status: ConnectionStatus = { state: 'idle' };
  private statusListeners = new Set<() => void>();
  private listeners = new Set<() => void>();
  private accountId?: ID;
  private timer?: ReturnType<typeof setTimeout>;
  private polling?: Promise<void>;
  private failures = 0;
  private retryAt = 0;
  private generation = 0;
  private requestAgain = false;

  constructor(
    private readonly invoke: Invoke,
    readonly activity?: MailActivity,
  ) {}

  getStatus = () => this.status;
  getDiagnostics = async (): Promise<MailDiagnostics> => {
    const snapshot = await this.invoke<MailDiagnostics>('gmail_diagnostics');
    return { ...snapshot, retryAt: this.retryAt > Date.now() ? this.retryAt : undefined };
  };
  subscribeStatus = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };
  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener());
  }
  private async read<T>(operation: string, accountId?: ID, input?: unknown): Promise<T> {
    try {
      return await this.invoke<T>('gmail_read', { operation, accountId, input });
    } catch (e) {
      const error = e as { code?: string; message?: string; retryAfter?: number };
      const mapped = new MailServiceError(
        error.code === 'offline' ? 'offline' : error.code === 'not_found' ? 'not_found' : 'invalid',
        error.message ?? 'Gmail request failed',
      );
      Object.assign(mapped, { providerCode: error.code, retryAfter: error.retryAfter });
      throw mapped;
    }
  }
  async getAccounts(): Promise<Account[]> {
    const accounts = await this.read<Account[]>('accounts');
    this.accountId = accounts[0]?.id;
    if (this.accountId && this.listeners.size && !this.polling) this.schedule(0);
    return accounts;
  }
  getLabels = (id: ID) => this.read<Label[]>('labels', id);
  getMailboxCounts = (id: ID) => this.read<MailboxCounts>('counts', id);
  async getThreads(query: ThreadQuery): Promise<Page<ThreadSummary>> {
    const page = await this.read<Page<ThreadSummary>>('threads', query.accountId, query);
    // SQLite and IPC use null; the infinite-query contract uses undefined.
    return { ...page, nextCursor: page.nextCursor ?? undefined };
  }
  getThread = (accountId: ID, threadId: ID) => this.read<Thread>('thread', accountId, { threadId });

  private summaryQueue: {
    accountId: ID;
    threadId: ID;
    resolve: (summary: ThreadSummary) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
  }[] = [];
  private summaryTimer?: ReturnType<typeof setTimeout>;
  getThreadSummary = (accountId: ID, threadId: ID, signal?: AbortSignal): Promise<ThreadSummary> =>
    new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Conversation loading cancelled', 'AbortError'));
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      const clean = () => signal?.removeEventListener('abort', abort);
      this.summaryQueue.push({
        accountId,
        threadId,
        signal,
        resolve: (value) => {
          clean();
          resolve(value);
        },
        reject: (error) => {
          clean();
          reject(error);
        },
      });
      this.summaryTimer ??= setTimeout(() => {
        this.summaryTimer = undefined;
        void this.flushSummaries();
      }, 0);
    });

  private async flushSummaries() {
    const pending = this.summaryQueue.splice(0);
    for (const accountId of new Set(pending.map((p) => p.accountId))) {
      const requests = pending.filter((p) => p.accountId === accountId);
      while (requests.length) {
        const batch = requests.splice(0, 4).filter((p) => !p.signal?.aborted);
        if (!batch.length) continue;
        try {
          const summaries = await this.read<ThreadSummary[]>('summaries', accountId, {
            threadIds: batch.map((p) => p.threadId),
          });
          batch.forEach((p) => {
            const summary = summaries.find((s) => s.id === p.threadId);
            if (summary) p.resolve(summary);
            else p.reject(new MailServiceError('not_found', 'Conversation is unavailable'));
          });
        } catch (error) {
          batch.forEach((p) => p.reject(error));
        }
      }
    }
  }

  private action(accountId: ID, threadIds: ID[], action: string, value?: boolean, labelId?: ID) {
    return this.read<void>('action', accountId, { threadIds, action, value, labelId });
  }
  markRead = (id: ID, threads: ID[], value: boolean) => this.action(id, threads, 'markRead', value);
  setStarred = (id: ID, threads: ID[], value: boolean) =>
    this.action(id, threads, 'setStarred', value);
  archive = (id: ID, threads: ID[]) => this.action(id, threads, 'archive');
  trash = (id: ID, threads: ID[]) => this.action(id, threads, 'trash');
  restore = (id: ID, threads: ID[]) => this.action(id, threads, 'restore');
  markJunk = (id: ID, threads: ID[]) => this.action(id, threads, 'markJunk');
  notJunk = (id: ID, threads: ID[]) => this.action(id, threads, 'notJunk');
  deleteForever = (id: ID, threads: ID[]) => this.action(id, threads, 'deleteForever');
  addLabel = (id: ID, threads: ID[], label: ID) =>
    this.action(id, threads, 'addLabel', undefined, label);
  removeLabel = (id: ID, threads: ID[], label: ID) =>
    this.action(id, threads, 'removeLabel', undefined, label);
  moveToLabel = (id: ID, threads: ID[], label: ID) =>
    this.action(id, threads, 'moveToLabel', undefined, label);

  async connect() {
    this.setStatus({ state: 'connecting' });
    try {
      const account = await this.invoke<Account>('gmail_connect');
      this.accountId = account.id;
      this.schedule(0);
      this.setStatus({ state: 'idle' });
    } catch (e) {
      const error = e as { code?: string; message?: string };
      if (error.code === 'cancelled') {
        this.setStatus({ state: 'idle' });
        return;
      }
      this.setStatus({ state: 'error', message: error.message ?? 'Could not connect Gmail' });
      throw new Error(error.message ?? 'Could not connect Gmail', { cause: e });
    }
  }
  async cancelConnect() {
    await this.invoke('gmail_cancel_connect');
  }
  async disconnect(accountId: ID) {
    this.generation++;
    this.accountId = undefined;
    clearTimeout(this.timer);
    try {
      await this.read('disconnect', accountId);
      this.retryAt = 0;
      this.failures = 0;
      this.setStatus({ state: 'idle' });
    } catch (e) {
      this.accountId = accountId;
      throw e;
    }
  }
  async resetLocalChanges(accountId: ID) {
    await this.read('reset', accountId);
  }
  downloadAttachment = (accountId: ID, threadId: ID, messageId: ID, attachment: Attachment) =>
    this.invoke<void>('gmail_download', {
      accountId,
      threadId,
      messageId,
      attachmentId: attachment.id,
      filename: attachment.filename,
    }).catch((e: { message?: string }) => {
      throw new Error(e.message ?? 'Could not download attachment');
    });

  private schedule(delay?: number) {
    clearTimeout(this.timer);
    if (!this.listeners.size || !this.accountId) return;
    const cadence =
      typeof document !== 'undefined' &&
      (document.hidden || document.documentElement.hasAttribute('data-window-inactive'))
        ? 15_000
        : 3_000;
    this.timer = setTimeout(
      () => void this.refresh(),
      Math.max(delay ?? cadence, this.retryAt - Date.now()),
    );
  }
  refresh = (): Promise<void> => {
    clearTimeout(this.timer);
    if (this.polling) {
      this.requestAgain = true;
      return this.polling;
    }
    if (!this.accountId) return Promise.resolve();
    if (Date.now() < this.retryAt) {
      this.schedule(0);
      return Promise.resolve();
    }
    const accountId = this.accountId;
    const generation = this.generation;
    this.setStatus({ ...this.status, state: 'syncing' });
    let delay: number | undefined;
    this.polling = (async () => {
      try {
        const changed = await this.read<boolean>('sync', accountId);
        if (generation !== this.generation) return;
        this.failures = 0;
        this.retryAt = 0;
        this.setStatus({ state: 'idle', lastSyncedAt: Date.now() });
        if (changed) this.listeners.forEach((listener) => listener());
      } catch (e) {
        if (generation !== this.generation) return;
        const error = e as Error & { providerCode?: string; retryAfter?: number };
        this.failures++;
        delay = Math.max(
          Math.min(300_000, 3_000 * 2 ** Math.min(this.failures, 7)),
          (error.retryAfter ?? 0) * 1_000,
        );
        if (error.providerCode === 'auth' || error.providerCode === 'permission') delay = 300_000;
        this.retryAt = Date.now() + delay;
        this.setStatus({
          ...this.status,
          state: error.providerCode === 'auth' ? 'reauth' : 'error',
          message: error.message,
          retryAt: this.retryAt,
        });
      } finally {
        this.polling = undefined;
        if (generation === this.generation) {
          const again = this.requestAgain;
          this.requestAgain = false;
          this.schedule(again && delay === undefined ? 0 : delay);
        }
      }
    })();
    return this.polling;
  };

  private onBlur = () => {
    this.schedule();
  };
  private onWake = () => {
    void this.refresh();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      window.addEventListener('focus', this.onWake);
      window.addEventListener('blur', this.onBlur);
      window.addEventListener('online', this.onWake);
      document.addEventListener('visibilitychange', this.onWake);
      this.schedule(0);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearTimeout(this.timer);
        window.removeEventListener('focus', this.onWake);
        window.removeEventListener('blur', this.onBlur);
        window.removeEventListener('online', this.onWake);
        document.removeEventListener('visibilitychange', this.onWake);
      }
    };
  };
}
