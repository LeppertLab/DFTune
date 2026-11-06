// Formats a BerkeleyGW input. Deliberately conservative, since BerkeleyGW is picky about layout and users
// sometimes script against it (sed on block rows): only
//   - trailing whitespace is removed and runs of blank lines collapse to one
//   - the values of consecutive `keyword value` lines are aligned in a column
//   - the file ends with one newline, and line endings are kept
// Comments, block rows, `begin` and `end` lines, the order of everything and every value stay as written.
//
// Idempotent. Returns undefined while the file has errors that make the layout ambiguous (an indented keyword).

import { joinLines } from '../lines';
import { parseBgw } from './parse';

export function formatBgw(text: string): string | undefined {
  const doc = parseBgw(text);
  if (doc.issues.some((i) => i.severity === 'error')) return undefined;
  const { lines } = doc;
  const entryAt = new Map(doc.entries.map((e) => [e.line.n, e]));

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const e = entryAt.get(i);
    if (!e || !e.args.length) {
      out.push(lines[i].text.trimEnd());
      continue;
    }
    // A run of keyword lines with values: align the values.
    const run = [e];
    while (entryAt.get(i + run.length)?.args.length) run.push(entryAt.get(i + run.length)!);
    const width = Math.max(...run.map((r) => r.keyword.length)) + 1;
    for (const r of run) out.push(`${r.keyword.padEnd(width)}${r.value}`.trimEnd());
    i += run.length - 1;
  }
  const blanksCollapsed = out.filter((l, k) => !(l === '' && out[k - 1] === ''));
  return joinLines(blanksCollapsed, text);
}
