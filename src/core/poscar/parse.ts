// Line-by-line parser for POSCAR and CONTCAR files (https://vasp.at/wiki/POSCAR), shared by the
// linter, the formatter and the hovers.
//
//   line 1     comment
//   line 2     scale: one number (negative = cell volume in Å³) or three (per Cartesian axis)
//   lines 3–5  lattice vectors
//   line 6     element names (VASP 5+; a VASP 4 file goes straight to the counts)
//   line 7     atoms per species
//   [line]     "Selective dynamics" (first letter S)
//   line       coordinates: first letter C or K = Cartesian, anything else = Direct (fractional)
//   N lines    x y z [+ three T/F flags with selective dynamics], free text after that
//   then       CONTCAR extras (lattice velocities, velocities, predictor-corrector): not checked

import type { Span } from '../incar/parse';
import { isBlank, isInteger, isNumber, lineSpan, splitLines, toNumber, type Line } from '../lines';
import type { Diagnostic } from '../validation/rules';
import { elementOf } from './elements';

export type PoscarRole = 'title' | 'scale' | 'lattice' | 'species' | 'counts' | 'selective' | 'mode' | 'position' | 'blank' | 'extra';
export type PLine = Line<PoscarRole>;
export type Vec3 = [number, number, number];

export interface Structure {
  /** Lattice vectors in Å, scale applied (rows a, b, c). */
  lattice: [Vec3, Vec3, Vec3];
  volume: number;
  species?: string[];
  counts: number[];
  nions: number;
  selective: boolean;
  cartesian: boolean;
  /** Fractional coordinates of every atom, in file order. */
  frac: Vec3[];
  /** Line of each atom. */
  atomLines: PLine[];
}

export interface PoscarDoc {
  lines: PLine[];
  diagnostics: Diagnostic[];
  /** Present as soon as the species and counts could be read, even if positions are missing. */
  header?: { comment: string; species?: string[]; counts: number[]; nions: number };
  /** Present when the header and all positions could be read. */
  structure?: Structure;
}

/** Atoms closer than this (Å) are reported. */
export const MIN_DISTANCE = 0.5;
/** Above this many atoms the distance check is skipped (it is quadratic). */
const MAX_ATOMS_DISTANCE_CHECK = 4000;

const LOGICAL = /^\.?[TF]/i;

export interface ParseOptions {
  /** Run the quadratic close-atoms check (default true). Off when only the cell and counts are needed. */
  distances?: boolean;
}

export function parsePoscar(text: string, options: ParseOptions = {}): PoscarDoc {
  const lines = splitLines<PoscarRole>(text, 'extra');
  const diagnostics: Diagnostic[] = [];
  const doc: PoscarDoc = { lines, diagnostics };
  const report = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => diagnostics.push({ severity, code, message, span });
  const error = (message: string, span: Span, code = 'poscar-syntax') => report('error', code, message, span);
  const endSpan = (): Span => {
    const last = lines[lines.length - 1];
    return { start: last.end, end: last.end };
  };
  const need = (i: number, what: string): PLine | undefined => {
    const l = lines[i];
    if (!l) error(`The file ends before ${what}.`, endSpan(), 'poscar-incomplete');
    return l;
  };
  /** Marks `l` as `role` with `n` leading numbers; returns them, or undefined after reporting. */
  const numbers = (l: PLine, role: PoscarRole, n: number, what: string): number[] | undefined => {
    l.role = role;
    if (l.tokens.length < n) {
      error(`${what}: expected ${n} numbers, found ${l.tokens.length}.`, lineSpan(l));
      return undefined;
    }
    for (let i = 0; i < n; i++) {
      if (!isNumber(l.tokens[i].text)) {
        error(`${what}: "${l.tokens[i].text}" is not a number, VASP cannot read it.`, l.tokens[i]);
        return undefined;
      }
    }
    l.fields = n;
    return l.tokens.slice(0, n).map((t) => toNumber(t.text));
  };

  if (text.trim() === '') {
    error('The file is empty.', { start: 0, end: 0 }, 'poscar-incomplete');
    return doc;
  }
  lines[0].role = 'title';

  // Line 2: scale.
  const scaleLine = need(1, 'the scaling factor (line 2)');
  if (!scaleLine) return doc;
  const nScale = scaleLine.tokens.length >= 3 && scaleLine.tokens.slice(0, 3).every((t) => isNumber(t.text)) ? 3 : 1;
  const scale = numbers(scaleLine, 'scale', nScale, 'Scaling factor');
  if (!scale) return doc;
  if (nScale === 3 && scale.some((s) => s <= 0)) {
    error('Three scaling factors must all be positive (a single negative number gives the cell volume).', lineSpan(scaleLine));
    return doc;
  }
  if (scale[0] === 0) {
    error('The scaling factor cannot be zero.', scaleLine.tokens[0]);
    return doc;
  }

  // Lines 3–5: lattice.
  const raw: Vec3[] = [];
  for (let i = 2; i < 5; i++) {
    const l = need(i, `lattice vector ${i - 1} (line ${i + 1})`);
    if (!l) return doc;
    const v = numbers(l, 'lattice', 3, `Lattice vector ${'abc'[i - 2]}`);
    if (!v) return doc;
    raw.push(v as Vec3);
  }
  const rawVolume = det(raw);
  if (Math.abs(rawVolume) < 1e-8) {
    error('The lattice vectors are linearly dependent: the cell has no volume.', { start: lines[2].start, end: lines[4].end }, 'poscar-lattice');
    return doc;
  }
  if (rawVolume < 0) {
    report('warning', 'poscar-left-handed', 'The lattice vectors form a left-handed set (negative triple product), which VASP refuses: swap two of them.', { start: lines[2].start, end: lines[4].end });
  }
  // Per-axis factors; a single negative scale is the cell volume. Cartesian positions are scaled the same way.
  const s = scale[0] > 0 ? scale[0] : Math.cbrt(-scale[0] / Math.abs(rawVolume));
  const factors: Vec3 = nScale === 3 ? (scale as Vec3) : [s, s, s];
  const lattice = raw.map((v) => v.map((x, k) => x * factors[k]) as Vec3);

  // Line 6: species (VASP 5) or counts (VASP 4).
  let i = 5;
  const line6 = need(i, 'the atom counts (line 6 or 7)');
  if (!line6) return doc;
  let species: string[] | undefined;
  let speciesLine: PLine | undefined;
  if (line6.tokens[0] && !isInteger(line6.tokens[0].text)) {
    speciesLine = line6;
    line6.role = 'species';
    // Names up to a trailing comment.
    const end = line6.tokens.findIndex((t) => /^[!#]/.test(t.text));
    const names = end < 0 ? line6.tokens : line6.tokens.slice(0, end);
    line6.fields = names.length;
    species = names.map((t) => t.text);
    for (const t of names) {
      if (!elementOf(t.text)) {
        report('warning', 'poscar-element', `"${t.text}" is not an element symbol. VASP takes the elements from the POTCAR, so check that the order matches.`, t);
      }
    }
    i++;
  } else if (line6.tokens[0]) {
    report('hint', 'poscar-vasp4', 'No line with element names (VASP 4 format): VASP takes the elements from the POTCAR. Adding them makes the file self-describing.', lineSpan(line6));
  }

  // Counts.
  const countLine = need(i, 'the atom counts');
  if (!countLine) return doc;
  countLine.role = 'counts';
  let nCounts = 0;
  while (nCounts < countLine.tokens.length && isInteger(countLine.tokens[nCounts].text)) nCounts++;
  if (nCounts === 0) {
    error(countLine.tokens[0] ? `Expected the number of atoms per species, found "${countLine.tokens[0].text}".` : 'Expected the number of atoms per species.', lineSpan(countLine));
    return doc;
  }
  countLine.fields = nCounts;
  const counts = countLine.tokens.slice(0, nCounts).map((t) => Number(t.text));
  for (let k = 0; k < nCounts; k++) {
    if (counts[k] < 0) {
      error('An atom count cannot be negative.', countLine.tokens[k]);
      return doc;
    }
    if (counts[k] === 0) report('warning', 'poscar-zero-count', `Species ${species?.[k] ?? k + 1} has no atoms; its POTCAR is still read.`, countLine.tokens[k]);
  }
  if (species && species.length !== nCounts) {
    error(`${species.length} element name${species.length === 1 ? '' : 's'} but ${nCounts} atom count${nCounts === 1 ? '' : 's'}.`, { start: speciesLine!.start, end: countLine.end }, 'poscar-species');
    return doc;
  }
  const nions = counts.reduce((a, b) => a + b, 0);
  if (nions === 0) {
    error('The structure has no atoms.', lineSpan(countLine));
    return doc;
  }
  doc.header = { comment: lines[0].text.trim(), species, counts, nions };
  i++;

  // Selective dynamics and coordinate mode.
  let modeLine = need(i, 'the coordinate line (Direct or Cartesian)');
  if (!modeLine) return doc;
  let selective = false;
  if (modeLine.text.trim().charAt(0).toUpperCase() === 'S') {
    selective = true;
    modeLine.role = 'selective';
    i++;
    modeLine = need(i, 'the coordinate line (Direct or Cartesian)');
    if (!modeLine) return doc;
  }
  modeLine.role = 'mode';
  const first = modeLine.text.trim().charAt(0).toUpperCase();
  const cartesian = first === 'C' || first === 'K';
  if (first === '') {
    report('warning', 'poscar-mode', 'This line should say Direct or Cartesian; VASP reads a blank line as Direct.', lineSpan(modeLine));
  } else if (isNumber(modeLine.tokens[0].text)) {
    error('Expected Direct or Cartesian here, found a number. Is a line missing above?', lineSpan(modeLine));
    return doc;
  }
  i++;

  // Positions.
  const fieldCount = selective ? 6 : 3;
  const frac: Vec3[] = [];
  const atomLines: PLine[] = [];
  const inverse = inv(lattice as [Vec3, Vec3, Vec3]);
  for (let a = 0; a < nions; a++, i++) {
    const l = lines[i];
    if (!l) {
      error(`The file ends after ${a} of ${nions} atoms.`, endSpan(), 'poscar-incomplete');
      return doc;
    }
    if (isBlank(l)) {
      l.role = 'position';
      error(`Blank line where atom ${a + 1} of ${nions} should be.`, lineSpan(l), 'poscar-incomplete');
      return doc;
    }
    const v = numbers(l, 'position', 3, `Atom ${a + 1}`);
    if (!v) return doc;
    if (selective) {
      const flags = l.tokens.slice(3, 6);
      const bad = flags.find((t) => !LOGICAL.test(t.text));
      if (flags.length < 3 || bad) {
        error(bad ? `Selective dynamics flag "${bad.text}" must be T or F.` : `Atom ${a + 1}: selective dynamics needs three T/F flags after the coordinates.`, bad ?? lineSpan(l));
        return doc;
      }
      l.fields = fieldCount;
    }
    atomLines.push(l);
    if (cartesian) {
      frac.push(mulVecMat(v.map((x, k) => x * factors[k]) as Vec3, inverse));
    } else frac.push(v as Vec3);
  }
  // CONTCAR extras after the positions are not checked.
  for (let k = i; k < lines.length; k++) if (isBlank(lines[k])) lines[k].role = 'blank';

  const structure: Structure = {
    lattice: lattice as [Vec3, Vec3, Vec3],
    volume: Math.abs(det(lattice)),
    species,
    counts,
    nions,
    selective,
    cartesian,
    frac,
    atomLines,
  };
  doc.structure = structure;

  // Coordinates that look like the other kind.
  const coords = atomLines.map((l) => l.tokens.slice(0, 3).map((t) => toNumber(t.text)));
  const maxAbs = Math.max(...coords.flat().map(Math.abs));
  const shortest = Math.min(...lattice.map(norm));
  const switchTo = (word: string) => ({ title: `Change to ${word}`, edit: { start: modeLine!.start, end: modeLine!.end, text: word } });
  if (!cartesian && maxAbs > 2.5) {
    report('warning', 'poscar-mode-mismatch', `Direct (fractional) coordinates up to ${maxAbs}: are these Cartesian coordinates in Å? Then write Cartesian here.`, lineSpan(modeLine));
    diagnostics[diagnostics.length - 1].fix = switchTo('Cartesian');
  } else if (cartesian && nions >= 4 && maxAbs < 1 && shortest > 3 && coords.flat().every((x) => x >= 0)) {
    report('info', 'poscar-mode-mismatch', 'All Cartesian coordinates are within ±1 Å in a large cell: are these fractional coordinates? Then write Direct here.', lineSpan(modeLine));
    diagnostics[diagnostics.length - 1].fix = switchTo('Direct');
  }

  if (selective && atomLines.every((l) => l.tokens.slice(3, 6).every((t) => /^\.?F/i.test(t.text)))) {
    report('info', 'poscar-all-fixed', 'Selective dynamics fixes every coordinate of every atom: nothing can move in a relaxation or MD.', lineSpan(lines[atomLines[0].n - 2]));
  }

  if (options.distances !== false) checkDistances(structure, (message, span) => report('warning', 'poscar-close-atoms', message, span));
  return doc;
}

/**
 * Pairs of atoms (and atoms and their own images) closer than MIN_DISTANCE. Exact for any cell
 * shape: a distance ≤ r bounds the fractional separation along axis k by r·|b_k|/2π, so only the
 * integer image shifts inside that bound are tried (usually one, often none).
 */
function checkDistances(s: Structure, warn: (message: string, span: Span) => void) {
  if (s.nions > MAX_ATOMS_DISTANCE_CHECK) return;
  const L = s.lattice;
  const label = speciesLabeler(s);
  const r2 = MIN_DISTANCE * MIN_DISTANCE;
  // r·|b_k|/2π, with b_k the reciprocal vectors: |b_k|/2π = |a_i × a_j| / V.
  const reach = [cross(L[1], L[2]), cross(L[2], L[0]), cross(L[0], L[1])].map((v) => (MIN_DISTANCE * norm(v)) / s.volume);
  const n = s.nions;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const fz = new Float64Array(n);
  s.frac.forEach((f, i) => {
    fx[i] = f[0] - Math.floor(f[0]);
    fy[i] = f[1] - Math.floor(f[1]);
    fz[i] = f[2] - Math.floor(f[2]);
  });
  const [[l00, l01, l02], [l10, l11, l12], [l20, l21, l22]] = L;
  const [r0, r1, r2_] = reach;
  let reported = 0;
  for (let i = 0; i < n && reported < 10; i++) {
    for (let j = i; j < n && reported < 10; j++) {
      // Integer shifts along each axis that can bring j within reach of i; most pairs have none.
      const d0 = fx[j] - fx[i];
      const lo0 = Math.ceil(-d0 - r0);
      const hi0 = Math.floor(-d0 + r0);
      if (lo0 > hi0) continue;
      const d1 = fy[j] - fy[i];
      const lo1 = Math.ceil(-d1 - r1);
      const hi1 = Math.floor(-d1 + r1);
      if (lo1 > hi1) continue;
      const d2 = fz[j] - fz[i];
      const lo2 = Math.ceil(-d2 - r2_);
      const hi2 = Math.floor(-d2 + r2_);
      if (lo2 > hi2) continue;
      let best = Infinity;
      for (let a = lo0; a <= hi0; a++) {
        for (let b = lo1; b <= hi1; b++) {
          for (let c = lo2; c <= hi2; c++) {
            if (i === j && a === 0 && b === 0 && c === 0) continue;
            const u = d0 + a;
            const v = d1 + b;
            const w = d2 + c;
            const x = u * l00 + v * l10 + w * l20;
            const y = u * l01 + v * l11 + w * l21;
            const z = u * l02 + v * l12 + w * l22;
            best = Math.min(best, x * x + y * y + z * z);
          }
        }
      }
      if (best < r2) {
        const dist = Math.sqrt(best);
        const line = s.atomLines[j];
        const message =
          i === j
            ? `Atom ${i + 1} (${label(i)}) is only ${dist.toFixed(2)} Å from its own periodic image: the cell is too small.`
            : `Atoms ${i + 1} (${label(i)}) and ${j + 1} (${label(j)}) are only ${dist.toFixed(2)} Å apart${dist < 0.01 ? ' (duplicate position?)' : ''}.`;
        warn(message, { start: line.start, end: line.end });
        reported++;
      }
    }
  }
}

const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

/** "Fe" or "species 2" for atom `i` (zero-based). */
export function speciesLabeler(s: Pick<Structure, 'species' | 'counts'>): (i: number) => string {
  const of: number[] = [];
  s.counts.forEach((n, k) => {
    for (let j = 0; j < n; j++) of.push(k);
  });
  return (i) => (s.species ? s.species[of[i]] : `species ${of[i] + 1}`);
}

export function det(m: Vec3[]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function inv(m: [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] {
  const d = det(m);
  const [[a, b, c], [e, f, g], [h, k, l]] = m;
  return [
    [(f * l - g * k) / d, (c * k - b * l) / d, (b * g - c * f) / d],
    [(g * h - e * l) / d, (a * l - c * h) / d, (c * e - a * g) / d],
    [(e * k - f * h) / d, (b * h - a * k) / d, (a * f - b * e) / d],
  ];
}

/** Row vector times matrix: fractional → Cartesian with the lattice as rows. */
export function mulVecMat(v: Vec3, m: Vec3[]): Vec3 {
  return [0, 1, 2].map((k) => v[0] * m[0][k] + v[1] * m[1][k] + v[2] * m[2][k]) as Vec3;
}

export const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** Angle between two vectors in degrees. */
export function angle(u: Vec3, v: Vec3): number {
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}
