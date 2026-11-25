// The other CASTEP input of a seed: the .param next to a .cell, the .cell next to a .param.

import * as vscode from 'vscode';
import { castepFileOf, castepSeed, parseCastep, type CastepDoc } from '../core';

/** Parsed neighbours by modification time. */
const cache = new Map<string, { mtime: number; doc: CastepDoc }>();

export async function findCastepNeighbor(uri: vscode.Uri): Promise<CastepDoc | undefined> {
  const name = uri.path.split('/').pop() ?? '';
  const file = castepFileOf(name);
  if (!file) return undefined;
  const other = vscode.Uri.joinPath(uri, '..', `${castepSeed(name)}.${file === 'cell' ? 'param' : 'cell'}`);
  try {
    const { mtime, size } = await vscode.workspace.fs.stat(other);
    if (size > 2_000_000) return undefined;
    const hit = cache.get(other.toString());
    if (hit?.mtime === mtime) return hit.doc;
    const doc = parseCastep(new TextDecoder().decode(await vscode.workspace.fs.readFile(other)));
    if (cache.size > 100) cache.clear(); // neighbours of closed folders
    cache.set(other.toString(), { mtime, doc });
    return doc;
  } catch {
    return undefined;
  }
}
