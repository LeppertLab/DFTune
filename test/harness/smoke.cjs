// Smoke test for the bundled extension: activates dist/extension.js against a stub of the
// vscode API and runs the registered providers on the fixtures. Catches wiring mistakes
// (wrong language id, provider not registered, crash on activation) that unit tests can't see.
// Run with `npm run smoke` after `npm run build`.
const Module = require('node:module');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const providers = { hover: {}, format: {}, completion: {} };
const collections = {};
class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
class Range { constructor(start, end) { Object.assign(this, { start, end }); } }
const disposable = { dispose() {} };
const event = () => disposable;
const vscode = {
  Position, Range,
  Selection: Range,
  Uri: { parse: (s) => ({ toString: () => s }), joinPath: (u, ...p) => ({ ...u, path: [u.path, ...p].join('/') }) },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
  MarkdownString: class { constructor(v = '') { this.value = v; } appendMarkdown(s) { this.value += s; return this; } },
  TextEdit: { replace: (range, newText) => ({ range, newText }) },
  CompletionItem: class { constructor(label) { this.label = label; } },
  CompletionItemKind: {}, CompletionItemTag: {},
  SnippetString: class { constructor(v) { this.value = v; } },
  ViewColumn: { One: 1, Beside: -2 },
  Disposable: { from: () => disposable },
  RelativePattern: class {},
  languages: {
    createDiagnosticCollection: (id) => (collections[id] = { map: new Map(), set(uri, d) { this.map.set(uri.toString(), d); }, delete() {}, dispose() {} }),
    registerHoverProvider: (id, p) => ((providers.hover[id] = p), disposable),
    registerDocumentFormattingEditProvider: (id, p) => ((providers.format[id] = p), disposable),
    registerCompletionItemProvider: (id, p) => ((providers.completion[id] = p), disposable),
  },
  workspace: {
    textDocuments: [],
    onDidOpenTextDocument: event, onDidChangeTextDocument: event, onDidCloseTextDocument: event,
    getConfiguration: () => ({ get: (_k, d) => d }),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
    fs: { readFile: async () => { throw new Error('no file'); } },
    asRelativePath: (u) => u.path,
  },
  window: { showWarningMessage: (m) => console.log('  warning shown:', m), showInformationMessage() {} },
  commands: { registerCommand: () => disposable, executeCommand() {} },
};
vscode.window.registerCustomEditorProvider = () => disposable;
const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? vscode : load(req, ...rest));

function doc(languageId, text, name) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return {
    languageId, isClosed: false,
    uri: { toString: () => `file:///${name}`, path: `/${name}` },
    getText: () => text,
    offsetAt: (p) => starts[p.line] + p.character,
    positionAt: (o) => { let l = 0; while (l + 1 < starts.length && starts[l + 1] <= o) l++; return new Position(l, o - starts[l]); },
    lineAt: (l) => ({ text: text.slice(starts[l], (starts[l + 1] ?? text.length + 1) - 1) }),
  };
}

const root = join(__dirname, '..', '..');
const fixtures = join(root, 'test', 'fixtures');
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

const ext = require(join(root, 'dist', 'extension.js'));
ext.activate({ subscriptions: [], extensionUri: { path: root } });
for (const id of ['incar', 'kpoints', 'poscar']) check(!!providers.format[id], `formatter registered for ${id}`);
for (const id of ['incar', 'poscar']) check(!!providers.hover[id], `hover registered for ${id}`);
check(!!providers.completion.incar, 'completion registered for incar');

const pos = readFileSync(join(fixtures, 'POSCAR'), 'utf8');
const pd = doc('poscar', pos, 'POSCAR');
const h = providers.hover.poscar.provideHover(pd, pd.positionAt(pos.indexOf('0.250 0.250 0.250')));
check(h && /Atom 7/.test(h.contents.value), `POSCAR hover: ${h && h.contents.value.split('\n')[0]}`);
const messy = pos.replace('Direct', 'direct').replace('6 8', '  6    8  ');
const edits = providers.format.poscar.provideDocumentFormattingEdits(doc('poscar', messy, 'POSCAR'));
check(edits.length === 1, 'POSCAR format gives one edit');
const kp = 'k\n0\ngamma\n4 4 4\n';
const kd = doc('kpoints', kp, 'KPOINTS');
const ke = providers.format.kpoints.provideDocumentFormattingEdits(kd);
const applied = ke.length === 1 && kp.slice(0, kd.offsetAt(ke[0].range.start)) + ke[0].newText + kp.slice(kd.offsetAt(ke[0].range.end));
check(applied === 'k\n0\nGamma\n4 4 4\n', 'KPOINTS format spells Gamma');
const bad = providers.format.kpoints.provideDocumentFormattingEdits(doc('kpoints', 'k\n0\nG\n4 x 4\n', 'KPOINTS'));
check(bad.length === 0, 'KPOINTS format refuses a file with errors');

// Diagnostics are debounced; open documents are linted on activation.
vscode.workspace.textDocuments.push(doc('poscar', 't\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nD\n0 0 0\n', 'POSCAR.bad'));
ext.activate({ subscriptions: [], extensionUri: { path: root } });
setTimeout(() => {
  const d = collections.poscar.map.get('file:///POSCAR.bad') ?? [];
  check(d.length === 1 && d[0].source === 'POSCAR' && d[0].severity === 0, `POSCAR diagnostics published: ${d.map((x) => x.message).join('; ')}`);
  process.exit(failed ? 1 : 0);
}, 400);
