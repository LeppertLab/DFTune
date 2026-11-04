// Shared pieces for the positional VASP input files (KPOINTS, POSCAR): lines with token offsets,
// Fortran-style numbers, and column alignment for the formatters.

import type { Span } from './incar/parse';

export interface Token {
  text: string;
  start: number;
  end: number;
}

export interface Line<Role extends string = string> {
  /** Zero-based line number. */
  n: number;
  /** Offset of the first character and of the end of the text (before the line break). */
  start: number;
  end: number;
  text: string;
  role: Role;
  /** Number of leading tokens that are data (the rest of the line is free text VASP ignores). */
  fields: number;
  tokens: Token[];
}

/** Fortran list-directed real: also `1.0d-3`. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d+$/;
export const isNumber = (s: string) => NUMBER.test(s);
export const isInteger = (s: string) => INTEGER.test(s);
export const toNumber = (s: string) => Number(s.replace(/[dD]/, 'e'));

export function tokenize(text: string, offset: number): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(/\S+/g)) tokens.push({ text: m[0], start: offset + m.index!, end: offset + m.index! + m[0].length });
  return tokens;
}

/** The lines of `text` with offsets; the newline that ends the file does not start a line of its own. */
export function splitLines<Role extends string>(text: string, role: Role): Line<Role>[] {
  const lines: Line<Role>[] = [];
  let pos = 0;
  for (const [n, raw] of text.split('\n').entries()) {
    const body = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ n, start: pos, end: pos + body.length, text: body, role, fields: 0, tokens: tokenize(body, pos) });
    pos += raw.length + 1;
  }
  if (lines.length > 1 && lines[lines.length - 1].text === '') lines.pop();
  return lines;
}

export const lineSpan = (l: Line): Span => ({ start: l.start, end: l.end });
export const isBlank = (l: Line | undefined) => !!l && l.text.trim() === '';

/** The free text after the data fields of `l`. */
export function rest(l: Line): string {
  const t = l.tokens[l.fields];
  return t ? l.text.slice(t.start - l.start).trimEnd() : '';
}

/** `fields  rest` with single spaces between the fields: a line with no neighbours to line up with. */
export function plain(l: Line): string {
  const fields = l.tokens.slice(0, l.fields).map((t) => t.text);
  return [fields.join(' '), rest(l)].filter(Boolean).join('  ');
}

/** Integer and fraction part of a field as written, so numbers line up on the decimal point. */
function split(token: string): [string, string] {
  const dot = isNumber(token) ? token.indexOf('.') : -1;
  return dot < 0 ? [token, ''] : [token.slice(0, dot), token.slice(dot)];
}

/**
 * Lines `ls`, all with the same number of data fields, in aligned columns: numbers on the decimal
 * point, two spaces between columns, and the free text after the fields in one column.
 */
export function alignedRows(ls: Line[]): string[] {
  const n = Math.min(...ls.map((l) => l.fields));
  const parts = ls.map((l) => l.tokens.slice(0, n).map((t) => split(t.text)));
  const intW: number[] = [];
  const fracW: number[] = [];
  for (let c = 0; c < n; c++) {
    intW.push(Math.max(...parts.map((p) => p[c][0].length)));
    fracW.push(Math.max(...parts.map((p) => p[c][1].length)));
  }
  return ls.map((l, i) => {
    const cells = parts[i].map(([int, frac], c) => int.padStart(intW[c]) + frac.padEnd(fracW[c]));
    // Fields beyond the shared count (not expected, but never dropped) go with the free text.
    const extra = l.tokens.slice(n, l.fields).map((t) => t.text);
    const r = [extra.join(' '), rest(l)].filter(Boolean).join('  ');
    return (cells.join('  ') + (r ? '  ' + r : '')).trimEnd();
  });
}

/**
 * Rows of cells in columns separated by two spaces: `num` columns line up on the decimal point,
 * `left` columns (labels, file names) are left-aligned. Rows may have fewer cells; the last
 * column is not padded, so no line ends in spaces.
 */
export function alignColumns(rows: string[][], kinds: ('num' | 'left')[], gap = '  '): string[] {
  const widths = kinds.map((kind, c) => {
    const cells = rows.map((r) => r[c]).filter((x): x is string => x !== undefined);
    if (kind === 'left') return { int: Math.max(0, ...cells.map((x) => x.length)), frac: 0 };
    const parts = cells.map(split);
    return { int: Math.max(0, ...parts.map((p) => p[0].length)), frac: Math.max(0, ...parts.map((p) => p[1].length)) };
  });
  return rows.map((row) =>
    row
      .map((cell, c) => {
        const kind = kinds[Math.min(c, kinds.length - 1)];
        const w = widths[Math.min(c, kinds.length - 1)];
        if (c >= kinds.length) return cell;
        if (kind === 'left') return cell.padEnd(w.int);
        const [int, frac] = split(cell);
        return int.padStart(w.int) + frac.padEnd(w.frac);
      })
      .join(gap)
      .trimEnd(),
  );
}

/**
 * Replaces the keyword at the start of a line by its canonical spelling, when its first one or
 * more words are a known spelling (`words` maps lower-case spellings, words separated by single
 * spaces, to the canonical one). The longest match wins and the rest of the line is kept as is:
 * `line mode ! path` → `Line-mode ! path`. Anything else is kept.
 */
export function canonicalWord(text: string, words: Record<string, string>): string {
  const t = text.trim();
  const tokens = [...t.matchAll(/\S+/g)];
  for (let k = tokens.length; k >= 1; k--) {
    const word = words[tokens.slice(0, k).map((m) => m[0].toLowerCase()).join(' ')];
    if (word) return word + t.slice(tokens[k - 1].index! + tokens[k - 1][0].length);
  }
  return t;
}

/** Joins formatted lines with the file's line ending, without trailing blank lines, ending in one newline. */
export function joinLines(out: string[], original: string): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join(eol) + eol;
}
