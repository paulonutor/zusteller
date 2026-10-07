export type Skin = 'a' | 'b' | 'c';

/**
 * Visual skins (B in both themes, A/C dark only), picked once at startup via `?skin=a|b|c|default`.
 * Skin B ("Gmail-in-glass") is the default; `?skin=default` restores the plain look.
 */
export function readSkinParam(search: string = window.location.search): Skin | null {
  const v = new URLSearchParams(search).get('skin');
  if (v === 'default') return null;
  return v === 'a' || v === 'b' || v === 'c' ? v : 'b';
}

export function applySkin(): void {
  const skin = readSkinParam();
  if (skin) document.documentElement.dataset.skin = skin;
}

/** `?theme=dark` forces dark for this page load (not persisted). */
export function readThemeOverride(search: string = window.location.search): 'dark' | null {
  return new URLSearchParams(search).get('theme') === 'dark' ? 'dark' : null;
}
