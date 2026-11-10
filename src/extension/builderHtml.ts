// The HTML shell of a builder webview.

import * as vscode from 'vscode';

/** `app` tells the bundled webview which builder to render (the INCAR builder when empty); `bundle` picks the script (`viewer` for the structure viewer). */
export function builderHtml(webview: vscode.Webview, dist: vscode.Uri, title: string, app = '', bundle = 'webview'): string {
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, `${bundle}.js`));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, `${bundle}.css`));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style}" rel="stylesheet">
  <title>${title}</title>
</head>
<body>
  <div id="root"${app ? ` data-app="${app}"` : ''}></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
