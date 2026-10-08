/**
 * `?debug=accent` shows what this webview resolves for the system accent colour, so a mismatch with
 * System Settings can be diagnosed on a real Mac. Plain DOM on purpose: independent of the app.
 */
export function wantsAccentDebug(search: string): boolean {
  return new URLSearchParams(search).get('debug') === 'accent';
}

const KEYWORDS = [
  'AccentColor',
  '-apple-system-control-accent',
  '-apple-system-selected-content-background',
  '-apple-system-unemphasized-selected-content-background',
] as const;

export function showAccentDebug(search: string = window.location.search): void {
  if (!wantsAccentDebug(search)) return;
  const panel = document.createElement('div');
  panel.setAttribute('role', 'status');
  panel.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:99999;padding:10px 12px;border-radius:10px;' +
    'font:12px/1.5 ui-monospace,Menlo,monospace;background:#111;color:#eee;border:1px solid #444;';
  const render = () => {
    const rows = KEYWORDS.map((k) => {
      const supported = CSS.supports('color', k);
      const probe = document.createElement('i');
      probe.style.color = supported ? k : '';
      document.body.append(probe);
      const resolved = supported ? getComputedStyle(probe).color : 'unsupported';
      probe.remove();
      const swatch = supported
        ? `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:6px;background:${k}"></span>`
        : '';
      return `<div>${swatch}${k}: ${resolved}</div>`;
    });
    const used = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    panel.innerHTML = `<b>accent debug</b>${rows.join('')}<div>--accent = ${used}</div>`;
  };
  render();
  window.addEventListener('focus', render);
  document.body.append(panel);
}
