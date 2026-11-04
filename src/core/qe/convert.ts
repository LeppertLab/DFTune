// Conversion between POSCAR and pw.x inputs, in both directions.

import { atomicMass } from '../poscar/masses';
import { elementOf } from '../poscar/elements';
import type { Structure, Vec3 } from '../poscar/parse';
import { formatPoscar } from '../poscar/format';
import { automaticGrid } from './kpoints';
import { formatQe } from './format';
import type { QeStructure } from './structure';

export type QeCalculation = 'scf' | 'relax' | 'vc-relax';

export interface ToQeOptions {
  calculation: QeCalculation;
  /** Name for `prefix` and the title comment. */
  name: string;
  /** k-point spacing in Å⁻¹ for the automatic grid. */
  spacing: number;
  /** The pseudopotential file for an element (e.g. found in the pseudopotential directory). */
  pseudoFor?: (element: string) => string | undefined;
  pseudoDir?: string;
  /** Cutoffs (Ry) to use, e.g. the largest the pseudopotentials suggest. */
  ecutwfc?: number;
  ecutrho?: number;
}

/** Labels for the species groups of a structure: the element, numbered when an element occurs twice. */
function speciesLabels(species: string[]): { label: string; element: string }[] {
  const elements = species.map((s) => elementOf(s) ?? s);
  return species.map((_, i) => {
    const same = elements.filter((e) => e === elements[i]).length;
    const nth = elements.slice(0, i + 1).filter((e) => e === elements[i]).length;
    return { label: same > 1 ? `${elements[i]}${nth}` : elements[i], element: elements[i] };
  });
}

/** A pw.x input for a POSCAR structure; undefined when the POSCAR has no species names (VASP 4). */
export function poscarToQe(s: Structure, comment: string, o: ToQeOptions): string | undefined {
  if (!s.species) return undefined;
  const groups = speciesLabels(s.species);
  const atomLabels: string[] = [];
  s.counts.forEach((n, k) => atomLabels.push(...Array<string>(n).fill(groups[k].label)));

  const f = (x: number) => (Math.abs(x) < 1e-12 ? '0.0' : Number(x.toFixed(10)).toString());
  const lines: string[] = [];
  lines.push(`! ${o.name}: converted from POSCAR${comment ? ` (${comment})` : ''} by DFTune`);
  lines.push('&CONTROL', `calculation = '${o.calculation}'`, `prefix = '${o.name.replace(/[^\w.-]+/g, '_')}'`, "outdir = './tmp'", `pseudo_dir = '${o.pseudoDir ?? './pseudo'}'`, '/');
  const wfc = o.ecutwfc ?? 40;
  lines.push('&SYSTEM', 'ibrav = 0', `nat = ${s.nions}`, `ntyp = ${groups.length}`, `ecutwfc = ${wfc}  ! ${o.ecutwfc ? 'suggested by the pseudopotentials' : 'placeholder: set it from the recommended cutoff of your pseudopotentials'}`);
  if (o.ecutrho) lines.push(`ecutrho = ${o.ecutrho}`);
  lines.push('/', '&ELECTRONS', 'conv_thr = 1.0d-8', '/');
  if (o.calculation !== 'scf') lines.push('&IONS', '/');
  if (o.calculation === 'vc-relax') lines.push('&CELL', '/');

  lines.push('ATOMIC_SPECIES');
  groups.forEach((g) => {
    const mass = atomicMass(g.element);
    lines.push(`${g.label} ${mass ?? 1} ${o.pseudoFor?.(g.element) ?? `${g.element}.UPF`}${mass === undefined ? '  ! mass unknown: set it' : ''}`);
  });
  lines.push('CELL_PARAMETERS {angstrom}');
  for (const v of s.lattice) lines.push(v.map(f).join(' '));
  lines.push('ATOMIC_POSITIONS {crystal}');
  s.frac.forEach((p, i) => {
    // Selective-dynamics flags: T → 1 (free), F → 0 (fixed).
    const flags = s.selective ? s.atomLines[i].tokens.slice(3, 6).map((t) => (/^\.?T/i.test(t.text) ? '1' : '0')).join(' ') : '';
    lines.push(`${atomLabels[i]} ${p.map(f).join(' ')}${flags ? ' ' + flags : ''}`);
  });
  const grid = automaticGrid(s, o.spacing);
  lines.push('K_POINTS {automatic}', `${grid.join(' ')} 0 0 0`);
  return formatQe(lines.join('\n') + '\n') ?? lines.join('\n') + '\n';
}

/**
 * A POSCAR for a pw.x structure. Atoms are grouped by species in order of first appearance, as a
 * POSCAR needs; positions are direct coordinates. `flags` (if_pos per atom) become selective dynamics.
 */
export function qeToPoscar(s: QeStructure, comment: string): string | undefined {
  const flags = s.flags;
  const order: string[] = [];
  for (const l of s.labels) if (!order.includes(l)) order.push(l);
  const elements = order.map((l) => elementOf(l));
  if (elements.some((e) => e === undefined)) return undefined;
  const f = (x: number) => (Math.abs(x) < 1e-12 ? '0.0' : Number(x.toFixed(10)).toString());
  const atoms = order.flatMap((l) => s.labels.map((label, i) => (label === l ? i : -1)).filter((i) => i >= 0));
  const selective = !!flags && atoms.some((i) => flags[i]?.some((x) => x === '0'));
  const lines = [comment || 'converted from a Quantum ESPRESSO input by DFTune', '1.0', ...s.lattice.map((v: Vec3) => v.map(f).join(' ')), elements.join(' '), order.map((l) => s.labels.filter((x) => x === l).length).join(' ')];
  if (selective) lines.push('Selective dynamics');
  lines.push('Direct');
  for (const i of atoms) {
    const flag = selective ? ' ' + [0, 1, 2].map((k) => (flags![i]?.[k] === '0' ? 'F' : 'T')).join(' ') : '';
    lines.push(`${s.frac[i].map(f).join(' ')}${flag}`);
  }
  const text = lines.join('\n') + '\n';
  return formatPoscar(text) ?? text;
}
