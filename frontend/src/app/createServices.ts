import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import { createPlatformService } from '@/platform';
import type { Services } from './services';

/**
 * Composition root. Swapping MockMailService for a real provider happens here
 * (and only here). Dev/test query flags: ?latency=0  ?offline=1
 */
export function createServices(search = window.location.search): Services {
  const params = new URLSearchParams(search);
  const latency = Number(params.get('latency') ?? 150);
  const mail = new MockMailService(createSeedData(), {
    latency: Number.isFinite(latency) ? latency : 150,
  });
  if (params.get('offline') === '1') mail.setOffline(true);
  return { mail, platform: createPlatformService() };
}
