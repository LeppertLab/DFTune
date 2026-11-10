import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { covalentRadius, elementColor } from '../../src/core/structure/elementData';
import { bondable, buildScene, composition, DEFAULT_SCENE, readStructure, type ViewStructure } from '../../src/core/structure/view';

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures', name), 'utf8');

function read(text: string, format: 'poscar' | 'qe', hint?: string[]): ViewStructure {
  const s = readStructure(text, format, hint);
  if ('error' in s) throw new Error(s.error);
  return s;
}

describe('readStructure', () => {
  it('reads the atoms of a POSCAR with their lines', () => {
    const text = fixture('POSCAR');
    const s = read(text, 'poscar');
    expect(s.title).toBe('Fe3O4 primitive');
    expect(s.atoms).toHaveLength(14);
    expect(composition(s)).toEqual([{ element: 'Fe', count: 6 }, { element: 'O', count: 8 }]);
    expect(text.slice(s.atoms[1].start, s.atoms[1].end)).toBe('0.500 0.500 0.500');
  });

  it('takes the species of a VASP 4 POSCAR from a hint', () => {
    expect(read(fixture('POSCAR.vasp4'), 'poscar', ['Na_pv', 'Cl']).atoms.map((a) => a.element)).toEqual(['Na', 'Cl']);
    expect(read(fixture('POSCAR.vasp4'), 'poscar').atoms[0].element).toBe('Species 1');
  });

  it('reads a pw.x input, taking the element from the pseudopotential when the label names none', () => {
    const s = read(fixture('qe/si.scf.in'), 'qe');
    expect(s.atoms.map((a) => a.element)).toEqual(['Si', 'Si']);
    const custom = read(
      "&control\n/\n&system\n ibrav = 1, A = 3.0, nat = 1, ntyp = 1, ecutwfc = 30\n/\n&electrons\n/\nATOMIC_SPECIES\nX 55.8 Fe.pbe.UPF\nATOMIC_POSITIONS crystal\nX 0 0 0\n",
      'qe',
    );
    expect(custom.atoms[0]).toMatchObject({ element: 'Fe', label: 'X' });
  });

  it('explains why there is no structure', () => {
    expect(readStructure(fixture('qe/ph.in'), 'qe')).toMatchObject({ error: expect.stringMatching(/only pw\.x/) });
    expect(readStructure('broken\n', 'poscar')).toMatchObject({ error: expect.stringMatching(/cannot be read/) });
  });
});

describe('buildScene', () => {
  it('adds the images of atoms on the cell boundary', () => {
    const s = read(fixture('POSCAR'), 'poscar');
    expect(buildScene(s, { ...DEFAULT_SCENE, boundary: false }).atoms).toHaveLength(14);
    const scene = buildScene(s, { ...DEFAULT_SCENE, bonds: false });
    // The atom at the origin sits on all eight corners.
    expect(scene.atoms.filter((a) => a.atom === 0)).toHaveLength(8);
    expect(scene.atoms.filter((a) => !a.image)).toHaveLength(14);
  });

  it('repeats the cell into a supercell', () => {
    const s = read(fixture('qe/si.scf.in'), 'qe');
    expect(buildScene(s, { ...DEFAULT_SCENE, repeat: [2, 2, 2], boundary: false }).atoms).toHaveLength(16);
  });

  it('bonds every silicon atom to its four neighbours', () => {
    const s = read(fixture('qe/si.scf.in'), 'qe');
    const scene = buildScene(s, { ...DEFAULT_SCENE, boundary: false });
    for (const atom of scene.atoms) {
      const halves = scene.bonds.filter((b) => b.from === atom.cart);
      expect(halves).toHaveLength(4);
      for (const b of halves) {
        const half = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]);
        expect(2 * half).toBeCloseTo(2.35, 1);
      }
    }
  });

  it('bonds Fe to O but not Fe to Fe', () => {
    const scene = buildScene(read(fixture('POSCAR'), 'poscar'));
    expect(scene.bonds.length).toBeGreaterThan(0);
    // Each Fe half-bond is as long as half an Fe–O bond (≈ 1.9–2.1 Å), never half an Fe–Fe distance (≈ 2.97 Å).
    for (const b of scene.bonds.filter((x) => x.element === 'Fe')) expect(2 * Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2])).toBeLessThan(2.5);
    expect(bondable('Fe', 'Fe')).toBe(false);
    expect(bondable('Fe', 'O')).toBe(true);
  });

  it('draws no bonds when switched off', () => {
    expect(buildScene(read(fixture('POSCAR'), 'poscar'), { ...DEFAULT_SCENE, bonds: false }).bonds).toEqual([]);
  });
});

describe('element data', () => {
  it('has Jmol colours and covalent radii', () => {
    expect(elementColor('O')).toBe('#FF0D0D');
    expect(elementColor('Fe')).toBe('#E06633');
    expect(covalentRadius('C')).toBe(0.76);
    expect(covalentRadius('Pb')).toBe(1.46);
    expect(elementColor('Xx')).toBe('#ff1493');
  });
});
