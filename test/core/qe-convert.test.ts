import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atomicMass } from '../../src/core/poscar/masses';
import { ELEMENTS } from '../../src/core/poscar/elements';
import { parsePoscar } from '../../src/core/poscar/parse';
import { formatQe } from '../../src/core/qe/format';
import { poscarToQe, qeToPoscar } from '../../src/core/qe/convert';
import { parseQe } from '../../src/core/qe/parse';
import { qeStructure } from '../../src/core/qe/structure';
import { cardsOf } from '../../src/core/qe/tags';
import { validateQe } from '../../src/core/qe/validate';

const fixture = (...p: string[]) => readFileSync(join(__dirname, '..', 'fixtures', ...p), 'utf8');
const parse = (t: string) => parseQe(t, { cards: cardsOf('pw') });
const opts = { calculation: 'scf' as const, name: 'test', spacing: 0.3 };
const near = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 8));

describe('atomic masses', () => {
  it('has the common elements right', () => {
    expect([atomicMass('H'), atomicMass('C'), atomicMass('O'), atomicMass('Si'), atomicMass('Fe'), atomicMass('Pt'), atomicMass('U')]).toEqual([1.008, 12.011, 15.999, 28.085, 55.845, 195.08, 238.03]);
    expect(atomicMass('Xx')).toBeUndefined();
  });

  it('covers the elements up to plutonium, with plausible values', () => {
    // Every element heavier than the previous one, except the known inversions of the periodic table.
    const inversions = new Set(['K', 'Ni', 'I', 'Pa', 'Np']);
    let previous = 0;
    for (const e of ELEMENTS.slice(0, 94)) {
      const m = atomicMass(e);
      expect(m, e).toBeDefined();
      if (!inversions.has(e)) expect(m!, e).toBeGreaterThan(previous);
      previous = m!;
    }
  });
});

describe('POSCAR → pw.x', () => {
  const structure = parsePoscar(fixture('POSCAR')).structure!;

  it('produces an input that reads back as the same structure', () => {
    const text = poscarToQe(structure, 'Fe3O4 primitive', { ...opts, name: 'Fe3O4' })!;
    const q = qeStructure(parse(text))!;
    expect(q.volume).toBeCloseTo(structure.volume, 6);
    expect(q.labels.join(' ')).toBe('Fe Fe Fe Fe Fe Fe O O O O O O O O');
    near(q.frac.flat(), structure.frac.flat());
    near(q.lattice.flat(), structure.lattice.flat());
  });

  it('is a valid, formatted input with no errors', () => {
    const text = poscarToQe(structure, '', { ...opts, name: 'x' })!;
    expect(validateQe(parse(text), 'pw').filter((d) => d.severity === 'error')).toEqual([]);
    expect(formatQe(text)).toBe(text);
    expect(text).toMatch(/&CONTROL\n {2}calculation = 'scf'/);
    expect(text).toMatch(/ecutwfc = 40 +! placeholder: set it from the recommended cutoff/);
    expect(text).toMatch(/ATOMIC_SPECIES\n {2}Fe {2}55\.845 {2}Fe\.UPF\n {2}O {3}15\.999 {2}O\.UPF/);
    expect(text).toMatch(/CELL_PARAMETERS \{angstrom\}/);
    expect(text).toMatch(/K_POINTS \{automatic\}\n {2}\d+ \d+ \d+ 0 0 0\n$/);
  });

  it('adds the namelists a relaxation needs, and uses the given pseudopotentials and cutoffs', () => {
    const relax = poscarToQe(structure, '', { ...opts, calculation: 'relax' })!;
    expect(relax).toContain('&IONS\n/');
    expect(relax).not.toContain('&CELL');
    expect(validateQe(parse(relax), 'pw').filter((d) => d.severity === 'error')).toEqual([]);
    const vc = poscarToQe(structure, '', { ...opts, calculation: 'vc-relax', pseudoFor: (e) => `${e}.pbe-kjpaw.UPF`, pseudoDir: '/pp', ecutwfc: 50, ecutrho: 400 })!;
    expect(vc).toContain('&CELL\n/');
    expect(vc).toContain('Fe.pbe-kjpaw.UPF');
    expect(vc).toContain("pseudo_dir  = '/pp'");
    expect(vc).toMatch(/ecutwfc +=\s*50 +! suggested by the pseudopotentials\n/);
    expect(vc).toMatch(/ecutrho +=\s*400/);
    expect(validateQe(parse(vc), 'pw').filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('keeps selective dynamics as if_pos, and numbers species of the same element', () => {
    const slab = parsePoscar(fixture('CONTCAR.slab')).structure!;
    const text = poscarToQe(slab, '', { ...opts, name: 'slab' })!;
    expect(text).toMatch(/Pt {2}0\.0 +0\.0 +0\.0 +0 {2}0 {2}0/);
    expect(text).toMatch(/Pt {2}0\.1666666667 .* 1 {2}1 {2}1/);
    const twoFe = parsePoscar('t\n1\n5 0 0\n0 5 0\n0 0 5\nFe Fe\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n').structure!;
    const labelled = poscarToQe(twoFe, '', opts)!;
    expect(labelled).toContain('Fe1  55.845  Fe.UPF');
    expect(labelled).toContain('Fe2  55.845  Fe.UPF');
    expect(validateQe(parse(labelled), 'pw').filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('needs species names', () => {
    const vasp4 = parsePoscar(fixture('POSCAR.vasp4')).structure!;
    expect(poscarToQe(vasp4, '', opts)).toBeUndefined();
  });
});

describe('pw.x → POSCAR', () => {
  it('writes a POSCAR with the same structure', () => {
    const q = qeStructure(parse(fixture('qe', 'si.scf.in')))!;
    const text = qeToPoscar(q, 'Si bulk')!;
    const p = parsePoscar(text);
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(p.structure!.volume).toBeCloseTo(q.volume, 8);
    expect(p.structure!.species).toEqual(['Si']);
    expect(p.structure!.counts).toEqual([2]);
    near(p.structure!.frac.flat(), q.frac.flat());
    expect(text.split('\n')[0]).toBe('Si bulk');
  });

  it('groups atoms by species and keeps fixed coordinates as selective dynamics', () => {
    const input =
      '&CONTROL\n/\n&SYSTEM\nibrav = 1, celldm(1) = 10, nat = 3, ntyp = 2\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nFe 55 f.UPF\nO 16 o.UPF\nATOMIC_POSITIONS {crystal}\nFe 0 0 0 0 0 0\nO 0.5 0.5 0.5 1 1 1\nFe 0.25 0.25 0.25 1 1 0\n';
    const q = qeStructure(parse(input))!;
    const text = qeToPoscar(q, '')!;
    const p = parsePoscar(text).structure!;
    expect(p.species).toEqual(['Fe', 'O']);
    expect(p.counts).toEqual([2, 1]);
    expect(p.selective).toBe(true);
    expect(text).toMatch(/Selective dynamics\nDirect/);
    // Fe 1 (all fixed), Fe 2 (z fixed), O (free).
    expect(p.atomLines.map((l) => l.tokens.slice(3).map((t) => t.text).join(''))).toEqual(['FFF', 'TTF', 'TTT']);
  });

  it('cannot name the species of labels that are not elements', () => {
    const q = qeStructure(parse('&SYSTEM\nibrav = 1, celldm(1) = 10\n/\nATOMIC_POSITIONS {crystal}\nXx 0 0 0\n'))!;
    expect(qeToPoscar(q, '')).toBeUndefined();
  });

  it('round-trips through both conversions', () => {
    const q = qeStructure(parse(fixture('qe', 'fe.relax.in')))!;
    const poscar = qeToPoscar(q, 'Fe')!;
    const back = poscarToQe(parsePoscar(poscar).structure!, 'Fe', { ...opts, name: 'fe' })!;
    const q2 = qeStructure(parse(back))!;
    expect(q2.volume).toBeCloseTo(q.volume, 6);
    near(q2.frac.flat(), q.frac.flat());
  });
});
