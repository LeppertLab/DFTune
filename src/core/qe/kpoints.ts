// Writing and checking the K_POINTS card of a pw.x input.

import type { TextEdit } from '../incar/edit';
import { UNEVEN_RATIO } from '../kpoints/context';
import { hexagonalAxis, kspacingMesh, meshSpacing, reciprocalLengths } from '../poscar/geometry';
import type { Vec3 } from '../poscar/parse';
import type { QeDoc } from './parse';

type Cell = { lattice: [Vec3, Vec3, Vec3]; volume: number };

/** The grid for a k-point spacing in Å⁻¹ (2π included), the same mesh VASP's KSPACING gives. */
export const automaticGrid = (cell: Cell, spacing: number): Vec3 => kspacingMesh(cell, spacing);

/** A K_POINTS {automatic} card with a Γ-centred grid. */
export function kpointsCard(grid: Vec3, offsets: Vec3 = [0, 0, 0]): string {
  return `K_POINTS {automatic}\n  ${grid.join(' ')} ${offsets.join(' ')}\n`;
}

/** The edit that puts `card` in the input: replaces the K_POINTS card, or appends it. */
export function setKpointsCard(doc: QeDoc, card: string): TextEdit {
  const existing = doc.cards.find((c) => c.name === 'K_POINTS');
  if (!existing) {
    const text = doc.text;
    return { start: text.length, end: text.length, text: (text === '' || text.endsWith('\n') ? '' : '\n') + card };
  }
  // From the keyword to the end of the last data line (a comment line after it is kept); a card
  // without data (K_POINTS gamma) ends with its option, including a closing brace or parenthesis.
  const dataLines = existing.lines.filter((l) => l.text.trim() !== '');
  let end = dataLines.length ? dataLines[dataLines.length - 1].end : (existing.optionSpan?.end ?? existing.nameSpan.end);
  if (!dataLines.length && /^[)}]/.test(doc.text.slice(end))) end += 1;
  const eol = doc.text.includes('\r\n') ? '\r\n' : '\n';
  return { start: existing.nameSpan.start, end, text: card.replace(/\n$/, '').replace(/\n/g, eol) };
}

export interface GridAssessment {
  /** Spacing along b1, b2, b3 in Å⁻¹. */
  spacing: Vec3;
  /** A grid with about the same spacing in every direction, when this one is uneven. */
  balanced?: Vec3;
  /** Offsets to use instead, when a shifted grid breaks the symmetry of a hexagonal cell. */
  unshifted?: Vec3;
}

/** Spacing of an automatic grid, and what is wrong with it for this cell. */
export function assessGrid(cell: Cell, grid: Vec3, offsets: Vec3): GridAssessment {
  const spacing = meshSpacing(cell, grid);
  const coarsest = Math.max(...spacing);
  const fine = [0, 1, 2].filter((i) => grid[i] > 1 && spacing[i] * UNEVEN_RATIO < coarsest);
  const out: GridAssessment = { spacing };
  if (fine.length) out.balanced = reciprocalLengths(cell).map((b) => Math.max(1, Math.ceil(b / coarsest - 1e-9))) as Vec3;
  const hex = hexagonalAxis(cell);
  if (hex !== undefined && offsets.some((o, i) => o !== 0 && i !== hex)) out.unshifted = offsets.map((o, i) => (i === hex ? o : 0)) as Vec3;
  return out;
}
