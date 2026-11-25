// The xyz file a MolGW input names (xyz_file='…'), read for its atom count: MolGW stops when natom + nghost
// disagrees with it. Looked up relative to the input file's folder, like MolGW opens it from the run folder.

import * as vscode from 'vscode';
import { parseMolgw } from '../core';

export async function findXyzAtoms(uri: vscode.Uri, text: string): Promise<number | undefined> {
  const name = parseMolgw(text).entries.filter((e) => !e.subscript && e.key.toLowerCase() === 'xyz_file').pop()?.values[0]?.text.trim();
  if (!name) return undefined;
  try {
    const file = name.startsWith('/') ? uri.with({ path: name }) : vscode.Uri.joinPath(uri, '..', name);
    const { size } = await vscode.workspace.fs.stat(file);
    if (size > 50_000_000) return undefined;
    const bytes = await vscode.workspace.fs.readFile(file);
    const first = new TextDecoder().decode(bytes.subarray(0, 200)).split('\n')[0].trim();
    return /^\d+$/.test(first) ? Number(first) : undefined;
  } catch {
    return undefined;
  }
}
