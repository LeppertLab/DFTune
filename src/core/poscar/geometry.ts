// Reciprocal-space quantities of a structure, for k-point checks.

import { norm, type Structure, type Vec3 } from './parse';

const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

/** |b1|, |b2|, |b3| in Å⁻¹, including the factor 2π (the convention of KSPACING). */
export function reciprocalLengths(s: Pick<Structure, 'lattice' | 'volume'>): Vec3 {
  const [a, b, c] = s.lattice;
  return [cross(b, c), cross(c, a), cross(a, b)].map((v) => (2 * Math.PI * norm(v)) / s.volume) as Vec3;
}

/** The mesh VASP makes from KSPACING (Å⁻¹): N_i = max(1, ⌈|b_i| / KSPACING⌉). */
export function kspacingMesh(s: Pick<Structure, 'lattice' | 'volume'>, kspacing: number): Vec3 {
  return reciprocalLengths(s).map((b) => Math.max(1, Math.ceil(b / kspacing - 1e-9))) as Vec3;
}

/** k-point spacing along each reciprocal vector for a mesh, in Å⁻¹ (2π included). */
export function meshSpacing(s: Pick<Structure, 'lattice' | 'volume'>, mesh: Vec3): Vec3 {
  return reciprocalLengths(s).map((b, i) => b / mesh[i]) as Vec3;
}

/**
 * Index (0–2) of the lattice vector along the hexagonal c axis if the cell is hexagonal (two
 * vectors of equal length at 60° or 120°, the third perpendicular to both), else undefined.
 */
export function hexagonalAxis(s: Pick<Structure, 'lattice'>): number | undefined {
  const L = s.lattice;
  const deg = (u: Vec3, v: Vec3) => (Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))) * 180) / Math.PI;
  for (const [i, j, k] of [[0, 1, 2], [1, 2, 0], [0, 2, 1]]) {
    const equal = Math.abs(norm(L[i]) - norm(L[j])) < 1e-3 * norm(L[i]);
    const ang = deg(L[i], L[j]);
    const inPlane = Math.abs(ang - 120) < 0.5 || Math.abs(ang - 60) < 0.5;
    const perpendicular = Math.abs(deg(L[i], L[k]) - 90) < 0.5 && Math.abs(deg(L[j], L[k]) - 90) < 0.5;
    if (equal && inPlane && perpendicular) return k;
  }
  return undefined;
}
