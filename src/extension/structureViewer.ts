import * as vscode from 'vscode';
import type { StructureFormat } from '../core';
import { builderHtml } from './builderHtml';
import { textColumn } from './incarEditor';
import { findPotcar } from './inputs';
import type { FromWebview, ToWebviewStructure } from './messages';

export const STRUCTURE_VIEW_TYPE = 'dftune.structureViewer';

/** POSCAR/CONTCAR or pw.x input, from the language or else from the text. */
export function structureFormat(document: vscode.TextDocument): StructureFormat {
  if (document.languageId === 'qe') return 'qe';
  if (document.languageId === 'poscar') return 'poscar';
  return /^\s*&/m.test(document.getText().split('\n').find((l) => l.trim()) ?? '') ? 'qe' : 'poscar';
}

/**
 * A read-only 3D view of the structure in a POSCAR, CONTCAR or pw.x input. It follows the text as
 * it is edited; clicking an atom selects its line in the text editor.
 */
export class StructureViewerProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(STRUCTURE_VIEW_TYPE, new StructureViewerProvider(context), { webviewOptions: { retainContextWhenHidden: false } });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = builderHtml(panel.webview, dist, 'Structure Viewer', '', 'viewer');

    let latest = 0;
    const post = async () => {
      const mine = ++latest;
      const format = structureFormat(document);
      // A VASP 4 POSCAR names no species: take them from the POTCAR next to it.
      let speciesHint: string[] | undefined;
      if (format === 'poscar') {
        const potcar = await findPotcar(document.uri).catch(() => undefined);
        speciesHint = potcar?.info.map((e) => e.element ?? e.symbol);
      }
      if (mine !== latest) return;
      const message: ToWebviewStructure = { type: 'update-structure', text: document.getText(), fileName: vscode.workspace.asRelativePath(document.uri), format, speciesHint };
      panel.webview.postMessage(message);
    };
    const disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) post();
      }),
      panel.webview.onDidReceiveMessage(async (msg: FromWebview) => {
        if (msg.type === 'ready') post();
        if (msg.type === 'reveal') {
          const editor = await vscode.window.showTextDocument(document, { viewColumn: textColumn(document.uri), preserveFocus: false });
          const range = new vscode.Range(document.positionAt(msg.offset), document.positionAt(msg.end ?? msg.offset));
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
      }),
    ];
    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }
}
