export type Skin = 'a' | 'b' | 'c';

/** Experimental visual skins, picked once at startup via `?skin=a|b|c`. Absent = default look. */
export function readSkinParam(search: string = window.location.search): Skin | null {
  const v = new URLSearchParams(search).get('skin');
  return v === 'a' || v === 'b' || v === 'c' ? v : null;
}

export function applySkin(): void {
  const skin = readSkinParam();
  if (skin) document.documentElement.dataset.skin = skin;
}

/** `?theme=dark` forces dark for this page load (not persisted). */
export function readThemeOverride(search: string = window.location.search): 'dark' | null {
  return new URLSearchParams(search).get('theme') === 'dark' ? 'dark' : null;
}
