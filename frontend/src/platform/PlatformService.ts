import type { MenuAction } from './menuActions';

/**
 * Native capabilities the UI may ask for. Host implementations (Wails, Tauri)
 * live behind this interface; feature code never imports host APIs.
 * Only capabilities that are actually implemented are listed here.
 */
export interface PlatformService {
  showNotification(notification: { title: string; body?: string }): Promise<void>;
  setBadge(count?: number): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Native menu clicks (desktop hosts). Returns an unsubscribe function; a no-op in the browser. */
  subscribeMenuActions(handler: (action: MenuAction) => void): () => void;
}
