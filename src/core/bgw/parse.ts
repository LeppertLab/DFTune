// Parser for BerkeleyGW keyword inputs (epsilon.inp, sigma.inp, kernel.inp, absorption.inp, inteqp.inp),
// following how the Fortran readers treat a line (Epsilon/inread.f90 and its siblings):
//
//   - a blank line, or a line whose FIRST character is # , is skipped: an indented # is not a comment
//   - otherwise the keyword is the text up to the first space: a line that starts with a space has an
//     empty keyword, and BerkeleyGW stops ("Unexpected keyword  was found")
//   - the rest of the line is the value(s), read with list-directed input
//   - `begin name` opens a block that ends at the first line that is exactly `end` (trailing blanks are
//     fine, leading ones are not); every line in between is a row, comments and blank lines included
//   - lines longer than 256 characters are cut

import type { Span } from '../incar/parse';
import { lineSpan, splitLines, tokenize, type Line, type Token } from '../lines';
import type { Diagnostic } from '../validation/rules';

export interface BgwEntry {
  keyword: string;
  keySpan: Span;
  /** The value tokens after the keyword. */
  args: Token[];
  /** Everything after the keyword, trimmed (empty for a flag). */
  value: string;
  valueSpan: Span;
  span: Span;
  line: Line;
}

export interface BgwBlock {
  name: string;
  /** The `begin name` line and the name itself. */
  beginSpan: Span;
  nameSpan: Span;
  rows: Line[];
  /** Ended by a line that is exactly `end`. */
  closed: boolean;
  endSpan?: Span;
  span: Span;
}

export interface BgwDoc {
  text: string;
  lines: Line[];
  entries: BgwEntry[];
  blocks: BgwBlock[];
  issues: Diagnostic[];
}

/** BerkeleyGW reads each line into a character*256. */
export const MAX_LINE = 256;

export function parseBgw(text: string): BgwDoc {
  const lines = splitLines(text, 'x');
  const doc: BgwDoc = { text, lines, entries: [], blocks: [], issues: [] };
  const issue = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Diagnostic['fix']) =>
    doc.issues.push({ severity, code, message, span, ...(fix && { fix }) });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.text.length > MAX_LINE) issue('warning', 'bgw-long-line', `The line is ${line.text.length} characters long: BerkeleyGW reads only the first ${MAX_LINE}.`, { start: line.start + MAX_LINE, end: line.end });
    if (line.text.trim() === '' || line.text[0] === '#') continue;

    // A line that starts with a space (or tab) has no keyword: BerkeleyGW stops on it, also if it is a comment.
    if (line.text[0] === ' ' || line.text[0] === '\t') {
      const lead = line.text.match(/^[ \t]+/)![0].length;
      const comment = line.text.trimStart()[0] === '#';
      issue('error', 'bgw-indent', comment ? 'A comment must start with # in the first column: BerkeleyGW reads an indented line as a keyword and stops ("Unexpected keyword").' : 'A keyword must start in the first column: BerkeleyGW takes the text before the first space as the keyword, so an indented line stops it ("Unexpected keyword").', { start: line.start, end: line.start + lead }, {
        title: 'Remove the indentation',
        edit: { start: line.start, end: line.start + lead, text: '' },
      });
      continue;
    }

    const tokens = tokenize(line.text, line.start);
    const key = tokens[0];
    const args = tokens.slice(1);
    const rest = args.length ? line.text.slice(args[0].start - line.start).trim() : '';
    // BerkeleyGW cuts the keyword at the first space: a tab after it becomes part of the keyword.
    const tab = line.text.slice(key.end - line.start).match(/^\t+/);
    if (tab && key.text !== 'begin') {
      issue('error', 'bgw-tab', `${key.text} is followed by a tab: BerkeleyGW takes the text up to the first space as the keyword, so it stops with "Unexpected keyword". Separate the value with a space.`, { start: key.end, end: key.end + tab[0].length }, {
        title: 'Replace the tab with a space',
        edit: { start: key.end, end: key.end + tab[0].length, text: ' ' },
      });
    }

    if (key.text === 'begin') {
      const name = args[0];
      if (!name) {
        issue('error', 'bgw-block', '`begin` needs the name of a block, e.g. `begin qpoints`.', key);
        continue;
      }
      const block: BgwBlock = { name: name.text, beginSpan: lineSpan(line), nameSpan: name, rows: [], closed: false, span: lineSpan(line) };
      // Rows up to a line that is exactly "end"; anything else (comments, blank lines, indented "end") is a row.
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].text.trimEnd() === 'end') {
          block.closed = true;
          block.endSpan = lineSpan(lines[j]);
          break;
        }
        block.rows.push(lines[j]);
      }
      block.span = { start: line.start, end: (block.closed ? lines[j] : lines[lines.length - 1]).end };
      doc.blocks.push(block);
      i = block.closed ? j : lines.length;
      continue;
    }

    doc.entries.push({
      keyword: key.text,
      keySpan: key,
      args,
      value: rest,
      valueSpan: args.length ? { start: args[0].start, end: args[args.length - 1].end } : { start: key.end, end: key.end },
      span: lineSpan(line),
      line,
    });
  }
  return doc;
}
