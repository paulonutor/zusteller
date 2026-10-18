import { MailServiceError, type Label, type Message } from '@/domain/mail';

/**
 * Opt-in "behaves like Gmail" profile for MockMailService. It models the parts of the real API
 * that shape the UI: per-call latency, the per-user quota (429 + Retry-After), transient 5xx,
 * page and batch limits, list stubs that need a follow-up fetch, search syntax and index lag.
 * Everything random comes from the mock's seeded PRNG, so runs stay reproducible.
 */
export type GmailBehaviorOptions = {
  /** Quota refill in units per second. Gmail allows 250 units/user/second. Default 250. */
  quotaUnitsPerSecond?: number;
  /** Largest burst the bucket holds, in units. Default equals one second of quota. */
  quotaBurst?: number;
  /** Probability that a call fails with a transient backend error. Default 0.005. */
  backendErrorRate?: number;
  /** How long a freshly delivered thread stays invisible to search, in ms. Default 4000. */
  searchIndexLagMs?: number;
  /** Replace the latency profile with a fixed number of ms (tests). */
  latency?: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export const GMAIL_MAX_PAGE_SIZE = 500;
export const GMAIL_MAX_BATCH_IDS = 1000;

/** Quota units from Gmail's "Usage limits" table. */
export const QUOTA_COST = {
  profile: 1,
  labelGet: 1,
  labelsList: 1,
  threadsList: 10,
  threadsGet: 10,
  threadsModify: 10,
  threadsDelete: 20,
} as const;

/** [min, max] round-trip ms per call, typical for a consumer connection to googleapis.com. */
export const LATENCY_MS: Record<string, [number, number]> = {
  getAccounts: [60, 160],
  getLabels: [60, 160],
  getMailboxCounts: [150, 400],
  getThreads: [180, 450],
  getThreadSummary: [90, 260],
  getThread: [120, 380],
  mutate: [150, 450],
};

export class GmailBehavior {
  readonly searchIndexLagMs: number;
  readonly fixedLatency?: number;
  private readonly rate: number;
  private readonly burst: number;
  private readonly errorRate: number;
  readonly now: () => number;
  private tokens: number;
  private updated: number;

  constructor(
    options: GmailBehaviorOptions,
    private readonly rand: () => number,
  ) {
    this.rate = options.quotaUnitsPerSecond ?? 250;
    this.burst = options.quotaBurst ?? this.rate;
    this.errorRate = options.backendErrorRate ?? 0.005;
    this.searchIndexLagMs = options.searchIndexLagMs ?? 4000;
    this.fixedLatency = options.latency;
    this.now = options.now ?? Date.now;
    this.tokens = this.burst;
    this.updated = this.now();
  }

  latency(method: string): number {
    if (this.fixedLatency !== undefined) return this.fixedLatency;
    const [min, max] = LATENCY_MS[method] ?? LATENCY_MS.mutate!;
    return min + this.rand() * (max - min);
  }

  /** Charge a call against the quota, or throw like Gmail does when the bucket is empty. */
  charge(units: number) {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.updated) / 1000) * this.rate);
    this.updated = t;
    if (this.tokens < units) {
      const seconds = Math.max(1, Math.ceil((units - this.tokens) / this.rate));
      throw new MailServiceError(
        'rate_limit',
        'User-rate limit exceeded. Retry after a short while.',
        seconds,
      );
    }
    this.tokens -= units;
    if (this.rand() < this.errorRate)
      throw new MailServiceError('offline', 'Google is unavailable (503 backendError).');
  }
}

// ---- search ------------------------------------------------------------

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const hasWords = (text: string, needle: string) => {
  const hay = words(text);
  const need = words(needle);
  if (!need.length) return true;
  return hay.some((_, i) => need.every((w, j) => hay[i + j] === w));
};

type Term = { negate: boolean; op?: string; value: string };

function parseTerms(q: string): Term[] {
  const out: Term[] = [];
  const re = /(-?)(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;
  for (const m of q.matchAll(re)) {
    const op = m[2]?.toLowerCase();
    const known = ['from', 'to', 'cc', 'subject', 'label', 'in', 'is', 'has', 'filename'];
    if (op && !known.includes(op)) {
      // Unknown "word:" is just text to Gmail.
      out.push({ negate: m[1] === '-', value: `${op} ${m[3] ?? m[4] ?? ''}` });
    } else out.push({ negate: m[1] === '-', op, value: m[3] ?? m[4] ?? '' });
  }
  return out;
}

const addrText = (a: { name?: string; email: string }) => `${a.name ?? ''} ${a.email}`;

/**
 * Gmail-style search: whole-word matching (not substrings), quoted phrases, `-negation`, and the
 * from:/to:/cc:/subject:/label:/in:/is:/has:/filename: operators. Terms are ANDed.
 */
export function gmailSearch(query: string, labels: Label[]): (thread: Message[]) => boolean {
  const terms = parseTerms(query);
  const labelId = (name: string) => {
    const n = name.toLowerCase().replace(/-/g, ' ');
    return labels.find((l) => l.id.toLowerCase() === n || l.name.toLowerCase() === n)?.id;
  };
  const test = (thread: Message[], t: Term): boolean => {
    const any = (f: (m: Message) => boolean) => thread.some(f);
    switch (t.op) {
      case 'from':
        return any((m) => hasWords(addrText(m.from), t.value));
      case 'to':
        return any((m) => m.to.some((a) => hasWords(addrText(a), t.value)));
      case 'cc':
        return any((m) => (m.cc ?? []).some((a) => hasWords(addrText(a), t.value)));
      case 'subject':
        return any((m) => hasWords(m.subject, t.value));
      case 'filename':
        return any((m) => m.attachments.some((a) => a.filename.toLowerCase().includes(t.value)));
      case 'label': {
        const id = labelId(t.value);
        return !!id && any((m) => m.labelIds.includes(id));
      }
      case 'in': {
        const v = t.value.toLowerCase();
        if (v === 'anywhere') return true;
        const id = { spam: 'SPAM', junk: 'JUNK' }[v] ?? v.toUpperCase();
        return any((m) => m.labelIds.includes(id) || m.labelIds.includes(labelId(v) ?? ''));
      }
      case 'is': {
        const v = t.value.toLowerCase();
        if (v === 'unread') return any((m) => !m.isRead);
        if (v === 'read') return thread.every((m) => m.isRead);
        if (v === 'starred') return any((m) => m.isStarred);
        return false;
      }
      case 'has':
        return t.value.toLowerCase() === 'attachment' && any((m) => m.attachments.length > 0);
      default:
        return any((m) =>
          hasWords(
            [
              m.subject,
              addrText(m.from),
              ...m.to.map(addrText),
              ...(m.cc ?? []).map(addrText),
              m.plainText ?? m.html?.replace(/<[^>]*>/g, ' ') ?? '',
            ].join(' '),
            t.value,
          ),
        );
    }
  };
  return (thread) => terms.every((t) => test(thread, t) !== t.negate);
}
