// Reads just enough of a KPOINTS file to check it against the INCAR (https://vasp.at/wiki/KPOINTS).

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

export function readKpoints(text: string): KpointsInfo | undefined {
  const lines = text.split(/\r?\n/);
  const words = (i: number) => (lines[i] ?? '').trim().split(/\s+/).filter(Boolean);
  const count = Number(words(1)[0]);
  if (!Number.isInteger(count) || count < 0) return undefined;
  // Only the first letter of the mode line matters to VASP.
  const mode = (lines[2] ?? '').trim().charAt(0).toUpperCase();

  if (mode === 'L') return { mode: 'line', points: count };
  if (count === 0) {
    if (mode === 'A') {
      const length = Number(words(3)[0]);
      return Number.isFinite(length) ? { mode: 'auto', length } : undefined;
    }
    if (mode === 'G' || mode === 'M') {
      const n = words(3).slice(0, 3).map(Number);
      if (n.length !== 3 || !n.every((x) => Number.isInteger(x) && x > 0)) return undefined;
      return { mode: 'mesh', centering: mode === 'G' ? 'gamma' : 'monkhorst-pack', subdivisions: n as [number, number, number] };
    }
    return { mode: 'generated' };
  }
  // Explicit list: `count` k points after the coordinate-system line, then optionally "Tetrahedra".
  const after = (lines[3 + count] ?? '').trim().charAt(0).toUpperCase();
  return { mode: 'explicit', nkpts: count, tetrahedra: after === 'T' };
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
