// Parser for MolGW inputs, following how MolGW reads them (read_inputfile_namelist and setup_nuclei in
// src/m_inputparam.f90):
//
//   - the variables are read in one statement, `read(inputfile, molgw)`: a Fortran NAMELIST. The group starts
//     with `&molgw` and ends at the first `/` (or `&end`) outside a string; `name = value` items are separated
//     by blanks, commas or line ends, several may share a line, and `!` starts a comment. `#` is NOT a comment:
//     it is not part of the namelist syntax at all.
//   - strings are in single or double quotes; a quote inside is doubled
//   - the atoms follow on the lines AFTER the one that holds the `/`, `natom + nghost` of them (one more with a
//     projectile) unless xyz_file or poscar_file gives the geometry; each line is read by list-directed input:
//     `element x y z [basis [auxil_basis]]`, so blanks or commas separate the fields and `!` is not a comment.
//
// The text is parsed once; the checks that need values (natom, the allowed words, …) are in validate.ts.

import type { Span } from '../incar/parse';
import { splitLines, type Line, type Token } from '../lines';
import type { Diagnostic } from '../validation/rules';

export interface MolgwValue {
  /** The value without its quotes (a doubled quote inside is one quote). */
  text: string;
  /** As written, quotes included. */
  raw: string;
  quoted: boolean;
  start: number;
  end: number;
}

export interface MolgwEntry {
  /** The name as written (without a subscript). */
  key: string;
  /** `(1)` in `a1(1) = …`, when there is one. */
  subscript?: string;
  keySpan: Span;
  values: MolgwValue[];
  /** From the first value to the last, or empty at the `=` when there is none. */
  valueSpan: Span;
  /** From the name to the last value. */
  span: Span;
  /** Zero-based line numbers of the first and the last character. */
  firstLine: number;
  lastLine: number;
}

/** One line after the namelist: read as an atom (or not) by setup_nuclei. */
export interface AtomLine {
  line: Line;
  /** The fields as list-directed input splits them: blanks and commas separate, quotes group. */
  fields: Token[];
}

export interface MolgwDoc {
  text: string;
  lines: Line[];
  /** The `&molgw` group: where it opens and where it ends; undefined when there is no such line. */
  group?: {
    /** The `&molgw` text. */
    nameSpan: Span;
    firstLine: number;
    /** The `/` (or `&end`) that closes the group; undefined when the file ends first. */
    end?: Span;
    lastLine?: number;
  };
  entries: MolgwEntry[];
  /** `!` comments inside the group, with whether code comes before them on their line. */
  comments: { span: Span; line: number; trailing: boolean }[];
  /** The lines after the line that closes the group: where the atoms are. */
  atoms: AtomLine[];
  issues: Diagnostic[];
}

const FIELD = /'(?:[^']|'')*'|"(?:[^"]|"")*"|[^\s,]+/g;

/** The fields of a line read by list-directed input (what `read(line, *)` sees). */
export function listFields(text: string, offset: number): Token[] {
  return [...text.matchAll(FIELD)].map((m) => ({ text: m[0], start: offset + m.index!, end: offset + m.index! + m[0].length }));
}

type Tok = { kind: 'word' | 'string' | 'eq'; start: number; end: number; text: string };

export function parseMolgw(text: string): MolgwDoc {
  const lines = splitLines(text, 'x');
  const doc: MolgwDoc = { text, lines, entries: [], comments: [], atoms: [], issues: [] };
  const issue = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Diagnostic['fix']) => doc.issues.push({ severity, code, message, span, ...(fix && { fix }) });
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // The group opens at the first line that starts with &molgw; the text before it is skipped.
  const open = lines.find((l) => /^\s*&\s*molgw\b/i.test(l.text));
  if (!open) {
    issue('error', 'molgw-no-namelist', 'No `&molgw` line: MolGW reads all its variables from the namelist `&molgw … /` and stops without it.', { start: 0, end: 0 });
    return doc;
  }
  const at = open.text.search(/&/);
  const name = open.text.slice(at).match(/^&\s*molgw/i)![0];
  const nameSpan = { start: open.start + at, end: open.start + at + name.length };
  doc.group = { nameSpan, firstLine: open.n };

  // Tokens of the group.
  const toks: Tok[] = [];
  let i = nameSpan.end;
  const n = text.length;
  let closed = false;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ',') {
      i++;
    } else if (c === '!') {
      let e = text.indexOf('\n', i);
      if (e < 0) e = n;
      const end = text[e - 1] === '\r' ? e - 1 : e;
      const ln = lineAt(i);
      doc.comments.push({ span: { start: i, end }, line: ln, trailing: text.slice(lines[ln].start, i).trim() !== '' });
      i = e;
    } else if (c === '#' && text.slice(lines[lineAt(i)].start, i).trim() === '') {
      // A line that starts with # (reported below) is skipped, so that it does not turn into values of the item before it.
      let e = text.indexOf('\n', i);
      if (e < 0) e = n;
      i = e;
    } else if (c === '/' || /^&end\b/i.test(text.slice(i, i + 5))) {
      const len = c === '/' ? 1 : 4;
      doc.group.end = { start: i, end: i + len };
      doc.group.lastLine = lineAt(i);
      closed = true;
      break;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= n || text[j] === '\n' || (text[j] === '\r' && text[j + 1] === '\n')) {
          issue('error', 'molgw-quote', `The string is not closed: a Fortran string ends with the same quote that starts it (${c}), on the same line.`, { start: i, end: j });
          break;
        }
        if (text[j] === c) {
          if (text[j + 1] === c) {
            value += c;
            j += 2;
            continue;
          }
          j++;
          break;
        }
        value += text[j++];
      }
      toks.push({ kind: 'string', start: i, end: j, text: value });
      i = j;
    } else if (c === '=') {
      toks.push({ kind: 'eq', start: i, end: i + 1, text: '=' });
      i++;
    } else {
      let j = i;
      while (j < n && !/[\s,=/!'"]/.test(text[j])) {
        if (text[j] === '(') {
          const close = text.indexOf(')', j);
          const eol = text.indexOf('\n', j);
          j = close >= 0 && (eol < 0 || close < eol) ? close + 1 : j + 1;
        } else j++;
      }
      if (j === i) j = i + 1;
      toks.push({ kind: 'word', start: i, end: j, text: text.slice(i, j) });
      i = j;
    }
  }

  // `#` is no comment in a namelist.
  for (const l of lines) {
    if (l.start < nameSpan.end || (doc.group.end && l.start > doc.group.end.start)) continue;
    const t = l.text.trimStart();
    if (t.startsWith('#')) {
      const s = l.start + (l.text.length - t.length);
      issue('warning', 'molgw-hash', 'A `#` does not start a comment in a Fortran namelist (only `!` does): the compiler\'s runtime reads it as part of a name and typically stops with "Bad name" or "Cannot match namelist object name". Use `!`.', { start: s, end: l.end }, { title: 'Change # to !', edit: { start: s, end: s + 1, text: '!' } });
    }
  }

  // Items: `name = value …`; every token up to the next `name =` is a value of the one before.
  let cur: MolgwEntry | undefined;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === 'word' && toks[k + 1]?.kind === 'eq') {
      const sub = t.text.match(/^([^(]*)(\(.*\))$/);
      const eq = toks[k + 1];
      cur = {
        key: sub ? sub[1] : t.text,
        ...(sub && { subscript: sub[2] }),
        keySpan: { start: t.start, end: sub ? t.start + sub[1].length : t.end },
        values: [],
        valueSpan: { start: eq.end, end: eq.end },
        span: { start: t.start, end: eq.end },
        firstLine: lineAt(t.start),
        lastLine: lineAt(eq.end - 1),
      };
      doc.entries.push(cur);
      k++;
    } else if (t.kind === 'eq') {
      issue('error', 'molgw-syntax', 'A `=` without a variable name before it: the namelist reads `name = value`.', t);
    } else if (!cur) {
      issue('error', 'molgw-syntax', `"${text.slice(t.start, t.end)}" is not a variable name: the namelist reads \`name = value\` items, and stops here ("Cannot match namelist object name").`, t);
    } else {
      const raw = text.slice(t.start, t.end);
      cur.values.push({ text: t.kind === 'string' ? t.text : raw, raw, quoted: t.kind === 'string', start: t.start, end: t.end });
      cur.valueSpan = { start: cur.values[0].start, end: t.end };
      cur.span = { start: cur.span.start, end: t.end };
      cur.lastLine = lineAt(t.end - 1);
    }
  }

  if (!closed) {
    issue('warning', 'molgw-unterminated', 'The namelist `&molgw` is not closed by a `/` line: MolGW stops at the end of the file, or reads what follows as more variables.', nameSpan);
  } else {
    // The atoms: the lines after the one with the closing `/` (the rest of that line is not read).
    for (const l of lines.slice(doc.group.lastLine! + 1)) doc.atoms.push({ line: l, fields: listFields(l.text, l.start) });
  }
  return doc;
}
