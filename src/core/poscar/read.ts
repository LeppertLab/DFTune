// Reads just enough of a POSCAR/CONTCAR to size per-atom and per-species INCAR arrays.

export interface PoscarInfo {
  comment: string;
  /** Element symbols in POSCAR order, or undefined for a VASP 4 file without a species line. */
  species?: string[];
  counts: number[];
  nions: number;
}

export function readPoscar(text: string): PoscarInfo | undefined {
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
