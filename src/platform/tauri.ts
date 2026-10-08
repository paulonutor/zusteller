import { parseAccent } from './accent';
import type { NativeMenuItem, PlatformService } from './PlatformService';

/**
 * Tauri v2 host adapter. Uses the `window.__TAURI__` globals injected when
 * `app.withGlobalTauri = true` (src-tauri/tauri.conf.json), so the
 * frontend takes no `@tauri-apps/*` dependency.
 *
 * Rust side (src-tauri/src/lib.rs) provides:
 *   - command `notify { title, body }`   -> notification plugin
 *   - command `set_badge { count }`      -> window.set_badge_count
 *   - `plugin:opener|open_url { url }`   -> opener plugin, ACL-scoped to http/https/mailto
 *   - command `show_context_menu { items }` -> native popup; the pick comes back as event
 *     `zusteller://context-menu` (payload = item id; nothing on dismissal)
 *   - event  `zusteller://menu`          -> native menu clicks, payload = item id
 *
 * Wired: platform/index.ts maps item ids to host-neutral MenuActions (menuActions.ts),
 * which MailApp routes through the same handler as keyboard shortcuts.
 */

type Unlisten = () => void;

type TauriGlobal = {
  core: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
  event?: {
    listen(event: string, handler: (e: { payload: unknown }) => void): Promise<Unlisten>;
  };
};

export const TAURI_ACCENT_EVENT = 'zusteller://accent';
export const TAURI_MENU_EVENT = 'zusteller://menu';
export const TAURI_CONTEXT_MENU_EVENT = 'zusteller://context-menu';

function tauriGlobal(): TauriGlobal | undefined {
  const t = (globalThis as { __TAURI__?: Partial<TauriGlobal> }).__TAURI__;
  return t && typeof t.core?.invoke === 'function' ? (t as TauriGlobal) : undefined;
}

/** True when running inside the Tauri host (globals injected). */
export function isTauriHost(): boolean {
  return tauriGlobal() !== undefined;
}

function requireTauri(): TauriGlobal {
  const t = tauriGlobal();
  if (!t) throw new Error('Tauri runtime not available');
  return t;
}

let contextOff: Unlisten | undefined;

export function createTauriPlatformService(): Omit<PlatformService, 'subscribeMenuActions'> {
  return {
    async showNotification({ title, body }) {
      await requireTauri().core.invoke('notify', { title, body });
    },
    async setBadge(count) {
      await requireTauri().core.invoke('set_badge', { count: count ?? null });
    },
    async setWindowTheme(theme) {
      await requireTauri().core.invoke('set_window_theme', {
        theme: theme === 'system' ? null : theme,
      });
    },
    async getAccentColor() {
      return parseAccent(await requireTauri().core.invoke('accent_color'));
    },
    subscribeAccentColor(handler) {
      const listen = tauriGlobal()?.event?.listen;
      if (!listen) return () => {};
      let off: Unlisten | undefined;
      let cancelled = false;
      void listen(TAURI_ACCENT_EVENT, (e) => {
        const c = parseAccent(e.payload);
        if (c) handler(c);
      }).then((u) => (cancelled ? u() : (off = u)));
      return () => {
        cancelled = true;
        off?.();
      };
    },
    async showContextMenu(items: NativeMenuItem[], onSelect) {
      const t = requireTauri();
      const listen = t.event?.listen;
      if (!listen) throw new Error('Tauri events not available');
      // One-shot: the next pick belongs to this menu. Replace any listener left by a dismissed one.
      contextOff?.();
      contextOff = undefined;
      const off = await listen(TAURI_CONTEXT_MENU_EVENT, (e) => {
        off();
        if (contextOff === off) contextOff = undefined;
        if (typeof e.payload === 'string') onSelect(e.payload);
      });
      contextOff = off;
      try {
        await t.core.invoke('show_context_menu', { items });
      } catch (err) {
        off();
        throw err;
      }
    },
    async openExternal(url) {
      // Defence in depth; the Rust-side capability scope enforces the same list.
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new Error(`Refusing to open ${parsed.protocol} URL`);
      }
      await requireTauri().core.invoke('plugin:opener|open_url', { url: parsed.toString() });
    },
  };
}

/** Subscribe to native menu clicks (item ids like "mail.archive"). Returns an unsubscribe fn. */
export function onTauriMenuAction(handler: (itemId: string) => void): () => void {
  const listen = tauriGlobal()?.event?.listen;
  if (!listen) return () => {};
  let off: Unlisten | undefined;
  let cancelled = false;
  void listen(TAURI_MENU_EVENT, (e) => {
    if (typeof e.payload === 'string') handler(e.payload);
  }).then((u) => (cancelled ? u() : (off = u)));
  return () => {
    cancelled = true;
    off?.();
  };
}
