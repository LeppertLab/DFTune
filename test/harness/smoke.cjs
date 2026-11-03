// Smoke test for the bundled extension: activates dist/extension.js against a stub of the
// vscode API and runs the registered providers on the fixtures. Catches wiring mistakes
// (wrong language id, provider not registered, crash on activation) that unit tests can't see.
// Run with `npm run smoke` after `npm run build`.
const Module = require('node:module');
const { readFileSync, statSync } = require('node:fs');
const { join, posix } = require('node:path');

const providers = { hover: {}, format: {}, completion: {} };
const collections = {};
class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
class Range { constructor(start, end) { Object.assign(this, { start, end }); } }
const disposable = { dispose() {} };
const event = () => disposable;
const uri = (path) => ({ path, toString: () => `file://${path}` });
const vscode = {
  Position, Range,
  Selection: Range,
  Uri: { parse: (s) => uri(s.replace(/^file:\/\//, '')), joinPath: (u, ...p) => uri(posix.join(u.path, ...p)) },
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
    // The real file system, so sibling lookup (POSCAR next to KPOINTS, POTCAR next to POSCAR) runs for real.
    fs: { readFile: async (u) => readFileSync(u.path), stat: async (u) => ({ mtime: statSync(u.path).mtimeMs }) },
    asRelativePath: (u) => u.path,
  },
  window: { showWarningMessage: (m) => console.log('  warning shown:', m), showInformationMessage() {} },
  commands: { registerCommand: () => disposable, executeCommand() {} },
};
vscode.window.registerCustomEditorProvider = () => disposable;
const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? vscode : load(req, ...rest));

/** A document at test/fixtures/<name> (the file need not exist). */
function doc(languageId, text, name) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return {
    languageId, isClosed: false,
    uri: uri(join(fixtures, name)),
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
const pos = readFileSync(join(fixtures, 'POSCAR'), 'utf8');
// Open documents are linted on activation, with their neighbours: POSCAR.headers finds
// POTCAR.headers (same suffix); INCAR.headers finds that too, plus the plain POSCAR.
vscode.workspace.textDocuments.push(
  doc('poscar', 't\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nD\n0 0 0\n', 'POSCAR.bad'),
  doc('poscar', pos.replace('Fe O', 'O Fe'), 'POSCAR.headers'),
  doc('incar', 'ENCUT = 300\nISMEAR = 0\n', 'INCAR.headers'),
);
ext.activate({ subscriptions: [], extensionUri: { path: root } });

/** Applies a formatter's edits to `text`. */
function format(lang, text, name) {
  const d = doc(lang, text, name);
  const edits = providers.format[lang].provideDocumentFormattingEdits(d);
  if (!edits.length) return text;
  const [e] = edits;
  return text.slice(0, d.offsetAt(e.range.start)) + e.newText + text.slice(d.offsetAt(e.range.end));
}

(async () => {
  for (const id of ['incar', 'kpoints', 'poscar']) check(!!providers.format[id], `formatter registered for ${id}`);
  for (const id of ['incar', 'kpoints', 'poscar']) check(!!providers.hover[id], `hover registered for ${id}`);
  check(!!providers.completion.incar, 'completion registered for incar');

  const pd = doc('poscar', pos, 'POSCAR');
  const ph = await providers.hover.poscar.provideHover(pd, pd.positionAt(pos.indexOf('0.250 0.250 0.250')));
  check(ph && /Atom 7/.test(ph.contents.value), 'POSCAR hover describes the atom');
  check(format('poscar', pos.replace('Direct', 'direct'), 'POSCAR') === format('poscar', pos, 'POSCAR'), 'POSCAR format spells Direct');
  check(format('kpoints', 'k\n0\ngamma\n4 4 4\n', 'KPOINTS') === 'k\n0\nGamma\n4 4 4\n', 'KPOINTS format spells Gamma');
  check(format('kpoints', 'k\n0\nG\n4 x 4\n', 'KPOINTS') === 'k\n0\nG\n4 x 4\n', 'KPOINTS format refuses a file with errors');

  const kt = 'k\n0\nGamma\n4 4 4\n';
  const kd = doc('kpoints', kt, 'KPOINTS.smoke');
  const kh = await providers.hover.kpoints.provideHover(kd, kd.positionAt(kt.indexOf('4 4')));
  check(kh && /Spacing .* Å⁻¹/.test(kh.contents.value), 'KPOINTS hover uses the POSCAR next to it');
  const id = doc('incar', 'KSPACING = 0.3\n', 'INCAR.smoke');
  const ih = await providers.hover.incar.provideHover(id, new Position(0, 2));
  check(ih && /For POSCAR: a \d+ × \d+ × \d+ mesh/.test(ih.contents.value), 'KSPACING hover shows the mesh for the POSCAR');

  await new Promise((r) => setTimeout(r, 600)); // diagnostics are debounced
  const get = (lang, name) => collections[lang].map.get(`file://${join(fixtures, name)}`) ?? [];
  const bad = get('poscar', 'POSCAR.bad');
  check(bad.length === 1 && bad[0].source === 'POSCAR' && bad[0].severity === 0, `POSCAR diagnostics published: ${bad.map((x) => x.message).join('; ')}`);
  const swapped = get('poscar', 'POSCAR.headers');
  check(swapped.some((d) => /wrong order/.test(d.message)), 'POSCAR checked against the POTCAR next to it');
  const incar = get('incar', 'INCAR.headers');
  check(incar.some((d) => /below the largest ENMAX/.test(d.message)), 'INCAR ENCUT checked against the POTCAR');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
