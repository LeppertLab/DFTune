import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPoscar } from '../../src/core/poscar/format';
import { poscarHover } from '../../src/core/poscar/hover';
import { parsePoscar } from '../../src/core/poscar/parse';

const fixtures = join(__dirname, '..', 'fixtures');
const files = readdirSync(fixtures)
  .filter((f) => f.startsWith('POSCAR') || f.startsWith('CONTCAR'))
  .map((f) => [f, readFileSync(join(fixtures, f), 'utf8')] as const);

const codes = (text: string) => parsePoscar(text).diagnostics.map((d) => `${d.code}:${d.severity}`);
const errors = (text: string) => parsePoscar(text).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const SI = 'Si\n5.43\n0 0.5 0.5\n0.5 0 0.5\n0.5 0.5 0\nSi\n2\nDirect\n0 0 0\n0.25 0.25 0.25\n';

describe('parsePoscar', () => {
  it('reads the fixtures without errors', () => {
    for (const [name, text] of files) expect(errors(text), name).toEqual([]);
  });

  it('builds the structure', () => {
    const s = parsePoscar(SI).structure!;
    expect(s.nions).toBe(2);
    expect(s.species).toEqual(['Si']);
    expect(s.volume).toBeCloseTo(5.43 ** 3 / 4, 6);
  });

  it('handles a negative scale (volume) and Cartesian positions', () => {
    const s = parsePoscar(readFileSync(join(fixtures, 'POSCAR.cartesian'), 'utf8')).structure!;
    expect(s.volume).toBeCloseTo(40.04, 6);
    expect(s.frac[1].map((x) => Number(x.toFixed(6)))).toEqual([0.25, 0.25, 0.25]);
  });

  it('handles three scaling factors', () => {
    const s = parsePoscar('t\n1 2 3\n1 0 0\n0 1 0\n0 0 1\nH\n1\nC\n0.5 1 1.5\n').structure!;
    expect(s.volume).toBeCloseTo(6);
    expect(s.frac[0].map((x) => Number(x.toFixed(6)))).toEqual([0.5, 1, 1.5]);
  });

  it('reports structural problems', () => {
    expect(errors('')).toHaveLength(1);
    expect(errors('t\nx\n')[0]).toMatch(/not a number/);
    expect(errors('t\n0\n1 0 0\n0 1 0\n0 0 1\nH\n1\nD\n0 0 0\n')[0]).toMatch(/cannot be zero/);
    expect(errors('t\n1\n1 0 0\n0 1 0\n')[0]).toMatch(/ends before lattice vector 3/);
    expect(errors('t\n1\n1 0 0\n2 0 0\n0 0 1\nH\n1\nD\n0 0 0\n')[0]).toMatch(/linearly dependent/);
    expect(errors('t\n1\n5 0 0\n0 5 0\n0 0 5\nH O\n1\nD\n0 0 0\n')[0]).toMatch(/2 element names but 1 atom count/);
    expect(errors('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\nx\nD\n0 0 0\n')[0]).toMatch(/atoms per species/);
    expect(errors('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nD\n0 0 0\n')[0]).toMatch(/ends after 1 of 2 atoms/);
    expect(errors('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n1\n0 0 0\n')[0]).toMatch(/found a number/);
    expect(errors('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n1\nS\nD\n0 0 0 T T\n')[0]).toMatch(/three T\/F flags/);
    expect(errors('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n1\nS\nD\n0 0 0 T X T\n')[0]).toMatch(/"X" must be T or F/);
  });

  it('warns about suspicious but readable input', () => {
    expect(codes('t\n1\n5 0 0\n0 5 0\n0 0 5\nXx\n1\nD\n0 0 0\n')).toEqual(['poscar-element:warning']);
    expect(codes('t\n1\n0 5 0\n5 0 0\n0 0 5\nH\n1\nD\n0 0 0\n')).toEqual(['poscar-left-handed:warning']);
    expect(codes('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nD\n0 0 0\n0.02 0 0\n')).toEqual(['poscar-close-atoms:warning']);
    expect(codes('t\n1\n0.3 0 0\n0 5 0\n0 0 5\nH\n1\nD\n0 0 0\n')).toEqual(['poscar-close-atoms:warning']);
    expect(codes('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nD\n0 0 0\n3 2.5 2.5\n')).toEqual(['poscar-mode-mismatch:warning']);
    expect(codes('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n1\nS\nD\n0 0 0 F F F\n')).toEqual(['poscar-all-fixed:info']);
    expect(codes('t\n1\n5 0 0\n0 5 0\n0 0 5\n1\nD\n0 0 0\n')).toEqual(['poscar-vasp4:hint']);
  });

  it('finds close atoms across the cell boundary', () => {
    const d = parsePoscar('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nD\n0.01 0 0\n0.99 0 0\n').diagnostics;
    expect(d.map((x) => x.message)).toEqual(['Atoms 1 (H) and 2 (H) are only 0.10 Å apart.']);
  });
});

describe('formatPoscar', () => {
  it('aligns lattice, species over counts, and positions', () => {
    expect(formatPoscar('Fe3O4\n1.0\n5.937 0 0\n2.9685 5.14155 0\n 2.9685 1.71385 4.84755\nFe O\n6 14\ndirect\n0 0 0\n0.5 0.5 0.5\n0.625 0.625 0.625 ! O1\n' + '0.1 0.1 0.1\n'.repeat(17))).toMatch(
      /^Fe3O4\n1\.0\n5\.937   0        0\n2\.9685  5\.14155  0\n2\.9685  1\.71385  4\.84755\nFe   O\n 6  14\nDirect\n0      0      0\n0\.5    0\.5    0\.5\n0\.625  0\.625  0\.625  ! O1\n/,
    );
  });

  it('aligns selective-dynamics flags and keeps CONTCAR velocities', () => {
    const out = formatPoscar('t\n1\n5 0 0\n0 5 0\n0 0 5\nH O\n1 1\nselective\nd\n0 0 0 T T T\n0.25 0.5 0.5  F F T  O\n\n 0.0 0.0 0.0\n 0.0  0.0 0.0\n')!;
    expect(out).toBe('t\n1\n5  0  0\n0  5  0\n0  0  5\nH  O\n1  1\nSelective dynamics\nDirect\n0     0    0    T  T  T\n0.25  0.5  0.5  F  F  T  O\n\n 0.0 0.0 0.0\n 0.0  0.0 0.0\n');
  });

  it('keeps every number and name, and is idempotent', () => {
    const words = (t: string) => t.split(/\s+/).filter((w) => /\d/.test(w));
    for (const [name, text] of files) {
      const once = formatPoscar(text)!;
      expect(once, name).toBeDefined();
      expect(formatPoscar(once), name).toBe(once);
      expect(words(once), name).toEqual(words(text));
      expect(parsePoscar(once).diagnostics.map((d) => d.code), name).toEqual(parsePoscar(text).diagnostics.map((d) => d.code));
    }
  });

  it('leaves files with errors alone', () => {
    expect(formatPoscar('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nD\n0 0 0\n')).toBeUndefined();
  });
});

describe('poscarHover', () => {
  const doc = parsePoscar(readFileSync(join(fixtures, 'POSCAR'), 'utf8'));
  const text = readFileSync(join(fixtures, 'POSCAR'), 'utf8');
  it('explains positions, counts and the lattice', () => {
    expect(poscarHover(doc, text.indexOf('0.250 0.250 0.250'))!.markdown).toMatch(/^\*\*Atom 7\*\*: O #1\n\nCartesian: /);
    expect(poscarHover(doc, text.indexOf('6 8') + 2)!.markdown).toBe('**O**: 8 of 14 atoms (atoms 7–14)');
    expect(poscarHover(doc, text.indexOf('5.937'))!.markdown).toMatch(/\|a\| = 5\.937 Å/);
    expect(poscarHover(doc, text.indexOf('1.0'))!.markdown).toMatch(/Å³ per atom/);
  });
});
