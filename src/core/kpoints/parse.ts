// Line-by-line parser for a KPOINTS file (https://vasp.at/wiki/KPOINTS), shared by the linter
// and the formatter.
//
// KPOINTS is positional: what a line means depends on its number and on the lines before it, and
// VASP ignores any text after the numbers it needs on a line (that is where comments go). Every line
// gets a role; the linter reports lines whose numbers VASP could not read, the formatter only
// touches whitespace on lines it understands.
//
//   line 1   free-form title
//   line 2   number of k points: 0 = mesh/automatic, N > 0 = explicit list or line mode
//   line 3   first letter: A(uto), G(amma), M(onkhorst-Pack), L(ine-mode), else C/K = Cartesian, R = reciprocal
//   then     mesh: N1 N2 N3 [+ shift]; auto: length; generating vectors: 3 vectors + shift;
//            explicit: N × `kx ky kz weight` [+ Tetrahedra]; line mode: coordinate line + pairs of points

import type { Span } from '../incar/parse';
import type { Diagnostic } from '../validation/rules';

export type LineRole =
  | 'title'
  | 'count'
  | 'mode'
  | 'coords'
  | 'mesh'
  | 'shift'
  | 'length'
  | 'vector'
  | 'point'
  | 'tetra-flag'
  | 'tetra-head'
  | 'tetra'
  | 'blank'
  | 'extra';

export interface Token {
  text: string;
  start: number;
  end: number;
}

export interface KLine {
  /** Zero-based line number. */
  n: number;
  /** Offset of the first character and of the end of the text (before the line break). */
  start: number;
  end: number;
  text: string;
  role: LineRole;
  /** Number of leading tokens that are data (the rest of the line is free text). */
  numeric: number;
  tokens: Token[];
}

export interface KpointsDoc {
  lines: KLine[];
  diagnostics: Diagnostic[];
  /** Layout found, when the header could be read. */
  layout?: 'auto' | 'mesh' | 'vectors' | 'explicit' | 'line';
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d+$/;
export const isNumber = (s: string) => NUMBER.test(s);

function tokenize(text: string, offset: number): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(/\S+/g)) tokens.push({ text: m[0], start: offset + m.index!, end: offset + m.index! + m[0].length });
  return tokens;
}

export function parseKpoints(text: string): KpointsDoc {
  const lines: KLine[] = [];
  let pos = 0;
  for (const [n, raw] of text.split('\n').entries()) {
    const body = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ n, start: pos, end: pos + body.length, text: body, role: 'extra', numeric: 0, tokens: tokenize(body, pos) });
    pos += raw.length + 1;
  }
  // The newline that ends the file does not start a line of its own.
  if (lines.length > 1 && lines[lines.length - 1].text === '') lines.pop();

  const diagnostics: Diagnostic[] = [];
  const doc: KpointsDoc = { lines, diagnostics };
  const error = (message: string, span: Span, code = 'kpoints-syntax') => diagnostics.push({ code, severity: 'error', message, span });
  const warn = (message: string, span: Span, code: string) => diagnostics.push({ code, severity: 'warning', message, span });
  const info = (message: string, span: Span, code: string) => diagnostics.push({ code, severity: 'info', message, span });
  const lineSpan = (l: KLine): Span => ({ start: l.start, end: Math.max(l.end, l.start) });
  const endSpan = (): Span => {
    const last = lines[lines.length - 1];
    return { start: last.end, end: last.end };
  };

  /** Marks `l` as a data line of `role` that must start with `n` numbers; returns them, or undefined after reporting. */
  const data = (l: KLine, role: LineRole, n: number, what: string): number[] | undefined => {
    l.role = role;
    if (l.tokens.length < n) {
      error(`${what}: expected ${n} number${n > 1 ? 's' : ''}, found ${l.tokens.length}.`, lineSpan(l));
      return undefined;
    }
    const values: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = l.tokens[i];
      if (!isNumber(t.text)) {
        error(`${what}: "${t.text}" is not a number, VASP cannot read it.`, t);
        return undefined;
      }
      values.push(Number(t.text.replace(/[dD]/, 'e')));
    }
    l.numeric = n;
    return values;
  };

  /** The line at `i`, or undefined after reporting that the file ends too early. */
  const need = (i: number, what: string): KLine | undefined => {
    const l = lines[i];
    if (!l) error(`The file ends before ${what}.`, endSpan(), 'kpoints-incomplete');
    return l;
  };

  const finish = (from: number) => {
    // Content after what VASP reads.
    for (let i = from; i < lines.length; i++) {
      if (lines[i].role === 'extra' && lines[i].text.trim() !== '') {
        info('VASP does not read anything from here on.', { start: lines[i].start, end: lines[lines.length - 1].end }, 'kpoints-ignored');
        break;
      }
    }
    for (let i = from; i < lines.length; i++) if (lines[i].role === 'extra' && lines[i].text.trim() === '') lines[i].role = 'blank';
  };

  if (lines.length === 0 || (lines.length === 1 && lines[0].text.trim() === '' && text === '')) {
    error('The file is empty.', { start: 0, end: 0 }, 'kpoints-incomplete');
    return doc;
  }
  lines[0].role = 'title';

  // Line 2: number of k points.
  const countLine = need(1, 'the number of k points (line 2)');
  if (!countLine) return doc;
  countLine.role = 'count';
  const countTok = countLine.tokens[0];
  if (!countTok || !INTEGER.test(countTok.text)) {
    error(countTok ? `Line 2 must start with the number of k points (0 for a mesh), found "${countTok.text}".` : 'Line 2 must hold the number of k points (0 for a mesh).', countTok ?? lineSpan(countLine));
    return doc;
  }
  countLine.numeric = 1;
  const count = Number(countTok.text);
  if (count < 0) {
    error('The number of k points cannot be negative.', countTok);
    return doc;
  }

  // Line 3: mode.
  const modeLine = need(2, 'the mode line (line 3)');
  if (!modeLine) return doc;
  modeLine.role = 'mode';
  const first = modeLine.text.trim().charAt(0).toUpperCase();
  if (first === '') {
    error('Line 3 is empty: it must say Gamma, Monkhorst-Pack, Auto, Line-mode, Reciprocal or Cartesian.', lineSpan(modeLine));
    return doc;
  }
  const modeSpan: Span = modeLine.tokens[0] ?? lineSpan(modeLine);

  if (first === 'L') {
    doc.layout = 'line';
    if (count === 0) error('Line mode needs the number of points per segment on line 2, found 0.', countTok);
    lineMode(3);
  } else if (count === 0) {
    if (first === 'A') {
      doc.layout = 'auto';
      const l = need(3, 'the length parameter (line 4)');
      if (!l) return doc;
      const v = data(l, 'length', 1, 'Length parameter');
      if (v && v[0] <= 0) error('The length parameter must be positive.', l.tokens[0]);
      finish(4);
    } else if (first === 'G' || first === 'M') {
      doc.layout = 'mesh';
      const l = need(3, 'the subdivisions (line 4)');
      if (!l) return doc;
      const v = data(l, 'mesh', 3, 'Subdivisions');
      if (v) {
        for (let i = 0; i < 3; i++) {
          if (!Number.isInteger(v[i]) || v[i] < 1) error(`Subdivisions must be positive integers, found "${l.tokens[i].text}".`, l.tokens[i]);
        }
        if (first === 'M' && v.some((x) => Number.isInteger(x) && x > 1 && x % 2 === 0)) {
          info('A Monkhorst–Pack mesh with an even number of subdivisions does not contain Γ and breaks hexagonal symmetry; use Gamma for those cells.', modeSpan, 'kpoints-even-mp');
        }
      }
      shift(4, false);
      finish(5);
    } else {
      // Generating vectors.
      doc.layout = 'vectors';
      info(`"${modeLine.text.trim()}" is neither Gamma, Monkhorst-Pack nor Auto, so VASP reads three generating vectors and a shift. Write Gamma or Monkhorst-Pack for a plain mesh.`, modeSpan, 'kpoints-mode');
      for (let i = 3; i < 6; i++) {
        const l = need(i, `generating vector ${i - 2} (line ${i + 1})`);
        if (!l) return doc;
        if (!data(l, 'vector', 3, `Generating vector ${i - 2}`)) return doc;
      }
      shift(6, true);
      finish(7);
    }
  } else {
    doc.layout = 'explicit';
    explicit(3);
  }
  return doc;

  /** Optional (or required) shift line after the subdivisions or generating vectors. */
  function shift(i: number, required: boolean) {
    const l = lines[i];
    if (!l || l.text.trim() === '') {
      if (required) error('The shift line (three numbers) is missing.', l ? lineSpan(l) : endSpan(), 'kpoints-incomplete');
      return;
    }
    const before = diagnostics.length;
    data(l, 'shift', 3, 'Shift');
    if (diagnostics.length > before) {
      // The shift is optional: unreadable text there is a problem, but VASP does not stop reading the mesh.
      const d = diagnostics[diagnostics.length - 1];
      if (!required) d.severity = 'warning';
      l.numeric = 0;
    }
  }

  function explicit(from: number) {
    // The mode line (3) is the coordinate system; lines 4 … 3+count hold `kx ky kz weight`.
    let total = 0;
    for (let k = 0; k < count; k++) {
      const l = lines[from + k];
      if (!l) {
        error(`The file ends after ${k} of ${count} k points.`, endSpan(), 'kpoints-incomplete');
        return;
      }
      if (l.text.trim() === '') {
        error(`Blank line inside the list of k points (point ${k + 1} of ${count}); VASP cannot read it.`, lineSpan(l));
        l.role = 'point';
        return;
      }
      const v = data(l, 'point', 4, `k point ${k + 1}`);
      if (!v) return;
      if (v[3] < 0) warn('A negative k-point weight is not meaningful.', l.tokens[3], 'kpoints-weight');
      total += v[3];
    }
    if (count > 0 && total === 0) {
      // Zero weights are used on purpose for band structures with hybrid functionals, so only a hint.
      info('All k-point weights are zero. That is only right for the zero-weight points of a hybrid band structure.', lineSpan(lines[from]), 'kpoints-weight');
    }
    let i = from + count;
    const flag = lines[i];
    if (flag && flag.text.trim().charAt(0).toUpperCase() === 'T') {
      flag.role = 'tetra-flag';
      const head = need(i + 1, 'the number of tetrahedra');
      if (!head) return;
      const h = data(head, 'tetra-head', 2, 'Tetrahedra');
      if (!h) return;
      if (!Number.isInteger(h[0]) || h[0] < 0) {
        error('The number of tetrahedra must be a non-negative integer.', head.tokens[0]);
        return;
      }
      for (let t = 0; t < h[0]; t++) {
        const l = lines[i + 2 + t];
        if (!l) {
          error(`The file ends after ${t} of ${h[0]} tetrahedra.`, endSpan(), 'kpoints-incomplete');
          return;
        }
        const v = data(l, 'tetra', 5, `Tetrahedron ${t + 1}`);
        if (!v) return;
        for (let c = 1; c < 5; c++) {
          if (!Number.isInteger(v[c]) || v[c] < 1 || v[c] > count) {
            error(`Corner ${c} of tetrahedron ${t + 1} must be a k-point number between 1 and ${count}, found "${l.tokens[c].text}".`, l.tokens[c]);
          }
        }
      }
      i += 2 + h[0];
    }
    finish(i);
  }

  function lineMode(from: number) {
    const coord = need(from, 'the coordinate line (line 4: Reciprocal or Cartesian)');
    if (!coord) return;
    coord.role = 'coords';
    if (coord.text.trim() === '') {
      error('Line 4 must say Reciprocal or Cartesian.', lineSpan(coord));
      return;
    }
    let points = 0;
    let last: KLine | undefined;
    let i = from + 1;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (l.text.trim() === '') {
        l.role = 'blank';
        continue;
      }
      if (!data(l, 'point', 3, `Point ${points + 1}`)) return;
      points++;
      last = l;
    }
    if (points === 0) error('Line mode needs at least one pair of points (start and end of a segment).', endSpan(), 'kpoints-incomplete');
    else if (points % 2 === 1) error('Line-mode points come in pairs (start and end of each segment), but there is one point too many.', lineSpan(last!), 'kpoints-pairs');
  }
}
