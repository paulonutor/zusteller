import { createBrowserPlatformService } from './browser';
import type { PlatformService } from './PlatformService';

export type { PlatformService } from './PlatformService';

/** Single seam where a desktop host can be detected and its adapter chosen. */
export function createPlatformService(): PlatformService {
  return createBrowserPlatformService();
}
