// Parser for CASTEP cell and param files, following how CASTEP reads them (cell_file.md and
// param_file.md of the CASTEP documentation):
//
//   - free format, keywords case-insensitive, in any order
//   - `keyword : value`, `keyword = value` or `keyword value`
//   - `%BLOCK name` … `%ENDBLOCK name`, the block name case-insensitive
//   - comments start at `#`, `!` or `;` and run to the end of the line, also behind values and block rows
//   - the first line of some blocks is a unit (`bohr`, `ang`), the rest rows of numbers
//
// Every piece carries its span in the text, for diagnostics.

import type { Span } from '../incar/parse';
import { splitLines, tokenize, type Line, type Token } from '../lines';
import type { Diagnostic } from '../validation/rules';

export interface CastepEntry {
  keyword: string;
  keySpan: Span;
  /** The character between keyword and value: `:`, `=` or a space. */
  sep: ':' | '=' | ' ';
  /** The separator as written, including the blanks around it. */
  sepSpan: Span;
  /** The value tokens (comment excluded). */
  args: Token[];
  /** The value text, trimmed (empty for a flag). */
  value: string;
  valueSpan: Span;
  /** The line without its line break. */
  span: Span;
  /** Where the comment starts, or -1. */
  commentAt: number;
  line: Line;
}

export interface CastepRow {
  /** Zero-based line number. */
  n: number;
  start: number;
  end: number;
  /** The row without its comment. */
  text: string;
  tokens: Token[];
}

export interface CastepBlock {
  name: string;
  beginSpan: Span;
  nameSpan: Span;
  rows: CastepRow[];
  closed: boolean;
  /** The `%ENDBLOCK` line, and the text written after it. */
  endSpan?: Span;
  endName?: string;
  span: Span;
}

export interface CastepDoc {
  text: string;
  lines: Line[];
  entries: CastepEntry[];
  blocks: CastepBlock[];
  issues: Diagnostic[];
}

/** Where the comment of a line starts (`#`, `!` or `;`), or -1. */
export function commentStart(text: string): number {
  const m = text.match(/[#!;]/);
  return m ? m.index! : -1;
}

export function parseCastep(text: string): CastepDoc {
  const lines = splitLines(text, 'x');
  const doc: CastepDoc = { text, lines, entries: [], blocks: [], issues: [] };
  const issue = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => doc.issues.push({ severity, code, message, span });

  let open: CastepBlock | undefined;
  for (const line of lines) {
    const c = commentStart(line.text);
    const code = c < 0 ? line.text : line.text.slice(0, c);
    const tokens = tokenize(code, line.start);
    if (tokens.length === 0) continue;

    const glued = tokens[0].text.match(/^%(block|endblock)(.*)$/i);
    if (glued) {
      const word = glued[1].toLowerCase();
      const rest = tokens.slice(1);
      if (glued[2]) rest.unshift({ text: glued[2], start: tokens[0].start + 1 + glued[1].length, end: tokens[0].end });
      if (word === 'block') {
        if (open) {
          issue('error', 'castep-unterminated', `%BLOCK ${open.name} is not closed by %ENDBLOCK before the next %BLOCK starts.`, open.nameSpan);
        }
        const name = rest[0];
        if (!name) {
          issue('error', 'castep-block', '%BLOCK needs the name of a block, e.g. %BLOCK LATTICE_CART.', tokens[0]);
          open = undefined;
          continue;
        }
        open = { name: name.text, beginSpan: { start: line.start, end: line.end }, nameSpan: name, rows: [], closed: false, span: { start: line.start, end: line.end } };
        doc.blocks.push(open);
        continue;
      }
      if (!open) {
        issue('warning', 'castep-endblock', '%ENDBLOCK without a %BLOCK before it.', tokens[0]);
        continue;
      }
      open.closed = true;
      open.endSpan = { start: line.start, end: line.end };
      open.endName = rest.map((t) => t.text).join(' ');
      open.span = { start: open.span.start, end: line.end };
      open = undefined;
      continue;
    }

    if (open) {
      open.rows.push({ n: line.n, start: line.start, end: line.start + code.length, text: code, tokens });
      open.span = { start: open.span.start, end: line.end };
      continue;
    }

    // A keyword line: `key : value`, `key = value`, `key value`.
    const key = tokens[0];
    const m = code.slice(key.start - line.start).match(/^([^\s:=]+)(\s*[:=]\s*|\s+|$)/);
    if (!m) continue;
    const keyword = m[1];
    const keySpan = { start: key.start, end: key.start + keyword.length };
    const sepSpan = { start: keySpan.end, end: keySpan.end + m[2].length };
    const valueText = code.slice(sepSpan.end - line.start).trimEnd();
    doc.entries.push({
      keyword,
      keySpan,
      sep: m[2].includes(':') ? ':' : m[2].includes('=') ? '=' : ' ',
      sepSpan,
      args: tokenize(valueText, sepSpan.end),
      value: valueText,
      valueSpan: { start: sepSpan.end, end: sepSpan.end + valueText.length },
      span: { start: line.start, end: line.end },
      commentAt: c < 0 ? -1 : line.start + c,
      line,
    });
  }
  if (open) {
    issue('error', 'castep-unterminated', `%BLOCK ${open.name} is not closed: CASTEP needs a matching %ENDBLOCK ${open.name}.`, open.nameSpan);
  }
  return doc;
}
