// The pw.x input that a ph.x, dos.x, projwfc.x or bands.x input continues, found in the same folder.

import * as vscode from 'vscode';
import { cardsOf, detectProgram, parseQe, type QeDoc } from '../core';

/** Files by modification time, with the parsed pw.x input (undefined for files that are not pw.x inputs). */
const cache = new Map<string, { mtime: number; doc: QeDoc | undefined }>();

/** The parsed pw.x input in `uri`, or undefined if it is not one; kept by modification time. */
async function readPw(uri: vscode.Uri): Promise<QeDoc | undefined> {
  try {
    const { mtime, size } = await vscode.workspace.fs.stat(uri);
    if (size > 200_000) return undefined;
    const hit = cache.get(uri.toString());
    if (hit?.mtime === mtime) return hit.doc;
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const doc = detectProgram(text) === 'pw' ? parseQe(text, { cards: cardsOf('pw') }) : undefined;
    cache.set(uri.toString(), { mtime, doc });
    return doc;
  } catch {
    return undefined;
  }
}

/** Which pw.x calculation a program continues, best first: phonons the scf run, dos.x and projwfc.x the nscf (or scf), bands.x the bands run. */
const PREFERRED: Record<string, string[]> = { ph: ['scf'], dos: ['nscf', 'scf'], projwfc: ['nscf', 'scf'], bands: ['bands', 'nscf'] };

/**
 * The pw.x input in the folder of `input` (a ph.x, dos.x, projwfc.x or bands.x input) with the
 * same prefix, the calculation it continues when there are several; with a different prefix only
 * when it is the only pw.x input there, so the mismatch can be reported.
 */
export async function findPwInput(input: vscode.Uri, text: string): Promise<QeDoc | undefined> {
  const program = detectProgram(text);
  if (!program || !(program in PREFERRED)) return undefined;
  const dir = vscode.Uri.joinPath(input, '..');
  let names: string[];
  try {
    names = (await vscode.workspace.fs.readDirectory(dir)).map(([n]) => n).filter((n) => /\.(in|inp|pwi)$/i.test(n) && n !== input.path.split('/').pop());
  } catch {
    return undefined;
  }
  const prefixOf = (doc: QeDoc, fallback: string) => doc.namelists.flatMap((n) => n.entries).find((e) => e.name === 'prefix')?.items[0]?.text.replace(/^['"]|['"]$/g, '') ?? fallback;
  const wanted = prefixOf(parseQe(text, { cards: cardsOf(program) }), 'pwscf');
  // The candidates are read in parallel (each is cached by modification time).
  const docs = await Promise.all(names.slice(0, 40).map((name) => readPw(vscode.Uri.joinPath(dir, name))));
  const found = docs
    .filter((doc): doc is QeDoc => !!doc)
    .map((doc) => {
      const calc = doc.namelists.find((n) => n.name === 'CONTROL')?.entries.find((e) => e.name === 'calculation')?.items[0]?.text.replace(/^['"]|['"]$/g, '').toLowerCase() ?? 'scf';
      const rank = PREFERRED[program].indexOf(calc);
      return { doc, rank: rank < 0 ? 99 : rank, same: prefixOf(doc, 'pwscf') === wanted };
    });
  const best = found.filter((f) => f.same).sort((a, b) => a.rank - b.rank)[0];
  return best?.doc ?? (found.length === 1 ? found[0].doc : undefined);
}
