// Formats a MolGW input. Deliberately conservative: only
//   - the namelist gets one `name = value` per line, with the `=` in one column and comments kept
//     (full-line comments as written, trailing ones two spaces after the value)
//   - the atom lines right after it are lined up in columns (element, coordinates on the decimal point, basis names)
//   - trailing whitespace is removed, runs of blank lines before the atoms collapse to one, the file ends with
//     one newline, and its line endings are kept
// Names keep their case and every value stays exactly as written: numbers and strings are never touched.
//
// Idempotent. Returns undefined while the file has problems that make the layout ambiguous (no `&molgw`, a
// string that is not closed, a missing `/`).

import { alignColumns, joinLines } from '../lines';
import { isFortranReal } from './reader';
import { parseMolgw } from './parse';

export function formatMolgw(text: string): string | undefined {
  const doc = parseMolgw(text);
  if (!doc.group || doc.group.lastLine === undefined) return undefined;
  if (doc.issues.some((i) => i.severity === 'error')) return undefined;
  const { lines, group } = doc;
  const out: string[] = [];

  // Text before the group stays.
  for (const l of lines.slice(0, group.firstLine)) out.push(l.text.trimEnd());

  // The group. An item that spans lines is not something to rewrite: the group is then kept as it is.
  const multiline = doc.entries.some((e) => e.firstLine !== e.lastLine);
  if (multiline) {
    for (const l of lines.slice(group.firstLine, group.lastLine! + 1)) out.push(l.text.trimEnd());
  } else {
    const keyOf = (e: (typeof doc.entries)[number]) => e.key + (e.subscript ?? '');
    const width = Math.max(0, ...doc.entries.map((e) => keyOf(e).length));
    for (let n = group.firstLine; n <= group.lastLine!; n++) {
      const line = lines[n];
      const entries = doc.entries.filter((e) => e.firstLine === n);
      const comment = doc.comments.find((c) => c.line === n);
      const commentText = comment ? text.slice(comment.span.start, comment.span.end).trimEnd() : '';
      const isFirst = n === group.firstLine;
      const isLast = n === group.lastLine;

      const written: string[] = [];
      if (isFirst) written.push(text.slice(group.nameSpan.start, group.nameSpan.end));
      for (const e of entries) {
        const value = e.values.length ? text.slice(e.valueSpan.start, e.valueSpan.end) : '';
        written.push(`  ${keyOf(e).padEnd(width)} =${value ? ` ${value}` : ''}`);
      }
      if (commentText) {
        if (written.length) written[written.length - 1] += `${entries.length || isFirst ? '  ' : ''}${commentText}`;
        else written.push(line.text.trimEnd()); // a comment line: as written
      }
      if (isLast) {
        const end = group.end!;
        // What follows the terminator on its line is not read by MolGW; kept as written.
        const tail = text.slice(end.end, line.end).trimEnd();
        written.push(text.slice(end.start, end.end) + (tail ? `  ${tail.trimStart()}` : ''));
      }
      if (!written.length) {
        // Blank, or a line the parser skipped (# …): as written.
        const t = line.text.trimEnd();
        if (t === '' && out[out.length - 1] === '') continue;
        written.push(t);
      }
      out.push(...written);
    }
  }

  // The atoms: the run of atom lines right after the group, lined up.
  const atoms = doc.atoms;
  let k = 0;
  const run: { fields: string[] }[] = [];
  while (k < atoms.length) {
    const a = atoms[k];
    const f = a.fields;
    if (f.length < 4 || f[0].text.startsWith('!') || !f.slice(1, 4).every((x) => isFortranReal(x.text)) || a.line.text.includes(',') || a.line.text.includes('!')) break;
    run.push({ fields: f.map((x) => x.text) });
    k++;
  }
  if (run.length) out.push(...alignColumns(run.map((r) => r.fields), ['left', 'num', 'num', 'num', 'left', 'left']));
  for (const a of atoms.slice(k)) out.push(a.line.text.trimEnd());

  return joinLines(out, text);
}
