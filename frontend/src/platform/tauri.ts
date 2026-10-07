import type { PlatformService } from './PlatformService';

/**
 * Tauri v2 host adapter. Uses the `window.__TAURI__` globals injected when
 * `app.withGlobalTauri = true` (hosts/tauri/src-tauri/tauri.conf.json), so the
 * frontend takes no `@tauri-apps/*` dependency.
 *
 * Rust side (hosts/tauri/src-tauri/src/lib.rs) provides:
 *   - command `notify { title, body }`   -> notification plugin
 *   - command `set_badge { count }`      -> window.set_badge_count
 *   - `plugin:opener|open_url { url }`   -> opener plugin, ACL-scoped to http/https/mailto
 *   - event  `zusteller://menu`          -> native menu clicks, payload = item id
 *
 * NOT WIRED: native menu -> mail action mapping (item id -> features/mail/actions.ts):
 *   mail.archive    -> 'archive'
 *   mail.trash      -> 'trash'
 *   mail.markRead   -> 'markRead'
 *   mail.markUnread -> 'markUnread'
 *   mail.star       -> 'star' | 'unstar' (menu item is a toggle; pick via resolveActions)
 *   mail.find       -> no MailActionId yet; needs a search-focus action
 * 'restore' has no menu item. Route through `useMailActions().run`, not new logic.
 */

type Unlisten = () => void;

type TauriGlobal = {
  core: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
  event?: {
    listen(event: string, handler: (e: { payload: unknown }) => void): Promise<Unlisten>;
  };
};

export const TAURI_MENU_EVENT = 'zusteller://menu';

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

export function createTauriPlatformService(): PlatformService {
  return {
    async showNotification({ title, body }) {
      await requireTauri().core.invoke('notify', { title, body });
    },
    async setBadge(count) {
      await requireTauri().core.invoke('set_badge', { count: count ?? null });
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
