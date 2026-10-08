import type { PlatformService } from './PlatformService';
import { isTauriHost } from './tauri';

/**
 * Native window chrome helpers. Desktop hosts use an overlay titlebar (traffic lights float over
 * the web content), so the web UI must (a) leave room for them and (b) mark draggable regions in
 * the way the webview understands. The CSS `app-region` property is not honoured.
 */
export type NativeHost = 'tauri';

export function detectNativeHost(): NativeHost | null {
  if (isTauriHost()) return 'tauri';
  return null;
}

/** Sets `data-host` on <html> so CSS can inset the sidebar header and mark drag regions. */
export function applyHostChrome(search: string = window.location.search): void {
  const host = detectNativeHost();
  if (!host) return;
  const root = document.documentElement;
  root.dataset.host = host;
  if (wantsVibrancy(search)) root.dataset.vibrancy = '';
}

/** The host opens the page with `?vibrancy=1` when it enabled a native window material. */
export function wantsVibrancy(search: string): boolean {
  return new URLSearchParams(search).get('vibrancy') === '1';
}

/** Spread onto elements that should drag the window. Tauri reads this attribute (only on the element itself). */
export const dragRegionProps = { 'data-tauri-drag-region': '' } as const;

/** Mirrors window focus into `data-window-inactive` so selection can turn gray like native lists. */
export function trackWindowFocus(): void {
  const root = document.documentElement;
  const sync = () => {
    root.toggleAttribute('data-window-inactive', !document.hasFocus());
    // The accent colour can change in System Settings while we are in the background. Changing an
    // inherited custom property forces every system-colour consumer to be re-resolved.
    root.style.setProperty('--accent-tick', String(Date.now()));
  };
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  sync();
}

/**
 * WKWebView resolves the CSS system accent (`AccentColor`, `-apple-system-control-accent`) to default
 * blue whatever System Settings says, so native hosts report the real colour. It is exposed as
 * `--host-accent` (see skins.css), kept live by the host's change event and re-read on focus.
 */
export function trackNativeAccent(
  platform: Pick<PlatformService, 'getAccentColor' | 'subscribeAccentColor'>,
): void {
  const get = platform.getAccentColor;
  if (!get) return;
  const root = document.documentElement;
  const sync = () => {
    get.call(platform).then(
      (c) =>
        c ? root.style.setProperty('--host-accent', c) : root.style.removeProperty('--host-accent'),
      () => undefined,
    );
  };
  const set = (c: string) => root.style.setProperty('--host-accent', c);
  window.addEventListener('focus', sync);
  platform.subscribeAccentColor?.(set);
  sync();
}
