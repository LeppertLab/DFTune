// Plain-text support for the positional input files (KPOINTS, POSCAR/CONTCAR): diagnostics in
// the Problems panel, Format Document and hovers. Both are checked against their neighbours:
// KPOINTS against the POSCAR (cell), POSCAR against the POTCAR (elements).

import * as vscode from 'vscode';
import { formatKpoints, formatPoscar, kpointsHover, lintKpoints, lintPoscar, minimalEdit, parsePoscar, poscarHover, type Diagnostic } from '../core';
import { FolderWatch, findPoscar, findPotcar } from './inputs';
import { toVscodeDiagnostics } from './language';
import { registerQuickFixes } from './quickFixes';

type HoverResult = { markdown: string; start: number; end: number } | undefined;

interface InputLanguage {
  id: string;
  /** Shown as the diagnostics' source and in messages. */
  label: string;
  lint: (text: string, uri: vscode.Uri) => Promise<Diagnostic[]>;
  format: (text: string) => string | undefined;
  hover: (text: string, offset: number, uri: vscode.Uri) => Promise<HoverResult>;
}

/** The cell of the POSCAR next to `uri`, when it could be read completely. */
async function cellNear(uri: vscode.Uri) {
  const info = (await findPoscar(uri))?.info;
  return info?.lattice && info.volume ? { lattice: info.lattice, volume: info.volume } : undefined;
}

const LANGUAGES: InputLanguage[] = [
  {
    id: 'kpoints',
    label: 'KPOINTS',
    lint: async (text, uri) => lintKpoints(text, await cellNear(uri)),
    format: formatKpoints,
    hover: async (text, offset, uri) => kpointsHover(text, offset, await cellNear(uri)),
  },
  {
    id: 'poscar',
    label: 'POSCAR',
    lint: async (text, uri) => lintPoscar(text, (await findPotcar(uri))?.info),
    format: formatPoscar,
    hover: async (text, offset) => poscarHover(parsePoscar(text), offset),
  },
];

export function registerInputLanguages(context: vscode.ExtensionContext) {
  for (const lang of LANGUAGES) register(context, lang);
}

function register(context: vscode.ExtensionContext, lang: InputLanguage) {
  const collection = vscode.languages.createDiagnosticCollection(lang.id);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (doc: vscode.TextDocument) => {
    if (doc.languageId !== lang.id) return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      const diagnostics = await lang.lint(doc.getText(), doc.uri);
      if (doc.isClosed) return;
      collection.set(doc.uri, toVscodeDiagnostics(doc, diagnostics, lang.label));
    }, 250));
  };
  // A neighbouring input file changed on disk: recheck the open files of this language there.
  const folders = new FolderWatch((dir) => {
    for (const d of vscode.workspace.textDocuments) if (FolderWatch.dirOf(d.uri) === dir) refresh(d);
  });
  const open = (doc: vscode.TextDocument) => {
    if (doc.languageId !== lang.id) return;
    folders.track(doc.uri);
    refresh(doc);
  };

  vscode.workspace.textDocuments.forEach(open);

  context.subscriptions.push(
    collection,
    folders,
    vscode.workspace.onDidOpenTextDocument(open),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId !== lang.id) return;
      folders.untrack(doc.uri);
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    }),
    vscode.languages.registerDocumentFormattingEditProvider(lang.id, {
      provideDocumentFormattingEdits(doc) {
        const before = doc.getText();
        const after = lang.format(before);
        if (after === undefined) {
          vscode.window.showWarningMessage(`${lang.label} not formatted: fix the errors in the Problems panel first, so no line gets misread.`);
          return [];
        }
        const edit = minimalEdit(before, after);
        return edit ? [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text)] : [];
      },
    }),
    registerQuickFixes(lang.id, (doc) => lang.lint(doc.getText(), doc.uri)),
    vscode.languages.registerHoverProvider(lang.id, {
      async provideHover(doc, position) {
        const h = await lang.hover(doc.getText(), doc.offsetAt(position), doc.uri);
        return h && new vscode.Hover(new vscode.MarkdownString(h.markdown), new vscode.Range(doc.positionAt(h.start), doc.positionAt(h.end)));
      },
    }),
  );
}
