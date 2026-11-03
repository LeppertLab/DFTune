// Smoke test for the bundled extension: activates dist/extension.js against a stub of the
// vscode API and runs the registered providers on the fixtures. Catches wiring mistakes
// (wrong language id, provider not registered, crash on activation) that unit tests can't see.
// Run with `npm run smoke` after `npm run build`.
const Module = require('node:module');
const { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, posix } = require('node:path');

const providers = { hover: {}, format: {}, completion: {}, actions: {} };
const commands = {};
const collections = {};
class Position { constructor(line, character) { Object.assign(this, { line, character }); } }
const before = (a, b) => a.line < b.line || (a.line === b.line && a.character <= b.character);
class Range {
  constructor(start, end) { Object.assign(this, { start, end }); }
  intersection(o) { return before(o.start, this.end) && before(this.start, o.end) ? this : undefined; }
  contains(o) { return before(this.start, o.start) && before(o.end, this.end); }
}
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
  CodeAction: class { constructor(title, kind) { Object.assign(this, { title, kind }); } },
  CodeActionKind: { QuickFix: 'quickfix' },
  WorkspaceEdit: class { constructor() { this.edits = []; } replace(uri, range, newText) { this.edits.push({ uri, range, newText }); } },
  FileType: { File: 1, Directory: 2 },
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
    registerCodeActionsProvider: (id, p) => ((providers.actions[id] = p), disposable),
  },
  workspace: {
    textDocuments: [],
    onDidOpenTextDocument: event, onDidChangeTextDocument: event, onDidCloseTextDocument: event,
    getConfiguration: () => ({ get: (_k, d) => d }),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
    // The real file system, so sibling lookup (POSCAR next to KPOINTS, POTCAR next to POSCAR) runs for real.
    fs: {
      readFile: async (u) => readFileSync(u.path),
      writeFile: async (u, data) => writeFileSync(u.path, data),
      stat: async (u) => { const st = statSync(u.path); return { mtime: st.mtimeMs, type: st.isDirectory() ? 2 : 1 }; },
    },
    asRelativePath: (u) => u.path,
  },
  window: {
    // Accepts "Replace?" prompts; other warnings are only printed.
    showWarningMessage: async (m, _opts, ...items) => (items.includes('Replace') ? 'Replace' : console.log('  warning shown:', m)),
    showInformationMessage() {},
    // Picks the second item when there is one (the "Standard" density), else the first.
    showQuickPick: async (items) => items[1] ?? items[0],
    showTextDocument: async () => {},
  },
  commands: { registerCommand: (id, fn) => ((commands[id] = fn), disposable), executeCommand() {} },
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
    version: 1,
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

  // Quick fixes, through the code-action provider.
  for (const id of ['incar', 'kpoints', 'poscar']) check(!!providers.actions[id], `quick fixes registered for ${id}`);
  const typo = doc('incar', 'ENCTU = 400\nISMEAR = 0\n', 'INCAR.typo');
  const acts = await providers.actions.incar.provideCodeActions(typo, new Range(new Position(0, 1), new Position(0, 1)), { diagnostics: [] });
  check(acts.length === 1 && acts[0].title === 'Change to ENCUT' && acts[0].edit.edits[0].newText === 'ENCUT', `INCAR quick fix: ${acts.map((a) => a.title)}`);
  // In a folder without a POSCAR the even Monkhorst–Pack note (and its fix) applies.
  const mp = doc('kpoints', 'k\n0\nMonkhorst-Pack\n4 4 4\n', '../no-such-folder/KPOINTS');
  const kacts = await providers.actions.kpoints.provideCodeActions(mp, new Range(new Position(2, 0), new Position(2, 0)), { diagnostics: [] });
  check(kacts.length === 1 && kacts[0].edit.edits[0].newText === 'Gamma', `KPOINTS quick fix: ${kacts.map((a) => a.title)}`);

  // Generate KPOINTS in a scratch folder with a copy of the POSCAR.
  check(!!commands['dftune.generateKpoints'], 'generate-KPOINTS command registered');
  const dir = mkdtempSync(join(tmpdir(), 'dftune-smoke-'));
  try {
    copyFileSync(join(fixtures, 'POSCAR'), join(dir, 'POSCAR'));
    await commands['dftune.generateKpoints'](uri(dir));
    const written = readFileSync(join(dir, 'KPOINTS'), 'utf8');
    check(/^0\nGamma\n\d+ \d+ \d+\n0 0 0\n$/.test(written.split('\n').slice(1).join('\n')), `KPOINTS generated: ${written.split('\n')[3]}`);
    // Run on a CONTCAR with no POSCAR around: the CONTCAR's own cell (the slab gives 5 5 2 at 0.3 Å⁻¹,
    // the POSCAR fixture 5 5 5).
    rmSync(join(dir, 'POSCAR'));
    copyFileSync(join(fixtures, 'CONTCAR.slab'), join(dir, 'CONTCAR'));
    await commands['dftune.generateKpoints'](uri(join(dir, 'CONTCAR')));
    const fromContcar = readFileSync(join(dir, 'KPOINTS'), 'utf8').split('\n')[3];
    check(fromContcar === '5 5 2', `KPOINTS generated from a CONTCAR: ${fromContcar}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

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
