import type * as vscode from 'vscode';
import { registerCommands } from './commands';
import { IncarEditorProvider } from './incarEditor';
import { registerInputLanguages } from './inputLanguages';
import { registerLanguageFeatures } from './language';

export function activate(context: vscode.ExtensionContext) {
  registerLanguageFeatures(context);
  registerInputLanguages(context);
  registerCommands(context);
  context.subscriptions.push(IncarEditorProvider.register(context));
}

export function deactivate() {}
