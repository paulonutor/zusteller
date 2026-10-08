import type { MenuAction } from './menuActions';

/**
 * Native capabilities the UI may ask for. Host implementations (Tauri)
 * live behind this interface; feature code never imports host APIs.
 * Only capabilities that are actually implemented are listed here.
 */
/** Serializable context-menu description; `id` is echoed back to `onSelect` when chosen. */
export type NativeMenuItem =
  | { kind: 'item'; id: string; label: string; disabled?: boolean }
  | { kind: 'check'; id: string; label: string; checked: boolean }
  | { kind: 'separator' }
  | { kind: 'sub'; label: string; disabled?: boolean; items: NativeMenuItem[] };

export type ConfirmOptions = {
  title: string;
  /** Secondary text; say what happens and whether it can be undone. */
  message: string;
  /** Label of the confirming button, a verb ("Delete"), never "OK". */
  confirmLabel: string;
  /** Warning styling for irreversible actions. */
  destructive?: boolean;
};

export interface PlatformService {
  /** Ask the user to confirm. Native sheet on desktop hosts, `window.confirm` in the browser. Resolves false on cancel. */
  confirm(options: ConfirmOptions): Promise<boolean>;
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
  /**
   * Pop up a native context menu at the pointer. `onSelect` gets the chosen item id; nothing is
   * called on dismissal. Optional: the browser has no native menu, so the UI draws its own.
   */
  showContextMenu?(items: NativeMenuItem[], onSelect: (id: string) => void): Promise<void>;
  /** Native menu clicks (desktop hosts). Returns an unsubscribe function; a no-op in the browser. */
  subscribeMenuActions(handler: (action: MenuAction) => void): () => void;
}
