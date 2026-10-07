import {
  MailServiceError,
  SYSTEM_LABEL,
  isSystemLabelId,
  type Account,
  type Address,
  type ID,
  type Label,
  type MailService,
  type MailboxCounts,
  type Message,
  type Page,
  type SystemMailbox,
  type Thread,
  type ThreadQuery,
  type ThreadSummary,
} from '@/domain/mail';
import type { SeedData } from './seed';

export type MockLatency = number | { min: number; max: number };

export type MockMailOptions = {
  /** Simulated latency in ms. Default 150. Use 0 in tests. */
  latency?: MockLatency;
  /** Seed for the latency jitter PRNG so runs are reproducible. */
  seed?: number;
};

type MethodName = keyof MailService;

const DEFAULT_LIMIT = 25;
const SNIPPET_LENGTH = 140;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stripHtml = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const bodyText = (m: Message) => m.plainText ?? (m.html ? stripHtml(m.html) : '');
const clone = <T>(v: T): T => structuredClone(v);

/**
 * Stateful in-memory MailService. Mutations change what later queries return.
 * Thread semantics are documented in `domain/mail/semantics.ts`.
 */
export class MockMailService implements MailService {
  private accounts: Account[];
  private labels: Label[];
  private messages = new Map<ID, Message[]>(); // threadId -> messages (asc)
  private latency: MockLatency;
  private rand: () => number;
  private offline = false;
  private pendingFailures: { method?: MethodName; remaining: number }[] = [];

  constructor(seed: SeedData, options: MockMailOptions = {}) {
    const data = clone(seed);
    this.accounts = data.accounts;
    this.labels = data.labels;
    for (const m of data.messages) {
      const list = this.messages.get(m.threadId) ?? [];
      list.push(m);
      this.messages.set(m.threadId, list);
    }
    for (const list of this.messages.values()) {
      list.sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));
    }
    this.latency = options.latency ?? 150;
    this.rand = mulberry32(options.seed ?? 1);
  }

  // ---- test / dev controls (not part of MailService) -------------------

  setLatency(latency: MockLatency) {
    this.latency = latency;
  }
  setOffline(offline: boolean) {
    this.offline = offline;
  }
  /** Make the next `count` calls (optionally only to `method`) fail. */
  failNext(method?: MethodName, count = 1) {
    this.pendingFailures.push({ method, remaining: count });
  }
  clearFailures() {
    this.offline = false;
    this.pendingFailures = [];
  }

  // ---- reads -----------------------------------------------------------

  getAccounts() {
    return this.run('getAccounts', () => clone(this.accounts));
  }

  getLabels(accountId: ID) {
    return this.run('getLabels', () => {
      this.requireAccount(accountId);
      return clone(this.labels.filter((l) => l.accountId === accountId));
    });
  }

  getMailboxCounts(accountId: ID) {
    return this.run('getMailboxCounts', (): MailboxCounts => {
      this.requireAccount(accountId);
      const mailboxes: Record<SystemMailbox, number> = {
        inbox: 0,
        starred: 0,
        sent: 0,
        trash: 0,
        all: 0,
      };
      const labels: Record<ID, number> = {};
      for (const l of this.labels) if (l.type === 'user') labels[l.id] = 0;
      for (const list of this.messages.values()) {
        const s = this.summarize(list);
        if (s.accountId !== accountId || s.isRead) continue;
        for (const box of Object.keys(mailboxes) as SystemMailbox[]) {
          if (this.inMailbox(s, box)) mailboxes[box]++;
        }
        if (!s.labelIds.includes(SYSTEM_LABEL.trash)) {
          for (const id of s.labelIds) if (id in labels) labels[id] = (labels[id] ?? 0) + 1;
        }
      }
      return { mailboxes, labels };
    });
  }

  getThreads(query: ThreadQuery) {
    return this.run('getThreads', (): Page<ThreadSummary> => {
      this.requireAccount(query.accountId);
      const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, 200));
      const terms = (query.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const mailbox = query.mailbox ?? (query.labelId ? undefined : 'inbox');

      let matches: { summary: ThreadSummary; list: Message[] }[] = [];
      for (const list of this.messages.values()) {
        const summary = this.summarize(list);
        if (summary.accountId !== query.accountId) continue;
        if (mailbox && !this.inMailbox(summary, mailbox)) continue;
        if (query.labelId) {
          if (summary.labelIds.includes(SYSTEM_LABEL.trash) && query.labelId !== SYSTEM_LABEL.trash)
            continue;
          if (!summary.labelIds.includes(query.labelId)) continue;
        }
        if (terms.length && !this.matchesSearch(list, terms)) continue;
        matches.push({ summary, list });
      }

      // Total order: newest first, ties broken by id. Keyset cursor on that order means
      // mutations between pages can neither duplicate nor skip rows.
      matches.sort((a, b) => cmp(a.summary, b.summary));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        matches = matches.filter((m) => cmp(m.summary, c) > 0);
      }
      const items = matches.slice(0, limit).map((m) => m.summary);
      const last = items[items.length - 1];
      return {
        items: clone(items),
        nextCursor: matches.length > limit && last ? encodeCursor(last) : undefined,
      };
    });
  }

  getThread(accountId: ID, threadId: ID) {
    return this.run('getThread', (): Thread => {
      this.requireAccount(accountId);
      const list = this.requireThread(accountId, threadId);
      return clone({ ...this.summarize(list), messages: list });
    });
  }

  // ---- mutations -------------------------------------------------------

  markRead(accountId: ID, threadIds: ID[], read: boolean) {
    return this.mutate('markRead', accountId, threadIds, (m) => void (m.isRead = read));
  }

  setStarred(accountId: ID, threadIds: ID[], starred: boolean) {
    return this.mutate('setStarred', accountId, threadIds, (m) => void (m.isStarred = starred));
  }

  archive(accountId: ID, threadIds: ID[]) {
    return this.mutate('archive', accountId, threadIds, (m) =>
      this.removeId(m, SYSTEM_LABEL.inbox),
    );
  }

  trash(accountId: ID, threadIds: ID[]) {
    return this.mutate('trash', accountId, threadIds, (m) => {
      this.removeId(m, SYSTEM_LABEL.inbox);
      this.addId(m, SYSTEM_LABEL.trash);
    });
  }

  restore(accountId: ID, threadIds: ID[]) {
    return this.mutate('restore', accountId, threadIds, (m) => {
      this.removeId(m, SYSTEM_LABEL.trash);
      this.addId(m, SYSTEM_LABEL.inbox);
    });
  }

  addLabel(accountId: ID, threadIds: ID[], labelId: ID) {
    return this.mutate(
      'addLabel',
      accountId,
      threadIds,
      (m) => this.addId(m, labelId),
      () => this.requireUserLabel(accountId, labelId),
    );
  }

  removeLabel(accountId: ID, threadIds: ID[], labelId: ID) {
    return this.mutate(
      'removeLabel',
      accountId,
      threadIds,
      (m) => this.removeId(m, labelId),
      () => this.requireUserLabel(accountId, labelId),
    );
  }

  // ---- internals -------------------------------------------------------

  private async run<T>(method: MethodName, fn: () => T): Promise<T> {
    await this.delay();
    this.maybeFail(method);
    return fn();
  }

  private mutate(
    method: MethodName,
    accountId: ID,
    threadIds: ID[],
    apply: (m: Message) => void,
    validate?: () => void,
  ): Promise<void> {
    return this.run(method, () => {
      this.requireAccount(accountId);
      validate?.();
      // Validate everything first so a bad id cannot leave a half-applied batch.
      const lists = threadIds.map((id) => this.requireThread(accountId, id));
      for (const list of lists) for (const m of list) apply(m);
    });
  }

  private async delay() {
    const l = this.latency;
    const ms = typeof l === 'number' ? l : l.min + this.rand() * (l.max - l.min);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private maybeFail(method: MethodName) {
    if (this.offline) throw new MailServiceError('offline', 'You appear to be offline.');
    const i = this.pendingFailures.findIndex((f) => !f.method || f.method === method);
    const f = this.pendingFailures[i];
    if (f) {
      if (--f.remaining <= 0) this.pendingFailures.splice(i, 1);
      throw new MailServiceError('simulated', `Simulated failure in ${method}.`);
    }
  }

  private requireAccount(id: ID) {
    if (!this.accounts.some((a) => a.id === id))
      throw new MailServiceError('not_found', `Unknown account ${id}`);
  }

  private requireThread(accountId: ID, threadId: ID): Message[] {
    const list = this.messages.get(threadId);
    if (!list || list[0]?.accountId !== accountId)
      throw new MailServiceError('not_found', `Unknown thread ${threadId}`);
    return list;
  }

  private requireUserLabel(accountId: ID, labelId: ID) {
    const ok = this.labels.some(
      (l) => l.id === labelId && l.accountId === accountId && l.type === 'user',
    );
    if (!ok || isSystemLabelId(labelId))
      throw new MailServiceError('invalid', `Not a user label: ${labelId}`);
  }

  private addId(m: Message, id: ID) {
    if (!m.labelIds.includes(id)) m.labelIds.push(id);
  }
  private removeId(m: Message, id: ID) {
    m.labelIds = m.labelIds.filter((x) => x !== id);
  }

  private inMailbox(s: ThreadSummary, box: SystemMailbox): boolean {
    const trashed = s.labelIds.includes(SYSTEM_LABEL.trash);
    switch (box) {
      case 'trash':
        return trashed;
      case 'inbox':
        return !trashed && s.labelIds.includes(SYSTEM_LABEL.inbox);
      case 'sent':
        return !trashed && s.labelIds.includes(SYSTEM_LABEL.sent);
      case 'starred':
        return !trashed && s.isStarred;
      case 'all':
        return !trashed;
    }
  }

  private matchesSearch(list: Message[], terms: string[]): boolean {
    const haystack = list
      .map((m) =>
        [
          m.subject,
          addr(m.from),
          ...m.to.map(addr),
          ...(m.cc ?? []).map(addr),
          bodyText(m),
          ...m.attachments.map((a) => a.filename),
        ].join(' '),
      )
      .join(' ')
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  }

  private summarize(list: Message[]): ThreadSummary {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const labelIds = [...new Set(list.flatMap((m) => m.labelIds))];
    const seen = new Map<string, Address>();
    for (const m of list) {
      for (const a of [m.from, ...m.to]) {
        if (!seen.has(a.email.toLowerCase())) seen.set(a.email.toLowerCase(), a);
      }
    }
    return {
      id: first.threadId,
      accountId: first.accountId,
      subject: first.subject.replace(/^(re|fwd?|aw|wg):\s*/i, ''),
      participants: [...seen.values()],
      snippet: bodyText(last).slice(0, SNIPPET_LENGTH),
      messageCount: list.length,
      lastMessageAt: last.sentAt,
      isRead: list.every((m) => m.isRead),
      isStarred: list.some((m) => m.isStarred),
      labelIds,
      hasAttachments: list.some((m) => m.attachments.length > 0),
    };
  }
}

const addr = (a: Address) => `${a.name ?? ''} ${a.email}`;

type Key = { lastMessageAt: string; id: ID };
/** Newest first; id descending as the tie-breaker. */
const cmp = (a: Key, b: Key) =>
  a.lastMessageAt === b.lastMessageAt
    ? b.id.localeCompare(a.id)
    : b.lastMessageAt.localeCompare(a.lastMessageAt);

const encodeCursor = (k: Key) => btoa(JSON.stringify([k.lastMessageAt, k.id]));
function decodeCursor(c: string): Key {
  try {
    const [lastMessageAt, id] = JSON.parse(atob(c)) as [string, string];
    return { lastMessageAt, id };
  } catch {
    throw new MailServiceError('invalid', 'Invalid cursor');
  }
}
