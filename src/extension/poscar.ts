import * as vscode from 'vscode';
import { readPoscar, type PoscarInfo } from '../core';

/**
 * The structure an INCAR belongs to: POSCAR<suffix> for INCAR<suffix> (INCAR.relax → POSCAR.relax),
 * else POSCAR in the same directory. Uses workspace.fs, so it works on Remote-SSH hosts.
 */
export async function findPoscar(incar: vscode.Uri): Promise<{ uri: vscode.Uri; info: PoscarInfo } | undefined> {
  const dir = vscode.Uri.joinPath(incar, '..');
  const base = incar.path.split('/').pop() ?? '';
  const suffix = base.toUpperCase().startsWith('INCAR') ? base.slice(5) : '';
  const candidates = [...new Set([`POSCAR${suffix}`, 'POSCAR'])];
  for (const name of candidates) {
    const uri = vscode.Uri.joinPath(dir, name);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const info = readPoscar(new TextDecoder().decode(bytes));
      if (info) return { uri, info };
    } catch {
      // not there, try the next one
    }
  }
  return undefined;
}

/** Calls `onChange` when a POSCAR next to `incar` is created, changed or deleted. */
export function watchPoscar(incar: vscode.Uri, onChange: () => void): vscode.Disposable {
  const dir = vscode.Uri.joinPath(incar, '..');
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, 'POSCAR*'));
  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  watcher.onDidDelete(onChange);
  return watcher;
}
