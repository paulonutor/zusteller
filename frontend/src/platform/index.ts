import { createBrowserPlatformService } from './browser';
import { fromTauriItemId, type MenuAction } from './menuActions';
import type { PlatformService } from './PlatformService';
import { createTauriPlatformService, isTauriHost, onTauriMenuAction } from './tauri';

export type { PlatformService } from './PlatformService';
export type { MenuAction } from './menuActions';

type Subscribe = (handler: (action: MenuAction) => void) => () => void;

const tauriMenu: Subscribe = (handler) =>
  onTauriMenuAction((id) => {
    const a = fromTauriItemId(id);
    if (a) handler(a);
  });

/** Single seam where a desktop host is detected: Tauri, else browser. */
export function createPlatformService(): PlatformService {
  if (isTauriHost()) {
    return { ...createTauriPlatformService(), subscribeMenuActions: tauriMenu };
  }
  return createBrowserPlatformService();
}
