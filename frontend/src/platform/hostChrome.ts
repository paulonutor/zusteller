import { isTauriHost } from './tauri';
import { isWailsHost } from './wails';

/**
 * Native window chrome helpers. Desktop hosts use an overlay titlebar (traffic lights float over
 * the web content), so the web UI must (a) leave room for them and (b) mark draggable regions in
 * the way each webview understands. The CSS `app-region` property is not honoured by either.
 */
export type NativeHost = 'tauri' | 'wails';

export function detectNativeHost(): NativeHost | null {
  if (isTauriHost()) return 'tauri';
  if (isWailsHost()) return 'wails';
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

/**
 * Spread onto elements that should drag the window. Tauri reads this attribute (only on the
 * element itself); Wails reads the `--wails-draggable` CSS property set in index.css.
 */
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
