import * as vscode from 'vscode';
import { detectProgram, minimalEdit, setVariables } from '../core';
import { builderHtml } from './builderHtml';
import { textColumn } from './incarEditor';
import { findPseudos } from './pseudos';
import type { FromWebview, ToWebviewQe } from './messages';

export const QE_VIEW_TYPE = 'dftune.qeBuilder';

/**
 * The Quantum ESPRESSO builder: a webview bound to the input's text document. Like the INCAR
 * builder, every change is a minimal WorkspaceEdit, so undo, git and the text editor stay in sync.
 */
export class QeEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(QE_VIEW_TYPE, new QeEditorProvider(context), { webviewOptions: { retainContextWhenHidden: false } });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = builderHtml(panel.webview, dist, 'Quantum ESPRESSO Builder', 'qe');

    // The pseudopotential lookup awaits the file system: a later post must not be overtaken by an earlier one.
    let latest = 0;
    const post = async () => {
      const mine = ++latest;
      const text = document.getText();
      const pseudos = await findPseudos(document.uri, text);
      if (mine !== latest) return;
      const message: ToWebviewQe = { type: 'update-qe', text, fileName: vscode.workspace.asRelativePath(document.uri), pseudos: pseudos && [...pseudos] };
      panel.webview.postMessage(message);
    };
    const disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) post();
      }),
      panel.webview.onDidReceiveMessage((msg: FromWebview) => this.handle(document, msg, post)),
    ];
    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }

  private async handle(document: vscode.TextDocument, msg: FromWebview, post: () => void) {
    const replace = async (start: number, end: number, text: string) => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
      await vscode.workspace.applyEdit(edit);
    };
    switch (msg.type) {
      case 'ready':
        post();
        break;
      case 'qeSet': {
        const before = document.getText();
        const after = setVariables(before, detectProgram(before) ?? 'pw', msg.changes);
        const edit = minimalEdit(before, after);
        if (edit) await replace(edit.start, edit.end, edit.text);
        break;
      }
      case 'applyEdit':
        // Only if the text is still the one the fix was computed for.
        if (document.getText() !== msg.text) return post();
        await replace(msg.edit.start, msg.edit.end, msg.edit.text);
        break;
      case 'reveal': {
        const editor = await vscode.window.showTextDocument(document, { viewColumn: textColumn(document.uri), preserveFocus: false });
        const range = new vscode.Range(document.positionAt(msg.offset), document.positionAt(msg.end ?? msg.offset));
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        break;
      }
    }
  }
}
