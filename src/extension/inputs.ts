// The other VASP input files next to an INCAR. Uses workspace.fs, so it works on Remote-SSH hosts.

import * as vscode from 'vscode';
import { readKpoints, readPoscar, type KpointsInfo, type PoscarInfo } from '../core';

export interface InputFile<T> {
  uri: vscode.Uri;
  fileName: string;
  info: T;
}

/**
 * The input an INCAR belongs to: POSCAR<suffix> for INCAR<suffix> (INCAR.relax → POSCAR.relax),
 * else the plain name in the same directory.
 */
async function findSibling<T>(incar: vscode.Uri, base: string, read: (text: string) => T | undefined): Promise<InputFile<T> | undefined> {
  const dir = vscode.Uri.joinPath(incar, '..');
  const incarName = incar.path.split('/').pop() ?? '';
  const suffix = incarName.toUpperCase().startsWith('INCAR') ? incarName.slice(5) : '';
  for (const fileName of new Set([`${base}${suffix}`, base])) {
    const uri = vscode.Uri.joinPath(dir, fileName);
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      continue; // not there, try the next one
    }
    const info = read(text);
    if (info) return { uri, fileName, info };
  }
  return undefined;
}

export const findPoscar = (incar: vscode.Uri) => findSibling<PoscarInfo>(incar, 'POSCAR', readPoscar);
export const findKpoints = (incar: vscode.Uri) => findSibling<KpointsInfo>(incar, 'KPOINTS', readKpoints);

/** POSCAR and KPOINTS next to `incar`, as validation context (null = no KPOINTS file). */
export async function findInputs(incar: vscode.Uri) {
  const [poscar, kpoints] = await Promise.all([findPoscar(incar), findKpoints(incar)]);
  return { poscar, kpoints };
}

/** Watches POSCAR* and KPOINTS* in `dir` (or anywhere, without a dir). */
export function watchInputs(onChange: (uri: vscode.Uri) => void, dir?: vscode.Uri): vscode.Disposable {
  const watchers = ['POSCAR*', 'KPOINTS*'].map((glob) =>
    vscode.workspace.createFileSystemWatcher(dir ? new vscode.RelativePattern(dir, glob) : `**/${glob}`),
  );
  for (const w of watchers) {
    w.onDidChange(onChange);
    w.onDidCreate(onChange);
    w.onDidDelete(onChange);
  }
  return vscode.Disposable.from(...watchers);
}
