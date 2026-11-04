// The crystal structure of a pw.x input: the lattice vectors from `ibrav` + `celldm` (a port of
// QE's latgen routine) or from CELL_PARAMETERS, and the atom positions.

import type { Span } from '../incar/parse';
import { det, mulVecMat, norm, angle, type Vec3 } from '../poscar/parse';
import type { QeDoc } from './parse';
import { Reader } from './reader';
import { isReal, toReal } from './values';

/** Bohr radius in Å (QE's constant). */
export const BOHR = 0.529177210903;

type Cell3 = [Vec3, Vec3, Vec3];

/** Which `ibrav` values exist. */
export const IBRAV_VALUES = [0, 1, 2, 3, -3, 4, 5, -5, 6, 7, 8, 9, -9, 91, 10, 11, 12, -12, 13, -13, 14];

/**
 * Lattice vectors in bohr for a Bravais-lattice index and `celldm(1..6)` (index 0..5), exactly as
 * QE's latgen builds them; a string with the reason when the parameters make no lattice.
 */
export function latgen(ibrav: number, celldm: number[]): Cell3 | string {
  const [a, b, c, c4, c5, c6] = [celldm[0] ?? 0, celldm[1] ?? 0, celldm[2] ?? 0, celldm[3] ?? 0, celldm[4] ?? 0, celldm[5] ?? 0];
  if (!(a > 0)) return 'celldm(1) must be positive';
  const need = (ok: boolean, msg: string) => (ok ? undefined : msg);
  const t = a / 2;
  const sr3 = Math.sqrt(3);
  let err: string | undefined;
  switch (ibrav) {
    case 1:
      return [[a, 0, 0], [0, a, 0], [0, 0, a]];
    case 2:
      return [[-t, 0, t], [0, t, t], [-t, t, 0]];
    case 3:
      return [[t, t, t], [-t, t, t], [-t, -t, t]];
    case -3:
      return [[-t, t, t], [t, -t, t], [t, t, -t]];
    case 4:
      if ((err = need(c > 0, 'celldm(3) must be positive'))) return err;
      return [[a, 0, 0], [-a / 2, (a * sr3) / 2, 0], [0, 0, a * c]];
    case 5:
    case -5: {
      if ((err = need(c4 > -0.5 && c4 < 1, 'celldm(4) must be between -0.5 and 1'))) return err;
      const t1 = Math.sqrt(1 + 2 * c4);
      const t2 = Math.sqrt(1 - c4);
      if (ibrav === 5) {
        const a2y = (Math.SQRT2 * a * t2) / sr3;
        const a2z = (a * t1) / sr3;
        const a1x = (a * t2) / Math.SQRT2;
        const a1y = -a1x / sr3;
        return [[a1x, a1y, a2z], [0, a2y, a2z], [-a1x, a1y, a2z]];
      }
      const x = (a * (t1 - 2 * t2)) / 3;
      const y = (a * (t1 + t2)) / 3;
      return [[x, y, y], [y, x, y], [y, y, x]];
    }
    case 6:
      if ((err = need(c > 0, 'celldm(3) must be positive'))) return err;
      return [[a, 0, 0], [0, a, 0], [0, 0, a * c]];
    case 7:
      if ((err = need(c > 0, 'celldm(3) must be positive'))) return err;
      return [[t, -t, (c * a) / 2], [t, t, (c * a) / 2], [-t, -t, (c * a) / 2]];
    case 8:
      if ((err = need(b > 0 && c > 0, 'celldm(2) and celldm(3) must be positive'))) return err;
      return [[a, 0, 0], [0, a * b, 0], [0, 0, a * c]];
    case 9:
    case -9:
      if ((err = need(b > 0 && c > 0, 'celldm(2) and celldm(3) must be positive'))) return err;
      return ibrav === 9 ? [[t, (a * b) / 2, 0], [-t, (a * b) / 2, 0], [0, 0, a * c]] : [[t, (-a * b) / 2, 0], [t, (a * b) / 2, 0], [0, 0, a * c]];
    case 91:
      if ((err = need(b > 0 && c > 0, 'celldm(2) and celldm(3) must be positive'))) return err;
      return [[a, 0, 0], [0, (a * b) / 2, (-a * c) / 2], [0, (a * b) / 2, (a * c) / 2]];
    case 10:
      if ((err = need(b > 0 && c > 0, 'celldm(2) and celldm(3) must be positive'))) return err;
      return [[t, 0, (a * c) / 2], [t, (a * b) / 2, 0], [0, (a * b) / 2, (a * c) / 2]];
    case 11:
      if ((err = need(b > 0 && c > 0, 'celldm(2) and celldm(3) must be positive'))) return err;
      return [[t, (a * b) / 2, (a * c) / 2], [-t, (a * b) / 2, (a * c) / 2], [-t, (-a * b) / 2, (a * c) / 2]];
    case 12: {
      if ((err = need(b > 0 && c > 0 && Math.abs(c4) < 1, 'celldm(2), celldm(3) must be positive and |celldm(4)| < 1'))) return err;
      const sen = Math.sqrt(1 - c4 * c4);
      return [[a, 0, 0], [a * b * c4, a * b * sen, 0], [0, 0, a * c]];
    }
    case -12: {
      if ((err = need(b > 0 && c > 0 && Math.abs(c5) < 1, 'celldm(2), celldm(3) must be positive and |celldm(5)| < 1'))) return err;
      const sen = Math.sqrt(1 - c5 * c5);
      return [[a, 0, 0], [0, a * b, 0], [a * c * c5, 0, a * c * sen]];
    }
    case 13: {
      if ((err = need(b > 0 && c > 0 && Math.abs(c4) < 1, 'celldm(2), celldm(3) must be positive and |celldm(4)| < 1'))) return err;
      const sen = Math.sqrt(1 - c4 * c4);
      return [[t, 0, (-a * c) / 2], [a * b * c4, a * b * sen, 0], [t, 0, (a * c) / 2]];
    }
    case -13: {
      if ((err = need(b > 0 && c > 0 && Math.abs(c5) < 1, 'celldm(2), celldm(3) must be positive and |celldm(5)| < 1'))) return err;
      const sen = Math.sqrt(1 - c5 * c5);
      return [[t, (a * b) / 2, 0], [-t, (a * b) / 2, 0], [a * c * c5, 0, a * c * sen]];
    }
    case 14: {
      if ((err = need(b > 0 && c > 0 && Math.abs(c4) < 1 && Math.abs(c5) < 1 && Math.abs(c6) < 1, 'celldm(2), celldm(3) must be positive and |celldm(4..6)| < 1'))) return err;
      const singam = Math.sqrt(1 - c6 * c6);
      let term = 1 + 2 * c4 * c5 * c6 - c4 * c4 - c5 * c5 - c6 * c6;
      if (term < 0) return 'celldm(4..6) do not make sense: the angles cannot form a cell';
      term = Math.sqrt(term / (1 - c6 * c6));
      return [[a, 0, 0], [a * b * c6, a * b * singam, 0], [a * c * c5, (a * c * (c4 - c5 * c6)) / singam, a * c * term]];
    }
  }
  return `ibrav = ${ibrav} is not a Bravais-lattice index`;
}

/** `celldm` from A, B, C (Å) and the cosines, as QE's abc2celldm does. */
export function abc2celldm(ibrav: number, a: number, b: number, c: number, cosab: number, cosac: number, cosbc: number): number[] {
  const celldm = [a / BOHR, b / a, c / a, 0, 0, 0];
  if (ibrav === 14 || ibrav === 0) [celldm[3], celldm[4], celldm[5]] = [cosbc, cosac, cosab];
  else if (ibrav === -12 || ibrav === -13) celldm[4] = cosac;
  else if ([-5, 5, 12, 13].includes(ibrav)) celldm[3] = cosab;
  return celldm;
}

export interface QeStructure {
  /** Lattice vectors in Å, as rows. */
  lattice: Cell3;
  /** Cell volume in Å³. */
  volume: number;
  /** Lattice parameter alat in bohr. */
  alat: number;
  /** Fractional coordinates, species label and source span of each atom. */
  frac: Vec3[];
  labels: string[];
  spans: Span[];
}

/** The cell alone (no atoms needed), or the reason it cannot be built. */
export function qeCell(doc: QeDoc): { lattice: Cell3; volume: number; alat: number } | { error: string } | undefined {
  const r = new Reader(doc);
  const ibrav = r.num('SYSTEM', 'ibrav');
  if (ibrav === undefined || !IBRAV_VALUES.includes(ibrav)) return undefined;
  const celldm = [1, 2, 3, 4, 5, 6].map((i) => r.num('SYSTEM', 'celldm', String(i)) ?? 0);
  const abc = ['a', 'b', 'c', 'cosab', 'cosac', 'cosbc'].map((n) => r.num('SYSTEM', n));
  const useAbc = abc[0] !== undefined && celldm[0] === 0;
  const dm = useAbc ? abc2celldm(ibrav, abc[0]!, abc[1] ?? 0, abc[2] ?? 0, abc[3] ?? 0, abc[4] ?? 0, abc[5] ?? 0) : celldm;

  let bohr: Cell3;
  let alat: number;
  if (ibrav === 0) {
    const card = r.card('CELL_PARAMETERS');
    const rows = (card?.lines ?? []).filter((l) => l.text.trim());
    if (rows.length < 3 || !rows.slice(0, 3).every((l) => l.tokens.length >= 3 && l.tokens.slice(0, 3).every((t) => isReal(t.text)))) return undefined;
    const v = rows.slice(0, 3).map((l) => l.tokens.slice(0, 3).map((t) => toReal(t.text)) as Vec3) as Cell3;
    const unit = card!.option ?? 'none';
    const lat = dm[0] > 0 ? dm[0] : undefined;
    if (unit === 'angstrom') bohr = v.map((x) => x.map((y) => y / BOHR) as Vec3) as Cell3;
    else if (unit === 'bohr') bohr = v;
    else if (lat !== undefined) bohr = v.map((x) => x.map((y) => y * lat) as Vec3) as Cell3;
    else if (unit === 'alat') return undefined;
    else bohr = v;
    alat = lat ?? norm(bohr[0]);
  } else {
    const g = latgen(ibrav, dm);
    if (typeof g === 'string') return { error: g };
    bohr = g;
    alat = dm[0];
  }
  const lattice = bohr.map((x) => x.map((y) => y * BOHR) as Vec3) as Cell3;
  const volume = Math.abs(det(lattice));
  if (!(volume > 1e-8)) return { error: 'the lattice vectors are linearly dependent: the cell has no volume' };
  return { lattice, volume, alat };
}

/** The cell and atoms of a pw.x input; undefined when either cannot be read (the checks report why). */
export function qeStructure(doc: QeDoc): QeStructure | undefined {
  const cell = qeCell(doc);
  if (!cell || 'error' in cell) return undefined;
  const card = doc.cards.find((c) => c.name === 'ATOMIC_POSITIONS');
  if (!card) return undefined;
  const unit = card.option ?? 'alat';
  if (!['alat', 'bohr', 'angstrom', 'crystal'].includes(unit)) return undefined;
  const { lattice, alat } = cell;
  const inverse = invert(lattice);
  const frac: Vec3[] = [];
  const labels: string[] = [];
  const spans: Span[] = [];
  for (const l of card.lines.filter((x) => x.text.trim())) {
    if (l.tokens.length < 4 || !l.tokens.slice(1, 4).every((t) => isReal(t.text))) return undefined;
    const v = l.tokens.slice(1, 4).map((t) => toReal(t.text)) as Vec3;
    if (unit === 'crystal') frac.push(v);
    else {
      const scale = unit === 'alat' ? alat * BOHR : unit === 'bohr' ? BOHR : 1;
      frac.push(mulVecMat(v.map((x) => x * scale) as Vec3, inverse));
    }
    labels.push(l.tokens[0].text);
    spans.push({ start: l.start, end: l.end });
  }
  return { lattice, volume: cell.volume, alat, frac, labels, spans };
}

function invert(m: Cell3): Cell3 {
  const d = det(m);
  const [[a, b, c], [e, f, g], [h, k, l]] = m;
  return [
    [(f * l - g * k) / d, (c * k - b * l) / d, (b * g - c * f) / d],
    [(g * h - e * l) / d, (a * l - c * h) / d, (c * e - a * g) / d],
    [(e * k - f * h) / d, (b * h - a * k) / d, (a * f - b * e) / d],
  ];
}

/** Lengths (Å) and angles (°) of a cell, as text. */
export function describeCell(lattice: Cell3, volume: number): string {
  const [a, b, c] = lattice;
  const f = (x: number, d = 3) => Number(x.toFixed(d)).toString();
  return `a = ${f(norm(a))}, b = ${f(norm(b))}, c = ${f(norm(c))} Å · α = ${f(angle(b, c), 2)}°, β = ${f(angle(a, c), 2)}°, γ = ${f(angle(a, b), 2)}° · volume ${f(volume, 2)} Å³`;
}
