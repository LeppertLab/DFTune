// The BerkeleyGW inputs that belong to the same workflow as an open one (epsilon ↔ sigma,
// kernel ↔ absorption), found in the same folder.

import * as vscode from 'vscode';
import { detectBgwProgram, pairBgwFiles, parseBgw, type BgwNeighbor } from '../core';

/** Parsed neighbours by modification time. */
const cache = new Map<string, { mtime: number; neighbor: BgwNeighbor }>();

export async function findBgwNeighbors(uri: vscode.Uri): Promise<BgwNeighbor[]> {
  const dir = vscode.Uri.joinPath(uri, '..');
  const self = uri.path.split('/').pop() ?? '';
  let names: string[];
  try {
    names = (await vscode.workspace.fs.readDirectory(dir)).map(([n]) => n).filter((n) => /\.inp$/i.test(n) && detectBgwProgram(n));
  } catch {
    return [];
  }
  const pairs = pairBgwFiles(self, names.slice(0, 500));
  const found = await Promise.all(
    Object.entries(pairs).map(async ([program, name]): Promise<BgwNeighbor | undefined> => {
      const file = vscode.Uri.joinPath(dir, name!);
      try {
        const { mtime, size } = await vscode.workspace.fs.stat(file);
        if (size > 500_000) return undefined;
        const hit = cache.get(file.toString());
        if (hit?.mtime === mtime) return hit.neighbor;
        const doc = parseBgw(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
        const neighbor: BgwNeighbor = { program: program as BgwNeighbor['program'], fileName: name!, doc };
        if (cache.size > 100) cache.clear(); // neighbours of closed folders
        cache.set(file.toString(), { mtime, neighbor });
        return neighbor;
      } catch {
        return undefined;
      }
    }),
  );
  return found.filter((n): n is BgwNeighbor => !!n);
}
