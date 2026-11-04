import { describe, expect, it } from 'vitest';
import { det, norm } from '../../src/core/poscar/parse';
import { parseQe } from '../../src/core/qe/parse';
import { cardsOf } from '../../src/core/qe/tags';
import { BOHR, IBRAV_VALUES, abc2celldm, describeCell, latgen, qeCell, qeStructure } from '../../src/core/qe/structure';

const volume = (ibrav: number, celldm: number[]) => {
  const g = latgen(ibrav, celldm);
  if (typeof g === 'string') throw new Error(g);
  return det(g);
};
const dm = (...c: number[]) => [...c, 0, 0, 0, 0, 0, 0].slice(0, 6);
const A = 7.3;

describe('latgen: volumes against the textbook formulas', () => {
  const B = 1.3;
  const C = 1.7;
  const sin = (cos: number) => Math.sqrt(1 - cos * cos);
  const cases: [string, number, number[], number][] = [
    ['simple cubic', 1, dm(A), A ** 3],
    ['fcc', 2, dm(A), A ** 3 / 4],
    ['bcc', 3, dm(A), A ** 3 / 2],
    ['bcc, other axes', -3, dm(A), A ** 3 / 2],
    ['hexagonal', 4, dm(A, 0, C), (Math.sqrt(3) / 2) * A ** 3 * C],
    ['trigonal R (cos = 0.3)', 5, dm(A, 0, 0, 0.3), A ** 3 * Math.sqrt(1 - 3 * 0.3 ** 2 + 2 * 0.3 ** 3)],
    ['trigonal R, 3-fold axis along (111)', -5, dm(A, 0, 0, 0.3), A ** 3 * Math.sqrt(1 - 3 * 0.3 ** 2 + 2 * 0.3 ** 3)],
    ['tetragonal', 6, dm(A, 0, C), A ** 3 * C],
    ['body-centred tetragonal', 7, dm(A, 0, C), (A ** 3 * C) / 2],
    ['orthorhombic', 8, dm(A, B, C), A ** 3 * B * C],
    ['base-centred orthorhombic', 9, dm(A, B, C), (A ** 3 * B * C) / 2],
    ['base-centred orthorhombic, other setting', -9, dm(A, B, C), (A ** 3 * B * C) / 2],
    ['base-centred orthorhombic (A-type)', 91, dm(A, B, C), (A ** 3 * B * C) / 2],
    ['face-centred orthorhombic', 10, dm(A, B, C), (A ** 3 * B * C) / 4],
    ['body-centred orthorhombic', 11, dm(A, B, C), (A ** 3 * B * C) / 2],
    ['monoclinic (unique axis c)', 12, dm(A, B, C, 0.2), A ** 3 * B * C * sin(0.2)],
    ['monoclinic (unique axis b)', -12, dm(A, B, C, 0, 0.2), A ** 3 * B * C * sin(0.2)],
    ['base-centred monoclinic', 13, dm(A, B, C, 0.2), (A ** 3 * B * C * sin(0.2)) / 2],
    ['base-centred monoclinic (unique axis b)', -13, dm(A, B, C, 0, 0.2), (A ** 3 * B * C * sin(0.2)) / 2],
    ['triclinic', 14, dm(A, B, C, 0.1, 0.2, 0.3), A ** 3 * B * C * Math.sqrt(1 - 0.1 ** 2 - 0.2 ** 2 - 0.3 ** 2 + 2 * 0.1 * 0.2 * 0.3)],
  ];
  for (const [name, ibrav, celldm, expected] of cases) {
    it(`${name} (ibrav = ${ibrav})`, () => {
      expect(volume(ibrav, celldm)).toBeCloseTo(expected, 8);
    });
  }

  it('covers every Bravais-lattice index', () => {
    expect(new Set(cases.map((c) => c[1]))).toEqual(new Set(IBRAV_VALUES.filter((i) => i !== 0)));
  });

  it('gives the cell lengths and angles that the celldm ask for', () => {
    const g = latgen(14, dm(A, B_, C_, 0.1, 0.2, 0.3)) as [number[], number[], number[]];
    const [a, b, c] = g as never as [[number, number, number], [number, number, number], [number, number, number]];
    expect([norm(a), norm(b), norm(c)].map((x) => Number(x.toFixed(8)))).toEqual([A, A * B_, A * C_]);
    const cos = (u: number[], v: number[]) => (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u as never) * norm(v as never));
    expect(cos(a, b)).toBeCloseTo(0.3, 10); // celldm(6) = cos(gamma)
    expect(cos(a, c)).toBeCloseTo(0.2, 10); // celldm(5) = cos(beta)
    expect(cos(b, c)).toBeCloseTo(0.1, 10); // celldm(4) = cos(alpha)
  });

  it('rejects parameters that make no lattice', () => {
    expect(latgen(4, dm(A))).toMatch(/celldm\(3\)/);
    expect(latgen(5, dm(A, 0, 0, 1.2))).toMatch(/celldm\(4\)/);
    expect(latgen(14, dm(A, 1, 1, 0.9, 0.9, -0.9))).toMatch(/cannot form a cell/);
    expect(latgen(2, dm(0))).toMatch(/celldm\(1\)/);
    expect(latgen(15, dm(A))).toMatch(/not a Bravais/);
  });
});
const B_ = 1.3;
const C_ = 1.7;

describe('abc2celldm', () => {
  it('converts Å and cosines like QE', () => {
    expect(abc2celldm(14, 5.4, 6.0, 7.0, 0.3, 0.2, 0.1)).toEqual([5.4 / BOHR, 6 / 5.4, 7 / 5.4, 0.1, 0.2, 0.3]);
    expect(abc2celldm(5, 5.4, 0, 0, 0.3, 0.5, 0.7).slice(3)).toEqual([0.3, 0, 0]);
    expect(abc2celldm(-12, 5.4, 6, 7, 0.3, 0.5, 0.7).slice(3)).toEqual([0, 0.5, 0]);
    expect(abc2celldm(1, 5.4, 0, 0, 0.3, 0.5, 0.7).slice(3)).toEqual([0, 0, 0]);
  });
});

const parse = (text: string) => parseQe(text, { cards: cardsOf('pw') });
const input = (system: string, cards: string) => `&CONTROL\n/\n&SYSTEM\n${system}\n/\n&ELECTRONS\n/\n${cards}`;

describe('qeStructure', () => {
  it('builds the cell and atoms of diamond Si (fcc, alat positions)', () => {
    const s = qeStructure(parse(input('ibrav = 2, celldm(1) = 10.26, nat = 2, ntyp = 1', 'ATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\nSi 0.25 0.25 0.25\n')))!;
    expect(s.volume).toBeCloseTo((10.26 * BOHR) ** 3 / 4, 8);
    expect(s.alat).toBe(10.26);
    expect(s.frac[1].map((x) => Number(x.toFixed(8)))).toEqual([-0.25, 0.75, -0.25]);
    expect(s.labels).toEqual(['Si', 'Si']);
  });

  it('reads crystal, bohr and angstrom positions to the same fractional coordinates', () => {
    const base = 'ibrav = 1, celldm(1) = 10, nat = 1, ntyp = 1';
    const at = (unit: string, xyz: string) => qeStructure(parse(input(base, `ATOMIC_SPECIES\nX 1 x.UPF\nATOMIC_POSITIONS ${unit}\nX ${xyz}\n`)))!.frac[0].map((x) => Number(x.toFixed(8)));
    expect(at('crystal', '0.5 0.25 0')).toEqual([0.5, 0.25, 0]);
    expect(at('alat', '0.5 0.25 0')).toEqual([0.5, 0.25, 0]);
    expect(at('bohr', '5 2.5 0')).toEqual([0.5, 0.25, 0]);
    expect(at('angstrom', `${5 * BOHR} ${2.5 * BOHR} 0`)).toEqual([0.5, 0.25, 0]);
  });

  it('builds the cell from CELL_PARAMETERS in all units', () => {
    const cell = (unit: string, rows: string, system = 'ibrav = 0, nat = 1, ntyp = 1') => qeCell(parse(input(system, `CELL_PARAMETERS ${unit}\n${rows}\nATOMIC_POSITIONS crystal\nX 0 0 0\n`)));
    const cubic = (x: number) => `${x} 0 0\n0 ${x} 0\n0 0 ${x}`;
    for (const c of [cell('angstrom', cubic(5)), cell('bohr', cubic(5 / BOHR)), cell('alat', cubic(1), 'ibrav = 0, celldm(1) = ' + 5 / BOHR + ', nat = 1, ntyp = 1'), cell('alat', cubic(1), 'ibrav = 0, A = 5, nat = 1, ntyp = 1')]) {
      expect(c && 'volume' in c && c.volume).toBeCloseTo(125, 6);
    }
    expect(cell('alat', cubic(1))).toBeUndefined(); // alat without a lattice parameter: not buildable
  });

  it('uses A, B, C and the cosines instead of celldm', () => {
    const c = qeCell(parse(input('ibrav = 8, A = 3, B = 4, C = 5, nat = 1, ntyp = 1', '')))!;
    expect('volume' in c && c.volume).toBeCloseTo(60, 6);
  });

  it('describes a cell', () => {
    const c = qeCell(parse(input('ibrav = 4, celldm(1) = 5, celldm(3) = 1.6, nat = 1, ntyp = 1', '')))! as Exclude<ReturnType<typeof qeCell>, undefined | { error: string }>;
    expect(describeCell(c.lattice, c.volume)).toMatch(/^a = 2\.646, b = 2\.646, c = 4\.233 Å · α = 90°, β = 90°, γ = 120°/);
  });

  it('says nothing when the cell or the atoms cannot be read', () => {
    expect(qeStructure(parse(input('nat = 1', 'ATOMIC_POSITIONS crystal\nX 0 0 0\n')))).toBeUndefined();
    expect(qeStructure(parse(input('ibrav = 1, celldm(1) = 5, nat = 1', '')))).toBeUndefined();
    expect(qeStructure(parse(input('ibrav = 1, celldm(1) = 5, nat = 1', 'ATOMIC_POSITIONS crystal_sg\nX 8a\n')))).toBeUndefined();
    expect(qeCell(parse(input('ibrav = 4, celldm(1) = 5, nat = 1', '')))).toEqual({ error: 'celldm(3) must be positive' });
  });
});
