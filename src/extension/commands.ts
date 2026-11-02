import * as vscode from 'vscode';
import { INTENTS, newIncar } from '../core';
import { VIEW_TYPE } from './incarEditor';
import { findPoscar } from './inputs';

export function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('projectElectrons.openBuilder', openBuilder),
    vscode.commands.registerCommand('projectElectrons.newCalculation', newCalculation),
  );
}

async function openBuilder(uri?: vscode.Uri) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showInformationMessage('Open an INCAR file first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, vscode.ViewColumn.Beside);
}

/** Asks for the main intents and writes a commented INCAR into the chosen folder. */
async function newCalculation(folder?: vscode.Uri) {
  folder ??= await pickFolder();
  if (!folder) return;

  const choices: Record<string, string> = {};
  for (const kind of INTENTS) {
    const pick = await vscode.window.showQuickPick(
      kind.choices.map((c) => ({ label: c.label, description: c.description, id: c.id })),
      { title: `New VASP calculation: ${kind.label}`, placeHolder: kind.label, ignoreFocusOut: true },
    );
    if (!pick) return;
    choices[kind.id] = pick.id;
  }

  const incar = vscode.Uri.joinPath(folder, 'INCAR');
  if (await exists(incar)) {
    const answer = await vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(incar)} already exists. Replace it?`, { modal: true }, 'Replace');
    if (answer !== 'Replace') return;
  }
  const poscar = await findPoscar(incar);
  const system = poscar?.info.comment || folder.path.split('/').pop() || 'calculation';
  await vscode.workspace.fs.writeFile(incar, new TextEncoder().encode(newIncar(system, choices)));

  await vscode.window.showTextDocument(incar, { viewColumn: vscode.ViewColumn.One });
  await vscode.commands.executeCommand('vscode.openWith', incar, VIEW_TYPE, vscode.ViewColumn.Beside);
}

async function pickFolder(): Promise<vscode.Uri | undefined> {
  const active = vscode.window.activeTextEditor?.document.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    defaultUri: active ? vscode.Uri.joinPath(active, '..') : vscode.workspace.workspaceFolders?.[0]?.uri,
    openLabel: 'Create INCAR here',
  });
  return picked?.[0];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
