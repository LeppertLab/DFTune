// What the structure viewer draws: the atoms of a POSCAR/CONTCAR or pw.x input, their periodic
// images on the cell boundary and in a supercell, and bonds guessed from covalent radii.

import { elementOf } from '../poscar/elements';
import { cross, det, norm, parsePoscar, type Vec3 } from '../poscar/parse';
import { parseQe } from '../qe/parse';
import { qeCell, qeStructure } from '../qe/structure';
import { cardsOf } from '../qe/tags';
import { covalentRadius } from './elementData';

type Cell3 = [Vec3, Vec3, Vec3];

export type StructureFormat = 'poscar' | 'qe';

export interface ViewAtom {
  /** Element symbol, or the label when it names no element. */
  element: string;
  /** Species name as written in the file ("Fe_pv", "Fe1"). */
  label: string;
  /** Fractional coordinates as written. */
  frac: Vec3;
  /** Offsets of the atom's line in the file. */
  start: number;
  end: number;
}

export interface ViewStructure {
  title: string;
  /** Lattice vectors in Å, as rows. */
  lattice: Cell3;
  volume: number;
  atoms: ViewAtom[];
}

/**
 * The structure in a file, or why it cannot be shown. `speciesHint` names the species of a VASP 4
 * POSCAR, which has none of its own (from the POTCAR next to it).
 */
export function readStructure(text: string, format: StructureFormat, speciesHint?: string[]): ViewStructure | { error: string } {
  return format === 'qe' ? readQe(text) : readPoscarStructure(text, speciesHint);
}

function readPoscarStructure(text: string, speciesHint?: string[]): ViewStructure | { error: string } {
  const doc = parsePoscar(text, { distances: false });
  const s = doc.structure;
  if (!s) {
    const problem = doc.diagnostics.find((d) => d.severity === 'error');
    return { error: problem ? `The POSCAR cannot be read: ${problem.message}` : 'The POSCAR cannot be read.' };
  }
  const names = s.species ?? (speciesHint?.length === s.counts.length ? speciesHint : undefined);
  const atoms: ViewAtom[] = [];
  let k = 0;
  s.counts.forEach((count, species) => {
    const name = names?.[species];
    const label = name ?? `Species ${species + 1}`;
    for (let j = 0; j < count; j++, k++) {
      const line = s.atomLines[k];
      atoms.push({ element: (name && elementOf(name)) || label, label, frac: s.frac[k], start: line.start, end: line.end });
    }
  });
  return { title: doc.header?.comment ?? '', lattice: s.lattice, volume: s.volume, atoms };
}

function readQe(text: string): ViewStructure | { error: string } {
  const doc = parseQe(text, { cards: cardsOf('pw') });
  const s = qeStructure(doc);
  if (!s) {
    if (!doc.namelists.some((n) => n.name === 'SYSTEM')) return { error: 'This input has no crystal structure: only pw.x inputs (with &SYSTEM) have one.' };
    const cell = qeCell(doc);
    if (cell && 'error' in cell) return { error: `The cell cannot be built: ${cell.error}.` };
    return { error: 'The structure cannot be read: it needs ibrav (with celldm or A, or CELL_PARAMETERS) and ATOMIC_POSITIONS in alat, bohr, angstrom or crystal units.' };
  }
  // Labels like "Fe1" name their element; otherwise the pseudopotential file usually does.
  const pseudo = new Map<string, string>();
  for (const l of doc.cards.find((c) => c.name === 'ATOMIC_SPECIES')?.lines ?? []) {
    if (l.tokens.length >= 3) pseudo.set(l.tokens[0].text, l.tokens[2].text);
  }
  const atoms = s.labels.map((label, i) => {
    const file = pseudo.get(label)?.split(/[\\/]/).pop();
    const element = elementOf(label) ?? (file ? elementOf(file) : undefined) ?? label;
    return { element, label, frac: s.frac[i], start: s.spans[i].start, end: s.spans[i].end };
  });
  const title = doc.namelists.find((n) => n.name === 'CONTROL') ? (text.match(/\bprefix\s*=\s*['"]([^'"]*)['"]/i)?.[1] ?? '') : '';
  return { title, lattice: s.lattice, volume: s.volume, atoms };
}

export interface SceneOptions {
  /** Supercell repetitions along a, b, c (≥ 1). */
  repeat: Vec3;
  /** Also draw the images of atoms that sit on a face, edge or corner of the (super)cell. */
  boundary: boolean;
  bonds: boolean;
  /** Bonded when the distance is below r₁ + r₂ + tolerance (Å, covalent radii). */
  bondTolerance: number;
}

export const DEFAULT_SCENE: SceneOptions = { repeat: [1, 1, 1], boundary: true, bonds: true, bondTolerance: 0.45 };

export interface SceneAtom {
  /** Index into ViewStructure.atoms. */
  atom: number;
  element: string;
  /** Fractional coordinates of this copy, in units of the unit cell. */
  frac: Vec3;
  cart: Vec3;
  /** A periodic image rather than the atom itself. */
  image: boolean;
}

/** Half a bond, drawn in the colour of the atom it starts at. */
export interface HalfBond {
  from: Vec3;
  to: Vec3;
  element: string;
}

export interface Scene {
  atoms: SceneAtom[];
  bonds: HalfBond[];
  /** Bonds are left out above this many atoms. */
  bondsSkipped: boolean;
}

/** Bonds are not searched beyond this many drawn atoms (the search would stall the view). */
export const MAX_BOND_ATOMS = 20000;
/** Non-metals and metalloids: a bond needs at least one of these (no metal–metal bonds, as in most crystal viewers). */
const NONMETALS = new Set('H He B C N O F Ne Si P S Cl Ar Ge As Se Br Kr Sb Te I Xe At Rn'.split(' '));

/** Whether two elements can be bonded. */
export function bondable(a: string, b: string): boolean {
  return NONMETALS.has(a) || NONMETALS.has(b);
}

/** Atoms within this fraction of a cell face count as on it. */
const FACE_EPS = 1e-4;

const toCart = (f: Vec3, L: Cell3): Vec3 => [0, 1, 2].map((j) => f[0] * L[0][j] + f[1] * L[1][j] + f[2] * L[2][j]) as Vec3;

/** Into [0, 1), with values just below 1 taken as 0. */
function wrap(x: number): number {
  const w = x - Math.floor(x);
  return w > 1 - FACE_EPS ? 0 : w;
}

const keyOf = (f: Vec3) => f.map((x) => Math.round(x * 1e4)).join(',');

export function buildScene(s: ViewStructure, options: SceneOptions = DEFAULT_SCENE): Scene {
  const L = s.lattice;
  const R = options.repeat.map((r) => Math.max(1, Math.floor(r))) as Vec3;
  const atoms: SceneAtom[] = [];
  const byKey = new Map<string, number>();
  const add = (atom: number, frac: Vec3, image: boolean) => {
    const key = keyOf(frac);
    if (byKey.has(key)) return;
    byKey.set(key, atoms.length);
    atoms.push({ atom, element: s.atoms[atom].element, frac, cart: toCart(frac, L), image });
  };
  const base = s.atoms.map((a) => a.frac.map(wrap) as Vec3);
  base.forEach((f, atom) => {
    for (let i = 0; i < R[0]; i++) for (let j = 0; j < R[1]; j++) for (let k = 0; k < R[2]; k++) add(atom, [f[0] + i, f[1] + j, f[2] + k], i + j + k > 0);
  });
  if (options.boundary) {
    // Every combination of moving a coordinate at 0 to the far face R.
    const count = atoms.length;
    for (let n = 0; n < count; n++) {
      const { atom, frac } = atoms[n];
      const axes = [0, 1, 2].filter((d) => frac[d] < FACE_EPS);
      for (let mask = 1; mask < 1 << axes.length; mask++) {
        const f = [...frac] as Vec3;
        axes.forEach((d, b) => {
          if (mask & (1 << b)) f[d] += R[d];
        });
        add(atom, f, true);
      }
    }
  }
  const scene: Scene = { atoms, bonds: [], bondsSkipped: false };
  if (!options.bonds || atoms.length === 0) return scene;
  if (atoms.length > MAX_BOND_ATOMS) return { ...scene, bondsSkipped: true };
  scene.bonds = findBonds(s, base, atoms, byKey, R, options.bondTolerance);
  return scene;
}

function findBonds(s: ViewStructure, base: Vec3[], shown: SceneAtom[], byKey: Map<string, number>, R: Vec3, tolerance: number): HalfBond[] {
  const L = s.lattice;
  const radius = new Map<string, number>();
  for (const a of s.atoms) radius.set(a.element, covalentRadius(a.element));
  const maxCut = 2 * Math.max(...radius.values()) + tolerance;
  // Images needed beyond the drawn region: the cut-off over the cell's width along each axis.
  const volume = Math.abs(det(L));
  const widths = [cross(L[1], L[2]), cross(L[2], L[0]), cross(L[0], L[1])].map((v) => volume / norm(v));
  const pad = widths.map((w) => Math.ceil(maxCut / w)) as Vec3;

  // Hash every candidate neighbour (atoms and images around the drawn region) by its grid cell.
  const cell = maxCut;
  const grid = new Map<string, { atom: number; frac: Vec3; cart: Vec3 }[]>();
  const gkey = (c: Vec3) => c.map((x) => Math.floor(x / cell)).join(',');
  base.forEach((f, atom) => {
    for (let i = -pad[0]; i < R[0] + pad[0] + 1; i++)
      for (let j = -pad[1]; j < R[1] + pad[1] + 1; j++)
        for (let k = -pad[2]; k < R[2] + pad[2] + 1; k++) {
          const frac: Vec3 = [f[0] + i, f[1] + j, f[2] + k];
          const cart = toCart(frac, L);
          const key = gkey(cart);
          let bucket = grid.get(key);
          if (!bucket) grid.set(key, (bucket = []));
          bucket.push({ atom, frac, cart });
        }
  });

  const bonds: HalfBond[] = [];
  shown.forEach((p, pi) => {
    const rp = radius.get(p.element)!;
    const g = p.cart.map((x) => Math.floor(x / cell));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const q of grid.get(`${g[0] + dx},${g[1] + dy},${g[2] + dz}`) ?? []) {
            const d = norm([q.cart[0] - p.cart[0], q.cart[1] - p.cart[1], q.cart[2] - p.cart[2]]);
            const element = s.atoms[q.atom].element;
            if (d < 0.1 || d > rp + radius.get(element)! + tolerance || !bondable(p.element, element)) continue;
            const mid: Vec3 = [(p.cart[0] + q.cart[0]) / 2, (p.cart[1] + q.cart[1]) / 2, (p.cart[2] + q.cart[2]) / 2];
            const qi = byKey.get(keyOf(q.frac));
            if (qi === undefined) bonds.push({ from: p.cart, to: mid, element: p.element });
            else if (qi > pi) bonds.push({ from: p.cart, to: mid, element: p.element }, { from: q.cart, to: mid, element });
          }
        }
  });
  return bonds;
}

/** Element counts in order of first appearance, e.g. "Fe6 O8". */
export function composition(s: ViewStructure): { element: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of s.atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
  return [...counts].map(([element, count]) => ({ element, count }));
}
