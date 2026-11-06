import * as vscode from 'vscode';
import { minimalEdit, setBgwKeywords } from '../core';
import { builderHtml } from './builderHtml';
import { textColumn } from './incarEditor';
import type { FromWebview, ToWebviewBgw } from './messages';

export const BGW_VIEW_TYPE = 'dftune.bgwBuilder';

/**
 * The BerkeleyGW builder: a webview bound to the input's text document. Like the other builders,
 * every change is a minimal WorkspaceEdit, so undo, git and the text editor stay in sync.
 */
export class BgwEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(BGW_VIEW_TYPE, new BgwEditorProvider(context), { webviewOptions: { retainContextWhenHidden: false } });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = builderHtml(panel.webview, dist, 'BerkeleyGW Builder', 'bgw');

    const post = () => {
      const message: ToWebviewBgw = { type: 'update-bgw', text: document.getText(), fileName: vscode.workspace.asRelativePath(document.uri) };
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
      case 'bgwSet': {
        const before = document.getText();
        const edit = minimalEdit(before, setBgwKeywords(before, msg.changes));
        if (edit) await replace(edit.start, edit.end, edit.text);
        break;
      }
      case 'applyEdit':
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
