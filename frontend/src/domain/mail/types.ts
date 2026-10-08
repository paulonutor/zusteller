/**
 * Provider-neutral mail domain model. Nothing in here may reference a concrete
 * provider (Gmail), a host (Tauri) or a UI library.
 */
export type ID = string;
export type SystemMailbox = 'inbox' | 'starred' | 'sent' | 'trash' | 'all';

export type Address = { name?: string; email: string };
export type Account = { id: ID; email: string; displayName: string; avatarUrl?: string };
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
};

export type Thread = ThreadSummary & { messages: Message[] };
export type Page<T> = { items: T[]; nextCursor?: string };

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
};

export interface MailService {
  getAccounts(): Promise<Account[]>;
  getLabels(accountId: ID): Promise<Label[]>;
  getMailboxCounts(accountId: ID): Promise<MailboxCounts>;
  getThreads(query: ThreadQuery): Promise<Page<ThreadSummary>>;
  getThread(accountId: ID, threadId: ID): Promise<Thread>;
  markRead(accountId: ID, threadIds: ID[], read: boolean): Promise<void>;
  setStarred(accountId: ID, threadIds: ID[], starred: boolean): Promise<void>;
  archive(accountId: ID, threadIds: ID[]): Promise<void>;
  trash(accountId: ID, threadIds: ID[]): Promise<void>;
  restore(accountId: ID, threadIds: ID[]): Promise<void>;
  addLabel(accountId: ID, threadIds: ID[], labelId: ID): Promise<void>;
  removeLabel(accountId: ID, threadIds: ID[], labelId: ID): Promise<void>;
}

export type MailErrorCode = 'offline' | 'simulated' | 'not_found' | 'invalid';

export class MailServiceError extends Error {
  readonly code: MailErrorCode;
  constructor(code: MailErrorCode, message: string) {
    super(message);
    this.name = 'MailServiceError';
    this.code = code;
  }
}
