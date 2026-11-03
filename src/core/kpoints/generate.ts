// Writing a KPOINTS mesh for a structure.

import { kspacingMesh } from '../poscar/geometry';
import type { Structure } from '../poscar/parse';

type Cell = Pick<Structure, 'lattice' | 'volume'>;

/** k-point spacings to choose from, in Å⁻¹ with 2π included (the KSPACING convention). */
export const KPOINT_DENSITIES = [
  { spacing: 0.5, label: 'Coarse', description: 'quick tests, large cells, molecules' },
  { spacing: 0.3, label: 'Standard', description: 'insulators and semiconductors' },
  { spacing: 0.2, label: 'Fine', description: 'metals, total-energy differences' },
  { spacing: 0.12, label: 'Very fine', description: 'DOS, optics, Fermi surfaces' },
] as const;

/** A Γ-centred KPOINTS file with about `spacing` Å⁻¹ between k points (same mesh as KSPACING). */
export function meshKpoints(cell: Cell, spacing: number): string {
  const mesh = kspacingMesh(cell, spacing);
  return `Gamma-centred mesh, k-point spacing ${spacing} 1/A (2pi included, as KSPACING)\n0\nGamma\n${mesh.join(' ')}\n0 0 0\n`;
}
