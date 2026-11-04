// KPOINTS checks and hovers that need the structure (the POSCAR next to it).

import { lineSpan } from '../lines';
import { hexagonalAxis, meshSpacing, reciprocalLengths } from '../poscar/geometry';
import type { Structure, Vec3 } from '../poscar/parse';
import type { Diagnostic } from '../validation/rules';
import { parseKpoints, type KpointsDoc } from './parse';

type Cell = Pick<Structure, 'lattice' | 'volume'>;

/** A finer mesh than this many times the coarsest direction is reported as uneven. */
export const UNEVEN_RATIO = 2.5;
const f = (x: number, d = 3) => Number(x.toFixed(d)).toString();

/** The subdivisions of a Gamma/Monkhorst–Pack file, when they could be read. */
function meshOf(doc: KpointsDoc): { mesh: Vec3; gamma: boolean } | undefined {
  if (doc.layout !== 'mesh') return undefined;
  const line = doc.lines.find((l) => l.role === 'mesh');
  const mode = doc.lines.find((l) => l.role === 'mode');
  if (!line || line.fields < 3 || !mode) return undefined;
  const mesh = line.tokens.slice(0, 3).map((t) => Number(t.text)) as Vec3;
  if (!mesh.every((n) => Number.isInteger(n) && n > 0)) return undefined;
  return { mesh, gamma: mode.text.trim().charAt(0).toUpperCase() === 'G' };
}

/** Mesh VASP builds in fully automatic mode: N_i = max(1, int(R_k·|b_i|/2π + 0.5)). */
export function autoMesh(cell: Cell, length: number): Vec3 {
  return reciprocalLengths(cell).map((b) => Math.max(1, Math.floor((length * b) / (2 * Math.PI) + 0.5))) as Vec3;
}

/**
 * All KPOINTS diagnostics: those of the file itself, plus checks against the structure when there
 * is one. The generic "even Monkhorst–Pack" note is replaced by a precise one when the cell is known.
 */
export function lintKpoints(text: string, cell?: Cell): Diagnostic[] {
  const doc = parseKpoints(text);
  if (!cell) {
    // Without the cell, the even Monkhorst–Pack note still gets its fix.
    const mode = doc.lines.find((l) => l.role === 'mode');
    for (const d of doc.diagnostics) if (d.code === 'kpoints-even-mp' && mode) d.fix = { title: 'Use a Γ-centred mesh (Gamma)', edit: { start: mode.start, end: mode.end, text: 'Gamma' } };
    return doc.diagnostics;
  }
  const out = doc.diagnostics.filter((d) => d.code !== 'kpoints-even-mp');
  const toGamma = (l: { start: number; end: number }) => ({ title: 'Use a Γ-centred mesh (Gamma)', edit: { start: l.start, end: l.end, text: 'Gamma' } });
  const m = meshOf(doc);
  if (!m) return out;
  const modeLine = doc.lines.find((l) => l.role === 'mode')!;
  const meshLine = doc.lines.find((l) => l.role === 'mesh')!;

  const hex = hexagonalAxis(cell);
  if (!m.gamma && hex !== undefined && m.mesh.some((n, i) => i !== hex && n % 2 === 0)) {
    out.push({
      code: 'kpoints-hexagonal-mp',
      severity: 'warning',
      message: 'Hexagonal cell: an even Monkhorst–Pack mesh in the hexagonal plane breaks the symmetry and converges slowly. Use a Γ-centred mesh (Gamma).',
      span: modeLine.tokens[0] ?? lineSpan(modeLine),
      fix: toGamma(modeLine),
    });
  }

  const spacing = meshSpacing(cell, m.mesh);
  const coarsest = Math.max(...spacing);
  // A direction with N = 1 cannot be made coarser, so it is never "too fine".
  const fine = [0, 1, 2].filter((i) => m.mesh[i] > 1 && spacing[i] * UNEVEN_RATIO < coarsest);
  if (fine.length) {
    const suggested = reciprocalLengths(cell).map((b) => Math.max(1, Math.ceil(b / coarsest - 1e-9)));
    out.push({
      code: 'kpoints-uneven',
      severity: 'info',
      message:
        `Uneven k-point density: spacing ${spacing.map((x) => f(x)).join(' × ')} Å⁻¹ along b1 × b2 × b3. ` +
        `The mesh is much finer along ${fine.map((i) => `b${i + 1}`).join(' and ')} than along the coarsest direction; ` +
        `${suggested.join(' × ')} would have about the same accuracy at lower cost (or refine the other directions).`,
      span: lineSpan(meshLine),
      fix: { title: `Use a ${suggested.join(' × ')} mesh`, edit: { start: meshLine.tokens[0].start, end: meshLine.tokens[2].end, text: suggested.join(' ') } },
    });
  }
  return out;
}

/** Hover for a KPOINTS line; the structure adds spacings and the resulting mesh. */
export function kpointsHover(text: string, offset: number, cell?: Cell): { markdown: string; start: number; end: number } | undefined {
  const doc = parseKpoints(text);
  const line = doc.lines.find((l) => offset >= l.start && offset <= l.end);
  if (!line) return undefined;
  const span = { start: line.start, end: line.end };
  const count = Number(doc.lines[1]?.tokens[0]?.text);
  const say = (markdown: string) => ({ ...span, markdown });
  const spacingText = (mesh: Vec3) => {
    if (!cell) return '';
    const sp = meshSpacing(cell, mesh);
    return `\n\nSpacing ${sp.map((x) => f(x)).join(' × ')} Å⁻¹ (2π included, as KSPACING); the same accuracy as KSPACING ≈ ${f(Math.max(...sp), 2)}.`;
  };

  switch (line.role) {
    case 'title':
      return say('**Comment line**: free text, ignored by VASP.');
    case 'count':
      if (doc.layout === 'line') return say(`**${count} points per line segment** (line mode).`);
      if (count === 0) return say('**0**: the mesh is generated automatically (from the lines below).');
      return say(`**${count} k points** listed explicitly.`);
    case 'mode': {
      const meaning: Record<string, string> = {
        auto: 'Fully automatic mesh from a length parameter.',
        mesh: 'Regular mesh: Gamma = Γ-centred, Monkhorst-Pack = shifted off Γ for even subdivisions. Only the first letter counts.',
        vectors: 'Mesh from three generating vectors and a shift (anything but A, G, M here).',
        line: 'Line mode: straight segments between pairs of points, for band structures. Only the first letter counts.',
        explicit: 'Coordinates of the listed k points: C or K = Cartesian, anything else = reciprocal (fractional).',
      };
      return doc.layout ? say(meaning[doc.layout]) : undefined;
    }
    case 'coords':
      return say('Coordinates of the points: C or K = Cartesian (units of 2π/a), anything else = reciprocal (fractional).');
    case 'mesh': {
      const m = meshOf(doc);
      if (!m) return undefined;
      const total = m.mesh[0] * m.mesh[1] * m.mesh[2];
      return say(`**${m.gamma ? 'Γ-centred' : 'Monkhorst–Pack'} ${m.mesh.join(' × ')} mesh**: ${total} k points before symmetry reduction.${spacingText(m.mesh)}`);
    }
    case 'shift':
      return say('**Shift** of the mesh, in units of the subdivisions (usually 0 0 0).');
    case 'length': {
      const length = Number(line.tokens[0]?.text);
      if (!cell || !Number.isFinite(length)) return say('**Length parameter** R_k (Å): N_i = max(1, R_k·|b_i| + 0.5). 10–20 for insulators, 50–100 for metals.');
      const mesh = autoMesh(cell, length);
      return say(`**Length parameter** R_k = ${length} Å gives a Γ-centred ${mesh.join(' × ')} mesh for this POSCAR.${spacingText(mesh)}`);
    }
    case 'point': {
      const points = doc.lines.filter((l) => l.role === 'point');
      const k = points.indexOf(line);
      if (doc.layout === 'line') return say(`**Segment ${Math.floor(k / 2) + 1}, ${k % 2 ? 'end' : 'start'}** point.`);
      const weights = points.map((l) => Number(l.tokens[3]?.text)).filter(Number.isFinite);
      const total = weights.reduce((a, b) => a + b, 0);
      const w = Number(line.tokens[3]?.text);
      return say(`**k point ${k + 1}** of ${points.length}${total > 0 && Number.isFinite(w) ? `, weight ${f((100 * w) / total, 2)} %` : ''}.`);
    }
  }
  return undefined;
}
