/** Accepts only a plain `#rrggbb` string from the host. */
export function parseAccent(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}
