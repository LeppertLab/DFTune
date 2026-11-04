// The pw.x input a ph.x input continues, found in the same folder.

import * as vscode from 'vscode';
import { cardsOf, detectProgram, parseQe, type QeDoc } from '../core';

const cache = new Map<string, { mtime: number; text: string }>();

async function readCached(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const { mtime, size } = await vscode.workspace.fs.stat(uri);
    if (size > 200_000) return undefined;
    const hit = cache.get(uri.toString());
    if (hit?.mtime === mtime) return hit.text;
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    cache.set(uri.toString(), { mtime, text });
    return text;
  } catch {
    return undefined;
  }
}

/**
 * The pw.x input in the folder of `input` with the same prefix as the ph.x input (the scf run,
 * when there are several); with a different prefix only when it is the only pw.x input there, so
 * the mismatch can be reported.
 */
export async function findPwInput(input: vscode.Uri, text: string): Promise<QeDoc | undefined> {
  if (detectProgram(text) !== 'ph') return undefined;
  const dir = vscode.Uri.joinPath(input, '..');
  let names: string[];
  try {
    names = (await vscode.workspace.fs.readDirectory(dir)).map(([n]) => n).filter((n) => /\.(in|inp|pwi)$/i.test(n) && n !== input.path.split('/').pop());
  } catch {
    return undefined;
  }
  const prefixOf = (doc: QeDoc, fallback: string) => doc.namelists.flatMap((n) => n.entries).find((e) => e.name === 'prefix')?.items[0]?.text.replace(/^['"]|['"]$/g, '') ?? fallback;
  const wanted = prefixOf(parseQe(text, { cards: cardsOf('ph') }), 'pwscf');
  const found: { doc: QeDoc; scf: boolean; same: boolean }[] = [];
  for (const name of names.slice(0, 40)) {
    const content = await readCached(vscode.Uri.joinPath(dir, name));
    if (!content || detectProgram(content) !== 'pw') continue;
    const doc = parseQe(content, { cards: cardsOf('pw') });
    const calc = doc.namelists.find((n) => n.name === 'CONTROL')?.entries.find((e) => e.name === 'calculation')?.items[0]?.text.replace(/^['"]|['"]$/g, '').toLowerCase() ?? 'scf';
    found.push({ doc, scf: calc === 'scf', same: prefixOf(doc, 'pwscf') === wanted });
  }
  const best = found.filter((f) => f.same).sort((a, b) => Number(b.scf) - Number(a.scf))[0];
  return best?.doc ?? (found.length === 1 ? found[0].doc : undefined);
}
