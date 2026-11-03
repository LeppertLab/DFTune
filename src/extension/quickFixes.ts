// Quick fixes (lightbulb, Ctrl+.) for diagnostics that carry a fix.

import * as vscode from 'vscode';
import type { Diagnostic } from '../core';

/**
 * Offers the fix of every diagnostic at the cursor. The diagnostics are computed again (they are
 * cheap) rather than kept from the last refresh, so the edit always matches the current text.
 */
export function registerQuickFixes(languageId: string, lint: (doc: vscode.TextDocument) => Promise<Diagnostic[]>): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    languageId,
    {
      async provideCodeActions(doc, range, context) {
        const version = doc.version;
        const diagnostics = await lint(doc);
        if (doc.version !== version) return [];
        const actions: vscode.CodeAction[] = [];
        for (const d of diagnostics) {
          if (!d.fix || !d.span) continue;
          const span = new vscode.Range(doc.positionAt(d.span.start), doc.positionAt(d.span.end));
          if (!span.intersection(range) && !span.contains(range)) continue;
          const action = new vscode.CodeAction(d.fix.title, vscode.CodeActionKind.QuickFix);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(doc.uri, new vscode.Range(doc.positionAt(d.fix.edit.start), doc.positionAt(d.fix.edit.end)), d.fix.edit.text);
          action.edit = edit;
          // Link to the Problems-panel entry, so the fix also shows there.
          action.diagnostics = context.diagnostics.filter((x) => x.message === d.message);
          action.isPreferred = d.code === 'unknown-tag' || d.code === 'alias';
          actions.push(action);
        }
        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );
}
