import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import type { SeedData } from '@/infrastructure/mail/mock/seed';
import { createPlatformService } from '@/platform';
import type { Services } from './services';

/** Dev-only: pad the seed with N single-message threads cloned deterministically from it. */
function withBigSeed(seed: SeedData, n: number): SeedData {
  const base = seed.messages.filter((m) => m.id.endsWith('-m1'));
  const t0 = Date.parse(base.reduce((a, m) => (m.sentAt > a ? m.sentAt : a), ''));
  const extra = Array.from({ length: n }, (_, i) => {
    const m = base[i % base.length]!;
    return {
      ...m,
      id: `big${i}-m1`,
      threadId: `big${i}`,
      subject: `${m.subject} #${i + 1}`,
      sentAt: new Date(t0 - (i + 1) * 7 * 60_000).toISOString(),
      labelIds: m.labelIds.includes('INBOX') ? m.labelIds : [...m.labelIds, 'INBOX'],
    };
  });
  return { ...seed, messages: [...seed.messages, ...extra] };
}

/**
 * Composition root. Swapping MockMailService for a real provider happens here
 * (and only here). Dev/test query flags: ?latency=0  ?offline=1  ?seed=big[:N] (dev builds only)  ?newmail=<seconds>
 */
export function createServices(search = window.location.search): Services {
  const params = new URLSearchParams(search);
  const latency = Number(params.get('latency') ?? 150);
  let seed = createSeedData();
  const big = params.get('seed');
  if (import.meta.env.DEV && big?.startsWith('big'))
    seed = withBigSeed(seed, Number(big.split(':')[1]) || 3000);
  const mail = new MockMailService(seed, {
    latency: Number.isFinite(latency) ? latency : 150,
  });
  if (params.get('offline') === '1') mail.setOffline(true);
  // Demo: ?newmail=5 delivers a new message every 5 seconds (exercises the arrival animation).
  const every = Number(params.get('newmail'));
  if (every > 0) {
    const subjects = ['Quick question', 'Lunch tomorrow?', 'Invoice 2026-114', 'Re: Design review'];
    let i = 0;
    setInterval(() => mail.simulateIncoming(subjects[i++ % subjects.length]), every * 1000);
  }
  return { mail, platform: createPlatformService() };
}
