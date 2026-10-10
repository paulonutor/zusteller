import { vi } from 'vitest';
import type { PlatformService } from '@/platform';

export function createTestPlatform(overrides: Partial<PlatformService> = {}): PlatformService {
  return {
    showNotification: vi.fn().mockResolvedValue(undefined),
    setBadge: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    setWindowTheme: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(true),
    subscribeMenuActions: () => () => {},
    ...overrides,
  };
}

/** Lets a test decide when a service call completes, without relying on elapsed time. */
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
