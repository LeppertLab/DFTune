// Reads just enough of a POSCAR/CONTCAR to size per-atom and per-species INCAR arrays, plus the
// cell when the file is complete. Tolerant: the header alone is enough.

import { parsePoscar } from './parse';

export interface PoscarInfo {
  comment: string;
  /** Element symbols in POSCAR order, or undefined for a VASP 4 file without a species line. */
  species?: string[];
  counts: number[];
  nions: number;
  /** Scaled lattice vectors (Å) and cell volume, when the whole file could be read. */
  lattice?: [[number, number, number], [number, number, number], [number, number, number]];
  volume?: number;
}

export function readPoscar(text: string): PoscarInfo | undefined {
  const info = readHeader(text);
  if (!info) return undefined;
  const s = parsePoscar(text).structure;
  return s ? { ...info, lattice: s.lattice, volume: s.volume } : info;
}

function readHeader(text: string): PoscarInfo | undefined {
  const lines = text.split(/\r?\n/);
  if (lines.length < 7) return undefined;
  const words = (i: number) => (lines[i] ?? '').trim().split(/\s+/).filter(Boolean);
  const isCounts = (ws: string[]) => ws.length > 0 && ws.every((w) => /^\d+$/.test(w));

  let species: string[] | undefined;
  let counts: number[];
  const line6 = words(5);
  if (isCounts(line6)) {
    counts = line6.map(Number);
  } else {
    const line7 = words(6);
    if (!isCounts(line7)) return undefined;
    // POTCAR-hashed names such as "Fe_pv/3a4b…" → "Fe".
    species = line6.map((w) => w.split(/[/_]/)[0]);
    counts = line7.map(Number);
    if (species.length !== counts.length) return undefined;
  }
  return {
    comment: lines[0].trim(),
    species,
    counts,
    nions: counts.reduce((a, b) => a + b, 0),
  };
}
