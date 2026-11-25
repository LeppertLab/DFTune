// Formats a CASTEP cell or param file. Deliberately conservative: CASTEP is free-format, but people
// script against their files and the block rows hold numbers, so only
//   - the keyword lines outside blocks get one separator (`keyword : value`), the values of consecutive
//     keyword lines aligned in a column; a comment behind a value keeps its distance from it
//   - trailing whitespace is removed and runs of blank lines collapse to one
//   - the file ends with one newline, and line endings are kept
// Comments, `%BLOCK`/`%ENDBLOCK` lines, block rows (units, numbers, spins included), the case of keywords and
// the order of everything stay as written.
//
// Idempotent. Returns undefined while the file has errors that make the layout ambiguous (a block that is not closed).

import { joinLines } from '../lines';
import { parseCastep, type CastepEntry } from './parse';

export function formatCastep(text: string): string | undefined {
  const doc = parseCastep(text);
  if (doc.issues.some((i) => i.severity === 'error')) return undefined;
  const { lines } = doc;
  const entryAt = new Map(doc.entries.map((e) => [e.line.n, e]));

  const out: string[] = [];
  const withComment = (e: CastepEntry, code: string) => {
    if (e.commentAt < 0) return code;
    const lineText = e.line.text;
    const c = e.commentAt - e.line.start;
    const gap = lineText.slice(0, c).length - lineText.slice(0, c).trimEnd().length || 1;
    return `${code}${' '.repeat(gap)}${lineText.slice(c).trimEnd()}`;
  };
  for (let i = 0; i < lines.length; i++) {
    const e = entryAt.get(i);
    if (!e) {
      out.push(lines[i].text.trimEnd());
      continue;
    }
    const run = [e];
    while (entryAt.get(i + run.length)) run.push(entryAt.get(i + run.length)!);
    const width = Math.max(...run.filter((r) => r.value).map((r) => r.keyword.length), 0);
    for (const r of run) out.push(withComment(r, r.value ? `${r.keyword.padEnd(width)} : ${r.value}` : r.keyword));
    i += run.length - 1;
  }
  // A blank line is the only thing that collapses; whole-line comments and block rows are kept as they are.
  const collapsed = out.filter((l, k) => !(l === '' && out[k - 1] === ''));
  return joinLines(collapsed, text);
}
