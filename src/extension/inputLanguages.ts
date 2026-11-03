// Plain-text support for the positional input files (KPOINTS, POSCAR/CONTCAR): diagnostics in
// the Problems panel, Format Document and hovers.

import * as vscode from 'vscode';
import { formatKpoints, formatPoscar, minimalEdit, parseKpoints, parsePoscar, poscarHover, type Diagnostic } from '../core';
import { toVscodeDiagnostics } from './language';

interface InputLanguage {
  id: string;
  /** Shown as the diagnostics' source and in messages. */
  label: string;
  lint: (text: string) => Diagnostic[];
  format: (text: string) => string | undefined;
  hover?: (text: string, offset: number) => { markdown: string; start: number; end: number } | undefined;
}

const LANGUAGES: InputLanguage[] = [
  { id: 'kpoints', label: 'KPOINTS', lint: (t) => parseKpoints(t).diagnostics, format: formatKpoints },
  {
    id: 'poscar',
    label: 'POSCAR',
    lint: (t) => parsePoscar(t).diagnostics,
    format: formatPoscar,
    hover: (t, offset) => poscarHover(parsePoscar(t), offset),
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
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      if (doc.isClosed) return;
      collection.set(doc.uri, toVscodeDiagnostics(doc, lang.lint(doc.getText()), lang.label));
    }, 250));
  };

  for (const doc of vscode.workspace.textDocuments) refresh(doc);

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
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
  );
  if (lang.hover) {
    const hover = lang.hover;
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(lang.id, {
        provideHover(doc, position) {
          const h = hover(doc.getText(), doc.offsetAt(position));
          return h && new vscode.Hover(new vscode.MarkdownString(h.markdown), new vscode.Range(doc.positionAt(h.start), doc.positionAt(h.end)));
        },
      }),
    );
  }
}
