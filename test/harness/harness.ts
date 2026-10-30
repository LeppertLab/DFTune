// Runs the builder webview in a plain browser by standing in for the extension host:
// it serves a fixture INCAR/POSCAR and applies `setTags` messages with the same core code.

import { readPoscar, setTags } from '../../src/core';
import type { FromWebview, ToWebview } from '../../src/extension/messages';

declare global {
  interface Window {
    acquireVsCodeApi(): unknown;
    /** Current INCAR text, for inspection from the console or tests. */
    incarText(): string;
  }
}

const params = new URLSearchParams(location.search);
const incarName = params.get('incar') ?? 'INCAR';

async function main() {
  let text = await (await fetch(`/test/fixtures/${incarName}`)).text();
  const poscarResponse = await fetch('/test/fixtures/POSCAR');
  const poscarInfo = poscarResponse.ok && params.get('poscar') !== 'none' ? readPoscar(await poscarResponse.text()) : undefined;
  let state: unknown;

  const send = () => {
    const message: ToWebview = {
      type: 'update',
      text,
      fileName: `test/fixtures/${incarName}`,
      poscar: poscarInfo && { ...poscarInfo, fileName: 'POSCAR' },
    };
    window.postMessage(message, '*');
  };

  window.incarText = () => text;
  window.acquireVsCodeApi = () => ({
    postMessage(msg: FromWebview) {
      if (msg.type === 'ready') send();
      if (msg.type === 'setTags') {
        text = setTags(text, msg.changes);
        console.log('setTags', JSON.stringify(msg.changes));
        send();
      }
      if (msg.type === 'reveal') console.log('reveal', msg.offset, msg.end);
    },
    getState: () => state,
    setState: (s: unknown) => (state = s),
  });

  const script = document.createElement('script');
  script.src = '/dist/webview.js';
  document.body.appendChild(script);
}

main();
