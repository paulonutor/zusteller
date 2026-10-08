import type { PlatformService } from './PlatformService';

/**
 * Wails v3 host adapter. Talks to the Go host through the Wails JS runtime
 * WITHOUT the @wailsio/runtime npm package.
 *
 * Wails v3 does not inject a runtime object by itself: the host serves the
 * runtime ES module at `/wails/runtime.js`. We expose it as `window.wails`
 * (the same convention the Wails examples use) and import it lazily, so
 * nothing is fetched in browser mode. Tests/hosts may pre-set `window.wails`.
 *
 * Host side: hosts/wails (internal/platform.Service, menu.go).
 */

type WailsEvent = { name: string; data: unknown };

/** The subset of the Wails runtime module this adapter uses. */
export interface WailsRuntime {
  Call: { ByName(methodName: string, ...args: unknown[]): Promise<unknown> };
  Events: { On(name: string, cb: (event: WailsEvent) => void): () => void };
}

declare global {
  interface Window {
    wails?: Partial<WailsRuntime>;
  }
}

/** Fully-qualified Go method names (package path + type + method). */
const SERVICE = 'zusteller/hosts/wails/internal/platform.Service';
const RUNTIME_URL = '/wails/runtime.js';

/** Event emitted by the native menu; payload is a mail action id string. */
export const WAILS_MAIL_ACTION_EVENT = 'zusteller:mail-action';

/**
 * Payloads of WAILS_MAIL_ACTION_EVENT. All but 'find' are MailActionId values
 * (src/features/mail/actions.ts); see docs in hosts/wails/README.md.
 */
export type NativeMailAction = 'archive' | 'trash' | 'markRead' | 'markUnread' | 'star' | 'find';

function isRuntime(r: Window['wails']): r is WailsRuntime {
  return typeof r?.Call?.ByName === 'function' && typeof r?.Events?.On === 'function';
}

/** True when running inside the Wails host (WKWebView with Wails' `external` handler, or runtime present). */
export function isWailsHost(): boolean {
  if (typeof window === 'undefined') return false;
  if (isRuntime(window.wails)) return true;
  const w = window as unknown as {
    _wails?: unknown;
    webkit?: { messageHandlers?: { external?: unknown } };
  };
  return Boolean(w._wails) || Boolean(w.webkit?.messageHandlers?.external);
}

let loading: Promise<WailsRuntime> | undefined;

async function getRuntime(): Promise<WailsRuntime> {
  if (isRuntime(window.wails)) return window.wails;
  loading ??= import(/* @vite-ignore */ RUNTIME_URL).then((mod: unknown) => {
    const rt = mod as Window['wails'];
    if (!isRuntime(rt)) throw new Error('Wails runtime has an unexpected shape');
    window.wails = rt;
    return rt;
  });
  loading.catch(() => {
    loading = undefined; // allow retry
  });
  return loading;
}

export function createWailsPlatformService(): Omit<PlatformService, 'subscribeMenuActions'> {
  const call = async (method: string, ...args: unknown[]) => {
    const rt = await getRuntime();
    await rt.Call.ByName(`${SERVICE}.${method}`, ...args);
  };
  return {
    showNotification: ({ title, body }) => call('ShowNotification', title, body ?? ''),
    setBadge: (count) => call('SetBadge', count ?? 0),
    setWindowTheme: (theme) => call('SetWindowTheme', theme),
    async openExternal(url) {
      // Defence in depth; the Go side enforces the same allow-list.
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new Error(`Refusing to open ${parsed.protocol} URL`);
      }
      await call('OpenExternal', parsed.toString());
    },
  };
}

/**
 * Subscribe to native-menu mail actions. Returns an unsubscribe function.
 * Consumed via platform/index.ts (subscribeMenuActions); see hosts/wails/README.md.
 */
export async function onWailsMailAction(
  handler: (action: NativeMailAction) => void,
): Promise<() => void> {
  const rt = await getRuntime();
  return rt.Events.On(WAILS_MAIL_ACTION_EVENT, (event) => {
    const data = Array.isArray(event.data) ? event.data[0] : event.data;
    if (typeof data === 'string') handler(data as NativeMailAction);
  });
}
