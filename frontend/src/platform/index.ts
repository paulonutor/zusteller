import { createBrowserPlatformService } from './browser';
import { fromTauriItemId, fromWailsPayload, type MenuAction } from './menuActions';
import type { PlatformService } from './PlatformService';
import { createTauriPlatformService, isTauriHost, onTauriMenuAction } from './tauri';
import { createWailsPlatformService, isWailsHost, onWailsMailAction } from './wails';

export type { PlatformService } from './PlatformService';
export type { MenuAction } from './menuActions';

type Subscribe = (handler: (action: MenuAction) => void) => () => void;

const wailsMenu: Subscribe = (handler) => {
  let off: (() => void) | undefined;
  let cancelled = false;
  onWailsMailAction((payload) => {
    const a = fromWailsPayload(payload);
    if (a) handler(a);
  }).then(
    (u) => (cancelled ? u() : (off = u)),
    () => undefined, // runtime unavailable: the menu simply does nothing
  );
  return () => {
    cancelled = true;
    off?.();
  };
};

const tauriMenu: Subscribe = (handler) =>
  onTauriMenuAction((id) => {
    const a = fromTauriItemId(id);
    if (a) handler(a);
  });

/** Single seam where a desktop host is detected: Wails, then Tauri, else browser. */
export function createPlatformService(): PlatformService {
  if (isWailsHost()) {
    return { ...createWailsPlatformService(), subscribeMenuActions: wailsMenu };
  }
  if (isTauriHost()) {
    return { ...createTauriPlatformService(), subscribeMenuActions: tauriMenu };
  }
  return createBrowserPlatformService();
}
