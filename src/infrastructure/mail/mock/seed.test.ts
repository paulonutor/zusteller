import { describe, expect, it } from 'vitest';
import { createSeedData } from './seed';
import type { Message } from '@/domain/mail';

const byThread = (messages: Message[]): Map<string, Message[]> => {
  const m = new Map<string, Message[]>();
  for (const msg of messages) m.set(msg.threadId, [...(m.get(msg.threadId) ?? []), msg]);
  return m;
};

describe('createSeedData', () => {
  const seed = createSeedData();
  const threads = byThread(seed.messages);

  it('is deterministic', () => {
    expect(createSeedData()).toEqual(seed);
  });

  it('has enough threads and labels', () => {
    expect(threads.size).toBeGreaterThanOrEqual(50);
    expect(seed.labels.filter((l) => l.type === 'user').length).toBeGreaterThanOrEqual(8);
    expect(seed.accounts).toHaveLength(1);
  });

  it('has at least 10 starred non-trash threads', () => {
    const trashed = new Set(
      seed.messages.filter((m) => m.labelIds.includes('TRASH')).map((m) => m.threadId),
    );
    const starred = new Set(seed.messages.filter((m) => m.isStarred).map((m) => m.threadId));
    expect([...starred].filter((id) => !trashed.has(id)).length).toBeGreaterThanOrEqual(10);
  });

  it('references only known labels', () => {
    const ids = new Set(seed.labels.map((l) => l.id));
    for (const m of seed.messages) for (const id of m.labelIds) expect(ids.has(id)).toBe(true);
  });

  it('has strictly ascending sentAt within threads and no dates after now', () => {
    for (const msgs of threads.values()) {
      msgs.forEach((m, k) => {
        const prev = msgs[k - 1];
        if (prev) expect(Date.parse(m.sentAt)).toBeGreaterThan(Date.parse(prev.sentAt));
        expect(Date.parse(m.sentAt)).toBeLessThanOrEqual(Date.parse('2026-10-07T12:00:00.000Z'));
      });
    }
  });

  it('has junk threads (SPAM, never INBOX) including one with remote images', () => {
    const junkIds = [...threads.entries()]
      .filter(([, ms]) => ms.some((m) => m.labelIds.includes('SPAM')))
      .map(([id]) => id);
    expect(junkIds.length).toBeGreaterThanOrEqual(3);
    for (const id of junkIds)
      for (const m of threads.get(id)!) {
        expect(m.labelIds).not.toContain('INBOX');
        expect(m.labelIds).not.toContain('TRASH');
      }
    const pharma = threads.get('t-junk-pharma')!;
    expect(pharma.some((m) => /<img src="https:/.test(m.html ?? ''))).toBe(true);
    expect(pharma.some((m) => !m.isRead)).toBe(true);
    expect(seed.labels.find((l) => l.id === 'SPAM')).toMatchObject({
      type: 'system',
      name: 'Junk',
    });
  });

  it('contains the special threads', () => {
    for (const id of ['t-hostile', 't-wide', 't-long', 't-plain-only', 't-injection'])
      expect(threads.has(id)).toBe(true);
    expect(threads.get('t-long')?.length).toBe(8);
    expect(threads.get('t-plain-only')?.every((m) => !m.html)).toBe(true);
  });

  it('keeps trashed threads out of the inbox', () => {
    for (const msgs of threads.values()) {
      if (msgs.some((m) => m.labelIds.includes('TRASH')))
        for (const m of msgs) {
          expect(m.labelIds).toContain('TRASH');
          expect(m.labelIds).not.toContain('INBOX');
        }
    }
  });

  it('gives every message plain text and unique ids', () => {
    for (const m of seed.messages) expect(m.plainText?.length ?? 0).toBeGreaterThan(0);
    expect(new Set(seed.messages.map((m) => m.id)).size).toBe(seed.messages.length);
  });
});
