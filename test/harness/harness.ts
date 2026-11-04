// Runs the builder webview in a plain browser by standing in for the extension host:
// it serves a fixture INCAR/POSCAR and applies `setTags` messages with the same core code.

import { detectProgram, readKpoints, readPoscar, readPotcar, setTags, setVariables } from '../../src/core';
import type { FromWebview, ToWebview, ToWebviewQe } from '../../src/extension/messages';

declare global {
  interface Window {
    acquireVsCodeApi(): unknown;
    /** Current INCAR text, for inspection from the console or tests. */
    incarText(): string;
  }
}

const params = new URLSearchParams(location.search);
const incarName = params.get('incar') ?? 'INCAR';

/** ?app=qe&input=fe.relax.in: the Quantum ESPRESSO builder with a fixture from test/fixtures/qe. */
async function mainQe() {
  const name = params.get('input') ?? 'si.scf.in';
  let text = await (await fetch(`/test/fixtures/qe/${name}`)).text();
  let state: unknown;
  const send = () => window.postMessage({ type: 'update-qe', text, fileName: `test/fixtures/qe/${name}` } satisfies ToWebviewQe, '*');
  window.incarText = () => text;
  window.acquireVsCodeApi = () => ({
    postMessage(msg: FromWebview) {
      if (msg.type === 'ready') send();
      if (msg.type === 'qeSet') {
        text = setVariables(text, detectProgram(text) ?? 'pw', msg.changes);
        console.log('qeSet', JSON.stringify(msg.changes));
        send();
      }
      if (msg.type === 'applyEdit' && msg.text === text) {
        text = text.slice(0, msg.edit.start) + msg.edit.text + text.slice(msg.edit.end);
        send();
      }
      if (msg.type === 'reveal') console.log('reveal', msg.offset, msg.end);
    },
    getState: () => state,
    setState: (s: unknown) => (state = s),
  });
  document.getElementById('root')!.dataset.app = 'qe';
  const script = document.createElement('script');
  script.src = '/dist/webview.js';
  document.body.appendChild(script);
}

async function main() {
  if (params.get('app') === 'qe') return mainQe();
  let text = await (await fetch(`/test/fixtures/${incarName}`)).text();
  const poscarResponse = await fetch('/test/fixtures/POSCAR');
  const poscarInfo = poscarResponse.ok && params.get('poscar') !== 'none' ? readPoscar(await poscarResponse.text()) : undefined;
  // ?kpoints=KPOINTS.bands picks another fixture, ?kpoints=none simulates a directory without one.
  const kpointsName = params.get('kpoints') ?? 'KPOINTS';
  const kpointsResponse = kpointsName === 'none' ? undefined : await fetch(`/test/fixtures/${kpointsName}`);
  const kpointsInfo = kpointsResponse?.ok ? readKpoints(await kpointsResponse.text()) : undefined;
  // ?potcar=none simulates a directory without a POTCAR.
  const potcarResponse = params.get('potcar') === 'none' ? undefined : await fetch('/test/fixtures/POTCAR.headers');
  const potcarEntries = potcarResponse?.ok ? readPotcar(await potcarResponse.text()) : undefined;
  let state: unknown;

  const send = () => {
    const message: ToWebview = {
      type: 'update',
      text,
      fileName: `test/fixtures/${incarName}`,
      poscar: poscarInfo && { ...poscarInfo, fileName: 'POSCAR' },
      kpoints: kpointsInfo ? { ...kpointsInfo, fileName: kpointsName } : null,
      potcar: potcarEntries && { fileName: 'POTCAR', entries: potcarEntries },
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
      if (msg.type === 'applyEdit' && msg.text === text) {
        text = text.slice(0, msg.edit.start) + msg.edit.text + text.slice(msg.edit.end);
        console.log('applyEdit', JSON.stringify(msg.edit));
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
