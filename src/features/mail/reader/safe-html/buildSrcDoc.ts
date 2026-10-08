export interface SrcDocOptions {
  dark: boolean;
  allowRemoteImages?: boolean;
}

export function buildCsp(allowRemoteImages: boolean): string {
  const img = allowRemoteImages ? 'data: cid: https:' : 'data: cid:';
  return [
    "default-src 'none'",
    `img-src ${img}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const BASE_CSS = `
html{margin:0;padding:0;overflow-x:hidden;color-scheme:light}
body{margin:0;padding:0;height:auto;overflow-x:hidden;
  font:13.5px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:#1f2328;background:transparent;overflow-wrap:anywhere;word-break:break-word}
.mail{box-sizing:border-box;max-width:100%;overflow-x:auto;overflow-y:hidden;padding:2px}
img,table,video{max-width:100%;height:auto}
table{border-collapse:collapse}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
a{color:#1a5fb4;text-decoration:underline;cursor:pointer}
blockquote{margin:0 0 0 .5em;padding-left:.8em;border-left:3px solid #c8ccd2}
`;

// Dark mode: HTML mail is authored for a light canvas, so recolouring it is unreliable. Instead we
// keep the content on a soft, dimmed paper surface (no pure-white glare) with rounded corners.
const DARK_CSS = `
.mail{background:#d9dce1;color:#1f2328;border-radius:8px;padding:12px}
img{filter:brightness(.92)}
`;

export function buildSrcDoc(sanitizedHtml: string, opts: SrcDocOptions): string {
  const csp = buildCsp(opts.allowRemoteImages === true);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<style>${BASE_CSS}${opts.dark ? DARK_CSS : ''}</style></head>
<body><div class="mail">${sanitizedHtml}</div></body></html>`;
}
