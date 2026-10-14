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
.mail{box-sizing:border-box;max-width:100%;overflow-x:auto;overflow-y:hidden;padding:12px;
  background:#fff;color:#1f2328}
img,table,video{max-width:100%;height:auto}
table{border-collapse:collapse}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
a{color:#1a5fb4;text-decoration:underline;cursor:pointer}
blockquote{margin:0 0 0 .5em;padding-left:.8em;border-left:3px solid #c8ccd2}
details.zq{margin:6px 0}
details.zq>summary{display:flex;gap:8px;align-items:center;list-style:none;cursor:pointer;
  padding:6px 10px;border-radius:8px;background:#f2f4f7;color:#556;font-size:12.5px}
details.zq>summary::-webkit-details-marker{display:none}
details.zq>summary:hover{background:#e8ebf0}
.zq-chevron{flex:none;width:0;height:0;border-left:6px solid currentColor;border-top:4px solid transparent;
  border-bottom:4px solid transparent}
details.zq[open]>.zq-chevron,details.zq[open]>summary .zq-chevron{transform:rotate(90deg)}
.zq-count{flex:none;background:#dde1e7;border-radius:8px;padding:0 6px;font-size:11px}
.zq-preview{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#889}
details.zq[open]>summary .zq-preview{display:none}
`;

export function buildSrcDoc(sanitizedHtml: string, opts: SrcDocOptions): string {
  const csp = buildCsp(opts.allowRemoteImages === true);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<style>${BASE_CSS}</style></head>
<body><div class="mail">${sanitizedHtml}</div></body></html>`;
}
