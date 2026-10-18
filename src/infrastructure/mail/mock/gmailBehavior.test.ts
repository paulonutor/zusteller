import { describe, expect, it } from 'vitest';
import { MailServiceError } from '@/domain/mail';
import { MockMailService } from './MockMailService';
import { createSeedData } from './seed';

const seed = createSeedData();
const A = seed.accounts[0]!.id;

function gmail(options: Record<string, unknown> = {}, now = () => 0) {
  return new MockMailService(createSeedData(), {
    gmail: { latency: 0, backendErrorRate: 0, now, ...options },
  });
}

describe('gmail behaviour', () => {
  it('is off by default', async () => {
    const svc = new MockMailService(createSeedData(), { latency: 0 });
    expect(svc.getThreadSummary).toBeUndefined();
    const page = await svc.getThreads({ accountId: A, mailbox: 'inbox' });
    expect(page.items.every((t) => !t.metadataPending)).toBe(true);
  });

  it('lists stubs and hydrates them through getThreadSummary', async () => {
    const svc = gmail();
    const { items } = await svc.getThreads({ accountId: A, mailbox: 'inbox' });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t) => t.metadataPending && t.subject === '')).toBe(true);
    const full = await svc.getThreadSummary!(A, items[0]!.id);
    expect(full.metadataPending).toBeUndefined();
    expect(full.subject).not.toBe('');
  });

  it('rate limits with a retry-after once the quota bucket is empty, then recovers', async () => {
    let t = 0;
    const svc = gmail({ quotaUnitsPerSecond: 100, quotaBurst: 100 }, () => t);
    for (let i = 0; i < 10; i++) await svc.getThreads({ accountId: A }); // 10 x 10 units
    const err = await svc.getThreads({ accountId: A }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailServiceError);
    expect(err).toMatchObject({ code: 'rate_limit', retryAfter: 1 });
    t = 1000;
    await expect(svc.getThreads({ accountId: A })).resolves.toBeDefined();
  });

  it('charges mutations per thread', async () => {
    const svc = gmail({ quotaUnitsPerSecond: 100, quotaBurst: 100 });
    const ids = (await svc.getThreads({ accountId: A, limit: 12 })).items.map((t) => t.id);
    await expect(svc.markRead(A, ids, true)).rejects.toMatchObject({ code: 'rate_limit' });
  });

  it('rejects batches over 1000 ids', async () => {
    const svc = gmail({ quotaBurst: 1e9 });
    const ids = Array.from({ length: 1001 }, (_, i) => `x${i}`);
    await expect(svc.archive(A, ids)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('fails transiently like a 503 and is reproducible', async () => {
    const svc = gmail({ backendErrorRate: 1 });
    await expect(svc.getLabels(A)).rejects.toMatchObject({ code: 'offline' });
  });

  it('searches whole words with operators and negation, not substrings', async () => {
    const svc = gmail();
    const search = async (q: string) =>
      (await svc.getThreads({ accountId: A, mailbox: 'all', search: q, limit: 500 })).items.length;
    const all = await search('is:read OR is:unread'); // unknown OR token is plain text: no match
    expect(all).toBe(0);
    const unread = await search('is:unread');
    const read = await search('is:read');
    expect(unread).toBeGreaterThan(0);
    expect(unread + read).toBeGreaterThan(0);
    expect(await search('is:unread -is:unread')).toBe(0);
    expect(await search('has:attachment')).toBeGreaterThan(0);
    // a partial word does not match
    expect(await search('inv')).toBe(0);
  });

  it('hides brand-new mail from search until the index catches up', async () => {
    let t = 0;
    const svc = gmail({ searchIndexLagMs: 5000 }, () => t);
    svc.simulateIncoming('Zebracorn sighting');
    const find = async () =>
      (await svc.getThreads({ accountId: A, search: 'zebracorn' })).items.length;
    expect(await find()).toBe(0);
    expect((await svc.getThreads({ accountId: A })).items.length).toBeGreaterThan(0);
    t = 5000;
    expect(await find()).toBe(1);
  });
});
