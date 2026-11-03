import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIncar } from '../../src/core/incar/parse';
import { autoMesh, kpointsHover, lintKpoints } from '../../src/core/kpoints/context';
import { hexagonalAxis, kspacingMesh, reciprocalLengths } from '../../src/core/poscar/geometry';
import { parsePoscar, type Structure } from '../../src/core/poscar/parse';
import { readPoscar } from '../../src/core/poscar/read';
import { potcarMismatch } from '../../src/core/potcar/check';
import { readPotcar } from '../../src/core/potcar/read';
import { validate } from '../../src/core/validation/rules';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');
const potcar = readPotcar(fixture('POTCAR.headers'));
const cell = (text: string) => parsePoscar(text).structure as Structure;
const SI = cell('Si\n5.43\n0 0.5 0.5\n0.5 0 0.5\n0.5 0.5 0\nSi\n2\nDirect\n0 0 0\n0.25 0.25 0.25\n');
const HEX = cell('graphite-like\n1\n3.2 0 0\n-1.6 2.7712812921 0\n0 0 5.2\nC\n1\nDirect\n0 0 0\n');
const SLAB = cell('slab\n1\n3 0 0\n0 3 0\n0 0 30\nH\n1\nDirect\n0 0 0\n');
const codes = (text: string, ctx: Parameters<typeof validate>[1]) => validate(parseIncar(text), ctx).map((d) => d.code);

describe('POTCAR headers', () => {
  it('reads symbols, elements, ENMAX and ZVAL in order', () => {
    expect(potcar).toEqual([
      { kind: 'PAW_PBE', symbol: 'Fe_pv', element: 'Fe', enmax: 293.238, zval: 14 },
      { kind: 'PAW_PBE', symbol: 'O', element: 'O', enmax: 400, zval: 6 },
    ]);
  });

  it('compares with the POSCAR species', () => {
    expect(potcarMismatch(potcar, ['Fe', 'O'], 2)).toBeUndefined();
    expect(potcarMismatch(potcar, ['O', 'Fe'], 2)).toMatch(/same elements, wrong order/);
    expect(potcarMismatch(potcar, ['Fe', 'O', 'H'], 3)).toMatch(/POTCAR has 2 datasets \(Fe_pv O\) but POSCAR has 3 species/);
    expect(potcarMismatch(potcar, undefined, 2)).toBeUndefined();
    expect(potcarMismatch(potcar, undefined, 1)).toMatch(/1 species/);
  });
});

describe('INCAR rules with a POTCAR', () => {
  const poscar = readPoscar(fixture('POSCAR'))!;
  it('compares ENCUT with ENMAX', () => {
    expect(codes('ENCUT = 300\n', { poscar, potcar })).toContain('encut-below-enmax');
    expect(codes('ENCUT = 520\n', { poscar, potcar })).not.toContain('encut-below-enmax');
  });

  it('gives a concrete cutoff against Pulay stress', () => {
    const d = validate(parseIncar('IBRION = 2\nNSW = 50\nISIF = 3\n'), { poscar, potcar }).find((x) => x.code === 'pulay')!;
    expect(d.message).toMatch(/ENCUT ≈ 520 \(1\.3 × ENMAX\)/);
    expect(codes('IBRION = 2\nNSW = 50\nISIF = 3\nENCUT = 420\n', { poscar, potcar })).toContain('pulay');
    expect(codes('IBRION = 2\nNSW = 50\nISIF = 3\nENCUT = 520\n', { poscar, potcar })).not.toContain('pulay');
  });

  it('reports a POTCAR in the wrong order', () => {
    expect(codes('ENCUT = 520\n', { poscar: { ...poscar, species: ['O', 'Fe'] }, potcar })).toContain('potcar-mismatch');
    expect(codes('ENCUT = 520\n', { poscar, potcar })).not.toContain('potcar-mismatch');
  });

  it('needs distinct species names for MLFF', () => {
    const dup = { ...poscar, species: ['Fe', 'Fe'], counts: [3, 3] };
    expect(codes('ML_LMLFF = .TRUE.\n', { poscar: dup })).toContain('mlff-duplicate-species');
    expect(codes('ML_LMLFF = .TRUE.\n', { poscar })).not.toContain('mlff-duplicate-species');
  });
});

describe('k-point geometry', () => {
  it('computes reciprocal lengths with 2π, and the KSPACING mesh', () => {
    expect(reciprocalLengths(SI)[0]).toBeCloseTo((2 * Math.PI * Math.sqrt(3)) / 5.43, 6);
    expect(kspacingMesh(SI, 0.5)).toEqual([5, 5, 5]);
    expect(kspacingMesh(SLAB, 0.25)).toEqual([9, 9, 1]);
  });

  it('builds the fully automatic mesh', () => {
    expect(autoMesh(SLAB, 30)).toEqual([10, 10, 1]);
  });

  it('recognizes hexagonal cells', () => {
    expect(hexagonalAxis(HEX)).toBe(2);
    expect(hexagonalAxis(SI)).toBeUndefined();
    expect(hexagonalAxis(SLAB)).toBeUndefined();
  });
});

describe('KPOINTS with the structure', () => {
  const kcodes = (text: string, c?: Structure) => lintKpoints(text, c).map((d) => `${d.code}:${d.severity}`);
  it('warns about an even Monkhorst–Pack mesh only for hexagonal cells', () => {
    expect(kcodes('k\n0\nMonkhorst-Pack\n6 6 4\n')).toEqual(['kpoints-even-mp:info']);
    expect(kcodes('k\n0\nMonkhorst-Pack\n6 6 4\n', HEX)).toEqual(['kpoints-hexagonal-mp:warning']);
    expect(kcodes('k\n0\nMonkhorst-Pack\n6 6 6\n', SI)).toEqual([]);
    expect(kcodes('k\n0\nGamma\n6 6 4\n', HEX)).toEqual([]);
  });

  it('notes a much finer mesh in one direction', () => {
    const d = lintKpoints('k\n0\nGamma\n8 8 8\n', SLAB);
    expect(d.map((x) => x.code)).toEqual(['kpoints-uneven']);
    expect(d[0].message).toMatch(/finer along b3.*8 × 8 × 1/);
    expect(lintKpoints('k\n0\nGamma\n8 8 1\n', SLAB)).toEqual([]);
  });

  it('explains lines on hover', () => {
    const text = 'k\n0\nGamma\n5 5 5\n';
    expect(kpointsHover(text, text.indexOf('5 5'), SI)!.markdown).toMatch(/Γ-centred 5 × 5 × 5 mesh\*\*: 125 k points.*KSPACING ≈ 0\.4/s);
    expect(kpointsHover(text, 2)!.markdown).toMatch(/generated automatically/);
    const auto = 'k\n0\nAuto\n30\n';
    expect(kpointsHover(auto, auto.indexOf('30'), SLAB)!.markdown).toMatch(/10 × 10 × 1 mesh/);
    const bands = 'k\n20\nLine\nR\n0 0 0 G\n0.5 0 0 X\n';
    expect(kpointsHover(bands, bands.indexOf('0.5'))!.markdown).toMatch(/Segment 1, end/);
  });
});

describe('elementOf', async () => {
  const { elementOf } = await import('../../src/core/poscar/elements');
  it('reads POTCAR symbols and POSCAR labels', () => {
    expect(['Fe_pv', 'Fe/3a4b', 'Fe1', 'H1.25', 'O_h', 'Co', 'C', 'Hf', 'fe'].map(elementOf)).toEqual(['Fe', 'Fe', 'Fe', 'H', 'O', 'Co', 'C', 'Hf', 'Fe']);
    expect(['Xx', 'X', '1', ''].map(elementOf)).toEqual([undefined, undefined, undefined, undefined]);
  });
});
