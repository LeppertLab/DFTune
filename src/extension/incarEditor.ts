import * as vscode from 'vscode';
import { minimalEdit, setTags } from '../core';
import type { FromWebview, ToWebview } from './messages';
import { builderHtml } from './builderHtml';
import { findInputs, watchInputs } from './inputs';

export const VIEW_TYPE = 'dftune.incarBuilder';

/**
 * The INCAR builder: a webview bound to the INCAR text document. All edits go through
 * WorkspaceEdits, so undo/redo, dirty state, git and the plain text editor stay in sync.
 */
export class IncarEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, new IncarEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: false },
    });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = builderHtml(panel.webview, dist, 'INCAR Builder');

    const post = async () => {
      const { poscar, kpoints, potcar } = await findInputs(document.uri);
      const message: ToWebview = {
        type: 'update',
        text: document.getText(),
        fileName: vscode.workspace.asRelativePath(document.uri),
        poscar: poscar && { ...poscar.info, fileName: poscar.fileName },
        kpoints: kpoints ? { ...kpoints.info, fileName: kpoints.fileName } : null,
        potcar: potcar && { fileName: potcar.fileName, entries: potcar.info },
      };
      panel.webview.postMessage(message);
    };

    const disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) post();
      }),
      watchInputs(post, vscode.Uri.joinPath(document.uri, '..')),
      panel.webview.onDidReceiveMessage((msg: FromWebview) => this.handle(document, msg, post)),
    ];
    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }

  private async handle(document: vscode.TextDocument, msg: FromWebview, post: () => void) {
    switch (msg.type) {
      case 'ready':
        post();
        break;
      case 'setTags': {
        const before = document.getText();
        const edit = minimalEdit(before, setTags(before, msg.changes));
        if (!edit) return;
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
        await vscode.workspace.applyEdit(workspaceEdit);
        break;
      }
      case 'applyEdit': {
        // Only if the text is still the one the fix was computed for.
        if (document.getText() !== msg.text) return post();
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(msg.edit.start), document.positionAt(msg.edit.end)), msg.edit.text);
        await vscode.workspace.applyEdit(workspaceEdit);
        break;
      }
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

/**
 * Where to show the INCAR text: the editor group that already has it open (a visible one first),
 * so jumping from the builder reuses that editor instead of opening a new split every time.
 */
export function textColumn(uri: vscode.Uri): vscode.ViewColumn {
  const same = (other: vscode.Uri) => other.toString() === uri.toString();
  const visible = vscode.window.visibleTextEditors.find((e) => same(e.document.uri) && e.viewColumn !== undefined);
  if (visible?.viewColumn) return visible.viewColumn;
  for (const group of vscode.window.tabGroups.all) {
    // Not the group where the builder itself is showing: that would hide the builder.
    const builderShown = group.activeTab?.input instanceof vscode.TabInputCustom && same(group.activeTab.input.uri);
    if (!builderShown && group.tabs.some((t) => t.input instanceof vscode.TabInputText && same(t.input.uri))) return group.viewColumn;
  }
  return vscode.ViewColumn.Beside;
}
