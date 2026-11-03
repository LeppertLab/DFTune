// The k-point setup of a KPOINTS file, as the INCAR checks and the builder need it
// (https://vasp.at/wiki/KPOINTS). A view on parseKpoints, so both always agree.

import { parseKpoints } from './parse';

export type KpointsInfo =
  /** Regular mesh: "Gamma" or "Monkhorst-Pack" with N1 N2 N3 subdivisions. */
  | { mode: 'mesh'; centering: 'gamma' | 'monkhorst-pack'; subdivisions: [number, number, number] }
  /** Fully automatic: a single length R_k. */
  | { mode: 'auto'; length: number }
  /** Line mode for band structures, `points` per segment. */
  | { mode: 'line'; points: number }
  /** Explicit list of k points (as written by IBZKPT), optionally with tetrahedra. */
  | { mode: 'explicit'; nkpts: number; tetrahedra: boolean }
  /** Mesh given by generating vectors ("Reciprocal"/"Cartesian" basis after a 0 count). */
  | { mode: 'generated' };

/** The k-point setup of a KPOINTS file, read with parseKpoints; undefined if it cannot be determined. */
export function readKpoints(text: string): KpointsInfo | undefined {
  const doc = parseKpoints(text);
  const count = Number(doc.lines[1]?.tokens[0]?.text);
  const role = (r: string) => doc.lines.find((l) => l.role === r);
  switch (doc.layout) {
    case 'line':
      return { mode: 'line', points: count };
    case 'auto': {
      const length = Number(role('length')?.tokens[0]?.text);
      return Number.isFinite(length) ? { mode: 'auto', length } : undefined;
    }
    case 'mesh': {
      const line = role('mesh');
      const n = (line?.fields === 3 ? line.tokens.slice(0, 3) : []).map((t) => Number(t.text));
      if (n.length !== 3 || !n.every((x) => Number.isInteger(x) && x > 0)) return undefined;
      const gamma = role('mode')!.text.trim().charAt(0).toUpperCase() === 'G';
      return { mode: 'mesh', centering: gamma ? 'gamma' : 'monkhorst-pack', subdivisions: n as [number, number, number] };
    }
    case 'explicit':
      return { mode: 'explicit', nkpts: count, tetrahedra: !!role('tetra-flag') };
    case 'vectors':
      return { mode: 'generated' };
  }
  return undefined;
}

/** One-line summary, e.g. "Γ-centred 4×4×2 mesh". */
export function describeKpoints(k: KpointsInfo): string {
  switch (k.mode) {
    case 'mesh':
      return `${k.centering === 'gamma' ? 'Γ-centred' : 'Monkhorst–Pack'} ${k.subdivisions.join('×')} mesh`;
    case 'auto':
      return `fully automatic mesh, length ${k.length}`;
    case 'line':
      return `line mode, ${k.points} points per segment`;
    case 'explicit':
      return `${k.nkpts} explicit k points${k.tetrahedra ? ' with tetrahedra' : ''}`;
    case 'generated':
      return 'mesh from generating vectors';
  }
}

/** Number of k points in the full mesh, when the file fixes it. */
export function meshSize(k: KpointsInfo): number | undefined {
  if (k.mode === 'mesh') return k.subdivisions[0] * k.subdivisions[1] * k.subdivisions[2];
  if (k.mode === 'explicit') return k.nkpts;
  return undefined;
}
