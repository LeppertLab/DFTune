import type * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerConvertCommands } from './convert';
import { IncarEditorProvider } from './incarEditor';
import { registerInputLanguages } from './inputLanguages';
import { BgwEditorProvider } from './bgwEditor';
import { QeEditorProvider } from './qeEditor';
import { StructureViewerProvider } from './structureViewer';
import { registerLanguageFeatures } from './language';

export function activate(context: vscode.ExtensionContext) {
  registerLanguageFeatures(context);
  registerInputLanguages(context);
  registerCommands(context);
  registerConvertCommands(context);
  context.subscriptions.push(IncarEditorProvider.register(context), QeEditorProvider.register(context), BgwEditorProvider.register(context), StructureViewerProvider.register(context));
}

export function deactivate() {}
