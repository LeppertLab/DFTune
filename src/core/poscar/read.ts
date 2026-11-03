// What the INCAR checks and the builder need from a POSCAR/CONTCAR: species and counts (to size
// per-atom and per-species arrays), plus the cell when the whole file could be read. A view on
// parsePoscar, so the INCAR checks and the POSCAR linter always agree on what the file says.

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
  const doc = parsePoscar(text, { distances: false });
  if (!doc.header) return undefined;
  const { comment, species, counts, nions } = doc.header;
  const info: PoscarInfo = {
    comment,
    // POTCAR-hashed names such as "Fe_pv/3a4b…" → "Fe".
    species: species?.map((w) => w.split(/[/_]/)[0]),
    counts,
    nions,
  };
  const s = doc.structure;
  return s ? { ...info, lattice: s.lattice, volume: s.volume } : info;
}
