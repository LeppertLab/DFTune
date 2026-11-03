// Plain-text KPOINTS support: diagnostics and Format Document.

import * as vscode from 'vscode';
import { formatKpoints, minimalEdit, parseKpoints } from '../core';
import { toVscodeDiagnostics } from './language';

export function registerKpointsFeatures(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection('kpoints');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'kpoints') return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      collection.set(doc.uri, toVscodeDiagnostics(doc, parseKpoints(doc.getText()).diagnostics, 'KPOINTS'));
    }, 250));
  };

  for (const doc of vscode.workspace.textDocuments) refresh(doc);

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      collection.delete(doc.uri);
    }),
    vscode.languages.registerDocumentFormattingEditProvider('kpoints', { provideDocumentFormattingEdits }),
  );
}

function provideDocumentFormattingEdits(doc: vscode.TextDocument): vscode.TextEdit[] {
  const before = doc.getText();
  const after = formatKpoints(before);
  if (after === undefined) {
    vscode.window.showWarningMessage('KPOINTS not formatted: fix the errors in the Problems panel first, so no line gets misread.');
    return [];
  }
  const edit = minimalEdit(before, after);
  return edit ? [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text)] : [];
}
