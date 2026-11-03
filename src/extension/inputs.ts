// The VASP input files that belong together in one folder. Uses workspace.fs, so it works on
// Remote-SSH hosts.

import * as vscode from 'vscode';
import { readKpoints, readPoscar, readPotcar, type KpointsInfo, type PoscarInfo, type PotcarEntry } from '../core';

export interface InputFile<T> {
  uri: vscode.Uri;
  fileName: string;
  info: T;
}

const BASES = ['INCAR', 'KPOINTS', 'POSCAR', 'CONTCAR', 'POTCAR'];

/**
 * The `base` file that belongs with `source`: for INCAR.relax (or KPOINTS.relax, POSCAR.relax…)
 * first POSCAR.relax, then plain POSCAR, in the same directory.
 */
function candidates(source: vscode.Uri, base: string): { uri: vscode.Uri; fileName: string }[] {
  const dir = vscode.Uri.joinPath(source, '..');
  const name = source.path.split('/').pop() ?? '';
  const prefix = BASES.find((b) => name.toUpperCase().startsWith(b));
  const suffix = prefix ? name.slice(prefix.length) : '';
  return [...new Set([`${base}${suffix}`, base])].map((fileName) => ({ uri: vscode.Uri.joinPath(dir, fileName), fileName }));
}

async function findSibling<T>(source: vscode.Uri, base: string, read: (text: string) => T | undefined): Promise<InputFile<T> | undefined> {
  for (const { uri, fileName } of candidates(source, base)) {
    let text: string;
    try {
      text = await readText(uri);
    } catch {
      continue; // not there, try the next one
    }
    const info = read(text);
    if (info) return { uri, fileName, info };
  }
  return undefined;
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/** POTCARs are large and rarely change: keep their headers by modification time. */
const potcarCache = new Map<string, { mtime: number; entries: PotcarEntry[] }>();

async function readPotcarCached(uri: vscode.Uri): Promise<PotcarEntry[] | undefined> {
  const key = uri.toString();
  const { mtime } = await vscode.workspace.fs.stat(uri);
  const hit = potcarCache.get(key);
  if (hit?.mtime === mtime) return hit.entries;
  const entries = readPotcar(await readText(uri));
  potcarCache.set(key, { mtime, entries });
  return entries;
}

export const findPoscar = (source: vscode.Uri) => findSibling<PoscarInfo>(source, 'POSCAR', readPoscar);
export const findKpoints = (source: vscode.Uri) => findSibling<KpointsInfo>(source, 'KPOINTS', readKpoints);

export async function findPotcar(source: vscode.Uri): Promise<InputFile<PotcarEntry[]> | undefined> {
  for (const { uri, fileName } of candidates(source, 'POTCAR')) {
    try {
      const entries = await readPotcarCached(uri);
      if (entries?.length) return { uri, fileName, info: entries };
    } catch {
      // not there
    }
  }
  return undefined;
}

/** POSCAR, KPOINTS and POTCAR next to `incar`, as validation context (null = no KPOINTS file). */
export async function findInputs(incar: vscode.Uri) {
  const [poscar, kpoints, potcar] = await Promise.all([findPoscar(incar), findKpoints(incar), findPotcar(incar)]);
  return { poscar, kpoints, potcar };
}

/** Watches POSCAR*, KPOINTS* and POTCAR* directly in `dir` (not recursively). */
export function watchInputs(onChange: (uri: vscode.Uri) => void, dir: vscode.Uri): vscode.Disposable {
  const watchers = ['POSCAR*', 'KPOINTS*', 'POTCAR*'].map((glob) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, glob)));
  for (const w of watchers) {
    w.onDidChange(onChange);
    w.onDidCreate(onChange);
    w.onDidDelete(onChange);
  }
  return vscode.Disposable.from(...watchers);
}

/**
 * Watches the input files in the folders of the open documents it tracks, and calls back with
 * the folder when one changes on disk. Only folders with an open document are watched: a
 * workspace-wide watcher can be expensive on large cluster file systems (GPFS, Lustre).
 */
export class FolderWatch implements vscode.Disposable {
  private readonly folders = new Map<string, { watcher: vscode.Disposable; docs: Set<string> }>();

  constructor(private readonly onChange: (dir: string) => void) {}

  static dirOf(uri: vscode.Uri): string {
    return vscode.Uri.joinPath(uri, '..').toString();
  }

  track(uri: vscode.Uri) {
    const dir = FolderWatch.dirOf(uri);
    let entry = this.folders.get(dir);
    if (!entry) {
      entry = { watcher: watchInputs(() => this.onChange(dir), vscode.Uri.joinPath(uri, '..')), docs: new Set() };
      this.folders.set(dir, entry);
    }
    entry.docs.add(uri.toString());
  }

  untrack(uri: vscode.Uri) {
    const dir = FolderWatch.dirOf(uri);
    const entry = this.folders.get(dir);
    if (!entry?.docs.delete(uri.toString()) || entry.docs.size) return;
    entry.watcher.dispose();
    this.folders.delete(dir);
  }

  dispose() {
    this.folders.forEach((e) => e.watcher.dispose());
    this.folders.clear();
  }
}
