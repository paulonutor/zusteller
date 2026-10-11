import type { MailConnection } from './connection';

/**
 * Provider-neutral mail domain model. Nothing in here may reference a concrete
 * provider (Gmail), a host (Tauri) or a UI library.
 */
export type ID = string;
export type SystemMailbox = 'inbox' | 'starred' | 'sent' | 'junk' | 'trash' | 'all';

export type Address = { name?: string; email: string };
export type Account = {
  id: ID;
  email: string;
  displayName: string;
  avatarUrl?: string;
  /** Native provider replaced private content before returning it to the UI. */
  privacyProtected?: boolean;
};
export type Label = {
  id: ID;
  accountId: ID;
  name: string;
  type: 'system' | 'user';
  color?: string;
};
export type Attachment = { id: ID; filename: string; mimeType: string; size: number };

export type Message = {
  id: ID;
  threadId: ID;
  accountId: ID;
  from: Address;
  to: Address[];
  cc?: Address[];
  subject: string;
  /** ISO-8601 timestamp. */
  sentAt: string;
  plainText?: string;
  /** Untrusted HTML. Must be sanitized before rendering. */
  html?: string;
  isRead: boolean;
  isStarred: boolean;
  labelIds: ID[];
  attachments: Attachment[];
};

export type ThreadSummary = {
  id: ID;
  accountId: ID;
  subject: string;
  participants: Address[];
  snippet: string;
  messageCount: number;
  lastMessageAt: string;
  isRead: boolean;
  isStarred: boolean;
  labelIds: ID[];
  hasAttachments: boolean;
  /** List membership is known; row details have not been loaded yet. */
  metadataPending?: boolean;
};

export type Thread = ThreadSummary & { messages: Message[] };
export type Page<T> = { items: T[]; nextCursor?: string; stale?: boolean };

export type ThreadQuery = {
  accountId: ID;
  mailbox?: SystemMailbox;
  labelId?: ID;
  search?: string;
  cursor?: string;
  limit?: number;
};

/**
 * Unread thread counts for the sidebar. Added to the plan's contract because
 * correct counts cannot be derived from paginated `getThreads` results.
 */
export type MailboxCounts = {
  mailboxes: Record<SystemMailbox, number>;
  labels: Record<ID, number>;
  /** Provider counts may differ from local preview membership. */
  estimated?: boolean;
};

export interface MailService {
  readonly localPreview?: boolean;
  readonly connection?: MailConnection;
  downloadAttachment?(
    accountId: ID,
    threadId: ID,
    messageId: ID,
    attachment: Attachment,
  ): Promise<void>;
  getAccounts(): Promise<Account[]>;
  getLabels(accountId: ID): Promise<Label[]>;
  getMailboxCounts(accountId: ID): Promise<MailboxCounts>;
  getThreads(query: ThreadQuery): Promise<Page<ThreadSummary>>;
  getThread(accountId: ID, threadId: ID): Promise<Thread>;
  /** Optional lazy row metadata; message bodies are fetched only by getThread. */
  getThreadSummary?(accountId: ID, threadId: ID, signal?: AbortSignal): Promise<ThreadSummary>;
  markRead(accountId: ID, threadIds: ID[], read: boolean): Promise<void>;
  setStarred(accountId: ID, threadIds: ID[], starred: boolean): Promise<void>;
  archive(accountId: ID, threadIds: ID[]): Promise<void>;
  trash(accountId: ID, threadIds: ID[]): Promise<void>;
  restore(accountId: ID, threadIds: ID[]): Promise<void>;
  markJunk(accountId: ID, threadIds: ID[]): Promise<void>;
  notJunk(accountId: ID, threadIds: ID[]): Promise<void>;
  /** Permanently removes threads that are in Junk or Trash. Rejects (`invalid`) for any other thread. */
  deleteForever(accountId: ID, threadIds: ID[]): Promise<void>;
  /**
   * Optional push/poll hook: `listener` runs when mail changed outside this app's own actions
   * (new mail). Returns an unsubscribe function. The UI refetches its lists when it fires.
   */
  subscribe?(listener: () => void): () => void;
  addLabel(accountId: ID, threadIds: ID[], labelId: ID): Promise<void>;
  /** File under a user label and remove Inbox membership in one operation. Failure leaves the batch unchanged. */
  moveToLabel(accountId: ID, threadIds: ID[], labelId: ID): Promise<void>;
  removeLabel(accountId: ID, threadIds: ID[], labelId: ID): Promise<void>;
}

export type MailErrorCode = 'offline' | 'simulated' | 'not_found' | 'invalid';

export class MailServiceError extends Error {
  readonly code: MailErrorCode;
  readonly retryAfter?: number;
  constructor(code: MailErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'MailServiceError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
