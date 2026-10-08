import type { MenuAction } from './menuActions';

/**
 * Native capabilities the UI may ask for. Host implementations (Tauri)
 * live behind this interface; feature code never imports host APIs.
 * Only capabilities that are actually implemented are listed here.
 */
export interface PlatformService {
  showNotification(notification: { title: string; body?: string }): Promise<void>;
  setBadge(count?: number): Promise<void>;
  openExternal(url: string): Promise<void>;
  /**
   * Pin the native window appearance (and its vibrancy material) to the app theme; 'system' follows
   * the OS. Optional: only hosts that can change it at runtime implement it (the browser does not).
   */
  setWindowTheme?(theme: 'system' | 'light' | 'dark'): Promise<void>;
  /**
   * The user's macOS accent colour as `#rrggbb` (null when unknown). Optional: WKWebView resolves the
   * CSS system accent to default blue regardless of System Settings, so native hosts report it.
   */
  getAccentColor?(): Promise<string | null>;
  /** Called with the new `#rrggbb` when the system accent changes. Returns an unsubscribe function. */
  subscribeAccentColor?(handler: (color: string) => void): () => void;
  /** Native menu clicks (desktop hosts). Returns an unsubscribe function; a no-op in the browser. */
  subscribeMenuActions(handler: (action: MenuAction) => void): () => void;
}
