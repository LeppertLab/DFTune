// Finds the pseudopotential files a pw.x input names, through workspace.fs (so it also works on
// Remote-SSH hosts), and reads their UPF headers. Results are kept by file and modification time.

import * as vscode from 'vscode';
import { cardsOf, detectProgram, parseQe, parseUpf, speciesRows, type PseudoLookup, type UpfInfo } from '../core';

const cache = new Map<string, { mtime: number; info: UpfInfo | undefined }>();

/**
 * The pseudopotential directory of an input: `pseudo_dir` (relative to the folder of the input,
 * where pw.x is normally run), else $ESPRESSO_PSEUDO, else ~/espresso/pseudo like QE. Undefined
 * when it was not set and the default does not exist: then there is nothing to check against.
 */
async function pseudoDir(input: vscode.Uri, text: string): Promise<vscode.Uri | undefined> {
  const doc = parseQe(text, { cards: cardsOf('pw') });
  const entry = doc.namelists.find((n) => n.name === 'CONTROL')?.entries.filter((e) => e.name === 'pseudo_dir').pop();
  const given = entry?.items[0]?.text.replace(/^['"]|['"]$/g, '').trim();
  if (given) return given.startsWith('/') ? input.with({ path: given }) : vscode.Uri.joinPath(input, '..', given);
  const fallback = process.env.ESPRESSO_PSEUDO || (process.env.HOME ? `${process.env.HOME}/espresso/pseudo` : undefined);
  if (!fallback) return undefined;
  const uri = input.with({ path: fallback });
  try {
    await vscode.workspace.fs.stat(uri);
    return uri;
  } catch {
    return undefined;
  }
}

async function readHeader(uri: vscode.Uri): Promise<{ found: boolean; info?: UpfInfo }> {
  let mtime: number;
  try {
    mtime = (await vscode.workspace.fs.stat(uri)).mtime;
  } catch {
    return { found: false };
  }
  const key = uri.toString();
  const hit = cache.get(key);
  if (hit?.mtime === mtime) return { found: true, info: hit.info };
  let info: UpfInfo | undefined;
  try {
    info = parseUpf(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
  } catch {
    info = undefined;
  }
  cache.set(key, { mtime, info });
  return { found: true, info };
}

/** The pseudopotential files named in the ATOMIC_SPECIES card of a pw.x input; undefined when there is nothing to look in. */
export async function findPseudos(input: vscode.Uri, text: string): Promise<PseudoLookup | undefined> {
  if (detectProgram(text) !== 'pw') return undefined;
  const rows = speciesRows(parseQe(text, { cards: cardsOf('pw') }));
  if (!rows.length) return undefined;
  const dir = await pseudoDir(input, text);
  if (!dir) return undefined;
  const lookup: PseudoLookup = new Map();
  await Promise.all(
    [...new Set(rows.map((r) => r.file))].map(async (file) => {
      const { found, info } = await readHeader(vscode.Uri.joinPath(dir, file));
      lookup.set(file, { status: !found ? 'missing' : info ? 'ok' : 'unreadable', dir: dir.path, info });
    }),
  );
  return lookup;
}
