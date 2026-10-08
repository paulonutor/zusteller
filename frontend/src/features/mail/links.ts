/** Query parameters some mail handlers honour but which a message must never be able to set. */
const RISKY_MAILTO_PARAMS = new Set(['attach', 'attachment', 'bcc']);

/**
 * Prepares an external link for the host. `mailto:` links lose parameters that would attach local
 * files or silently add recipients; everything else is passed through unchanged.
 */
export function prepareExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^mailto:/i.test(trimmed)) return trimmed;
  const q = trimmed.indexOf('?');
  if (q < 0) return trimmed;
  const kept = trimmed
    .slice(q + 1)
    .split('&')
    .filter((pair) => {
      const name = pair.split('=')[0] ?? '';
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        /* keep the raw name */
      }
      return !RISKY_MAILTO_PARAMS.has(decoded.trim().toLowerCase());
    });
  return kept.length ? `${trimmed.slice(0, q)}?${kept.join('&')}` : trimmed.slice(0, q);
}
