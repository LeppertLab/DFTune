import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQe } from '../../src/core/qe/parse';
import { cardsOf } from '../../src/core/qe/tags';
import { validateQe } from '../../src/core/qe/validate';

const check = (text: string) => validateQe(parseQe(text, { cards: cardsOf('pw') }), 'pw');
const codes = (text: string) => check(text).map((d) => d.code);
const apply = (text: string, code: string) => {
  const d = check(text).find((x) => x.code === code);
  expect(d?.fix, `${code} has a fix`).toBeDefined();
  return text.slice(0, d!.fix!.edit.start) + d!.fix!.edit.text + text.slice(d!.fix!.edit.end);
};

interface Parts { control?: string; system?: string; electrons?: string; ions?: string; cell?: string; cards?: string }
/** A complete, valid input (2-atom Si) with parts replaced. */
const make = (p: Parts = {}) => {
  const cards = p.cards ?? 'ATOMIC_SPECIES\nSi 28.08 Si.UPF\nATOMIC_POSITIONS {alat}\nSi 0 0 0\nSi 0.25 0.25 0.25\nK_POINTS {automatic}\n4 4 4 0 0 0\n';
  return (
    `&CONTROL\n${p.control ?? "calculation = 'scf'"}\n/\n` +
    `&SYSTEM\n${p.system ?? 'ibrav = 2, celldm(1) = 10.2, nat = 2, ntyp = 1, ecutwfc = 25'}\n/\n` +
    `&ELECTRONS\n${p.electrons ?? ''}\n/\n` +
    (p.ions !== undefined ? `&IONS\n${p.ions}\n/\n` : '') +
    (p.cell !== undefined ? `&CELL\n${p.cell}\n/\n` : '') +
    cards
  );
};

describe('line endings and tabs', () => {
  it('warns about CRLF and tabs, with fixes', () => {
    const crlf = make().replace(/\n/g, '\r\n');
    expect(codes(crlf)).toEqual(['qe-crlf']);
    expect(codes(apply(crlf, 'qe-crlf'))).toEqual([]);
    const tabbed = make({ electrons: '\tmixing_beta = 0.5' });
    expect(codes(tabbed)).toEqual(['qe-tab']);
    expect(codes(apply(tabbed, 'qe-tab'))).toEqual([]);
  });
});

describe('pw.x rules', () => {
  it('accepts a complete input', () => {
    expect(check(make())).toEqual([]);
    for (const f of ['si.scf.in', 'fe.relax.in', 'bands.in']) {
      expect(check(readFileSync(join(__dirname, '..', 'fixtures', 'qe', f), 'utf8')).filter((d) => d.severity !== 'info'), f).toEqual([]);
    }
  });

  describe('namelists for the calculation', () => {
    it('needs &IONS for relax and md, and &CELL for the vc calculations', () => {
      expect(codes(make({ control: "calculation = 'relax'" }))).toEqual(['qe-ions-missing']);
      expect(codes(make({ control: "calculation = 'md'" }))).toEqual(['qe-ions-missing']);
      expect(codes(make({ control: "calculation = 'vc-relax'", ions: '' }))).toEqual(['qe-cell-missing-namelist']);
      expect(codes(make({ control: "calculation = 'vc-relax'", ions: '', cell: '' }))).toEqual([]);
      expect(codes(make({ control: "calculation = 'relax'", ions: '' }))).toEqual([]);
    });

    it('does not need them for scf, nscf and bands; notes when they are ignored', () => {
      expect(codes(make({ ions: '' }))).toEqual([]);
      expect(codes(make({ control: "calculation = 'nscf'", ions: '' }))).toEqual(['qe-ignored-namelist']);
      expect(codes(make({ control: "calculation = 'relax'", ions: '', cell: '' }))).toEqual(['qe-ignored-namelist']);
    });

    it('offers to add the missing namelist', () => {
      const fixed = apply(make({ control: "calculation = 'relax'" }), 'qe-ions-missing');
      expect(fixed).toContain('&ELECTRONS\n\n/\n&IONS\n/\n');
      expect(codes(fixed)).toEqual([]);
      const vc = apply(make({ control: "calculation = 'vc-relax'", ions: '' }), 'qe-cell-missing-namelist');
      expect(codes(vc)).toEqual([]);
    });
  });

  describe('the cell', () => {
    it('ties ibrav = 0 to CELL_PARAMETERS', () => {
      const cell = 'CELL_PARAMETERS {angstrom}\n5 0 0\n0 5 0\n0 0 5\n';
      expect(codes(make({ system: 'ibrav = 0, nat = 2, ntyp = 1, ecutwfc = 25' }))).toEqual(['qe-cell-card-missing']);
      expect(codes(make({ system: 'ibrav = 0, nat = 2, ntyp = 1, ecutwfc = 25', cards: make().split('ATOMIC_SPECIES')[1].replace(/^/, 'ATOMIC_SPECIES') + cell }))).toEqual([]);
      expect(codes(make({ cards: make().split('&ELECTRONS')[1].split('/\n')[1] + cell.replace('{angstrom}', '{alat}') }))).toEqual(['qe-cell-card-redundant']);
    });

    it('needs the lattice parameter and the right celldm for ibrav', () => {
      expect(codes(make({ system: 'ibrav = 2, nat = 2, ntyp = 1, ecutwfc = 25' }))).toEqual(['qe-lattice-parameter']);
      expect(codes(make({ system: 'ibrav = 2, A = 5.4, nat = 2, ntyp = 1, ecutwfc = 25' }))).toEqual([]);
      expect(codes(make({ system: 'ibrav = 4, celldm(1) = 5, nat = 2, ntyp = 1, ecutwfc = 25' }))).toEqual(['qe-celldm-missing']);
      expect(codes(make({ system: 'ibrav = 4, celldm(1) = 5, celldm(3) = 1.6, nat = 2, ntyp = 1, ecutwfc = 25' }))).toEqual([]);
      expect(codes(make({ system: 'ibrav = -12, celldm(1) = 5, celldm(2) = 1, celldm(3) = 1, celldm(5) = 0.1, nat = 2, ntyp = 1, ecutwfc = 25' }))).toEqual([]);
      expect(codes(make({ system: 'ibrav = 15, celldm(1) = 5, nat = 2, ntyp = 1, ecutwfc = 25' }))).toEqual(['qe-ibrav']);
    });

    it('rejects celldm together with A, B, C', () => {
      expect(codes(make({ system: 'ibrav = 1, celldm(1) = 5, A = 2.6, nat = 2, ntyp = 1, ecutwfc = 25' }))).toContain('qe-celldm-and-abc');
    });

    it('checks the units of CELL_PARAMETERS against the lattice parameter', () => {
      const withCell = (unit: string, system: string) => make({ system, cards: make().split('&ELECTRONS')[1].split('/\n')[1] + `CELL_PARAMETERS ${unit}\n5 0 0\n0 5 0\n0 0 5\n` });
      const sys0 = 'ibrav = 0, nat = 2, ntyp = 1, ecutwfc = 25';
      expect(codes(withCell('{bohr}', sys0))).toEqual([]);
      expect(codes(withCell('{bohr}', sys0 + ', celldm(1) = 10'))).toEqual(['qe-lattice-twice']);
      expect(codes(withCell('{alat}', sys0))).toEqual(['qe-lattice-parameter']);
      expect(codes(withCell('{alat}', sys0 + ', celldm(1) = 10'))).toEqual([]);
      expect(codes(withCell('', sys0 + ', celldm(1) = 10'))).toEqual(['qe-units-missing']);
      expect(codes(withCell('{furlongs}', sys0))).toEqual(['qe-card-option']);
    });
  });

  describe('species and positions', () => {
    const cards = (species: string, positions: string, kp = 'K_POINTS {gamma}\n') => `ATOMIC_SPECIES\n${species}\nATOMIC_POSITIONS ${positions}\n${kp}`;
    it('compares nat and ntyp with the cards', () => {
      expect(codes(make({ cards: cards('Si 28 Si.UPF', '{alat}\nSi 0 0 0') }))).toEqual(['qe-nat']);
      expect(codes(make({ cards: cards('Si 28 Si.UPF\nGe 72 Ge.UPF', '{alat}\nSi 0 0 0\nSi 1 1 1') }))).toEqual(['qe-ntyp']);
      expect(codes(make({ system: 'ibrav = 2, celldm(1) = 10, nat = 2, ntyp = 1, ecutwfc = 25, space_group = 227', cards: cards('Si 28 Si.UPF', '{crystal_sg}\nSi 8a') }))).toEqual([]);
    });

    it('checks the lines of the cards', () => {
      expect(codes(make({ cards: cards('Si 28', '{alat}\nSi 0 0 0\nSi 1 1 1') }))).toEqual(['qe-card-line']);
      expect(codes(make({ cards: cards('Si abc Si.UPF', '{alat}\nSi 0 0 0\nSi 1 1 1') }))).toEqual(['qe-card-line']);
      expect(codes(make({ cards: cards('Si 28 Si.UPF', '{alat}\nSi 0 0\nSi 1 1 1') }))).toEqual(['qe-card-line']);
      expect(codes(make({ cards: cards('Si 28 Si.UPF', '{alat}\nSi 0 0 0 1\nSi 1 1 1') }))).toEqual(['qe-card-line']);
      expect(codes(make({ cards: cards('Si 28 Si.UPF', '{alat}\nSi 0 0 0 0 1 1\nSi 1 1 1 1 1 1') }))).toEqual([]);
    });

    it('checks species labels (case-sensitive) and units', () => {
      const wrongCase = check(make({ cards: cards('Si 28 Si.UPF', '{alat}\nSi 0 0 0\nsi 1 1 1') })).find((d) => d.code === 'qe-species-label')!;
      expect(wrongCase.message).toMatch(/case-sensitive: Si/);
      expect(wrongCase.fix?.edit.text).toBe('Si');
      expect(codes(make({ cards: cards('Si 28 Si.UPF', '{alat}\nSi 0 0 0\nGe 1 1 1') }))).toEqual(['qe-species-label']);
      expect(codes(make({ cards: cards('Si 28 Si.UPF', '\nSi 0 0 0\nSi 1 1 1') }))).toEqual(['qe-units-missing']);
      expect(codes(make({ cards: cards('Si 28 Si.UPF', '{inches}\nSi 0 0 0\nSi 1 1 1') }))).toEqual(['qe-card-option']);
    });
  });

  describe('k points', () => {
    const kp = (card: string) => make({ cards: `ATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS {alat}\nSi 0 0 0\nSi 1 1 1\n${card}` });
    it('checks the automatic grid', () => {
      expect(codes(kp('K_POINTS {automatic}\n4 4 4 0 0 0\n'))).toEqual([]);
      expect(codes(kp('K_POINTS {automatic}\n4 4 4\n'))).toEqual(['qe-card-line']);
      expect(codes(kp('K_POINTS {automatic}\n4 4 4 0 0 2\n'))).toEqual(['qe-kpoints']);
      expect(codes(kp('K_POINTS {automatic}\n4 0 4 0 0 0\n'))).toEqual(['qe-kpoints']);
      expect(codes(kp('K_POINTS {gamma}\n'))).toEqual([]);
      expect(codes(kp('K_POINTS {mesh}\n4 4 4 0 0 0\n'))).toEqual(['qe-card-option']);
    });

    it('checks lists, with BZ labels for band paths', () => {
      expect(codes(kp('K_POINTS {crystal}\n2\n0 0 0 1\n0.5 0 0 1\n'))).toEqual([]);
      expect(codes(kp('K_POINTS {crystal}\n3\n0 0 0 1\n0.5 0 0 1\n'))).toEqual(['qe-kpoints']);
      expect(codes(kp('K_POINTS {crystal}\n1\n0 0 0 1\n0.5 0 0 1\n'))).toEqual(['qe-kpoints']);
      expect(codes(kp('K_POINTS {crystal}\n1\n0 0\n'))).toEqual(['qe-card-line']);
      expect(codes(kp('K_POINTS {tpiba_b}\n2\ngG 20\nX 1\n'))).toEqual([]);
      expect(codes(kp('K_POINTS {tpiba}\n1\ngG 20\n'))).toEqual(['qe-card-line']);
      expect(codes(kp('K_POINTS {tpiba_c}\n2\n0 0 0 1\n1 0 0 1\n'))).toEqual(['qe-kpoints']);
    });
  });

  describe('electrons and occupations', () => {
    const sys = (extra: string) => `ibrav = 2, celldm(1) = 10.2, nat = 2, ntyp = 1, ecutwfc = 25, ${extra}`;
    it('stops a spin-polarized run without occupations (setup.f90)', () => {
      expect(codes(make({ system: sys('nspin = 2, starting_magnetization(1) = 0.5') }))).toEqual(['qe-spin-occupations']);
      expect(codes(make({ system: sys("nspin = 2, starting_magnetization(1) = 0.5, occupations = 'smearing', degauss = 0.02") }))).toEqual([]);
      expect(codes(make({ system: sys('nspin = 2, starting_magnetization(1) = 0.5, tot_magnetization = 2') }))).toEqual([]);
      expect(codes(make({ control: "calculation = 'nscf'", system: sys('nspin = 2, starting_magnetization(1) = 0.5'), ions: undefined }))).toEqual([]);
      const fixed = apply(make({ system: sys('nspin = 2, starting_magnetization(1) = 0.5') }), 'qe-spin-occupations');
      expect(codes(fixed)).toEqual([]);
      expect(fixed).toMatch(/occupations = 'smearing'\n\s+smearing = 'mv'\n\s+degauss = 0\.02\n\//);
    });

    it('replaces fixed occupations when fixing', () => {
      const fixed = apply(make({ system: sys("nspin = 2, starting_magnetization(1) = 0.5, occupations = 'fixed'") }), 'qe-spin-occupations');
      expect(codes(fixed)).toEqual([]);
      expect(fixed).not.toContain("'fixed'");
    });

    it('requires degauss for smearing, and says when it is ignored', () => {
      expect(codes(make({ system: sys("occupations = 'smearing'") }))).toEqual(['qe-degauss']);
      expect(apply(make({ system: sys("occupations = 'smearing'") }), 'qe-degauss')).toContain('degauss = 0.02');
      expect(codes(make({ system: sys("occupations = 'smearing', degauss = 0") }))).toEqual(['qe-degauss']);
      expect(codes(make({ system: sys("occupations = 'fixed', degauss = 0.02") }))).toEqual(['qe-degauss-ignored']);
      expect(codes(make({ system: sys('degauss = 0.02') }))).toEqual(['qe-degauss-ignored']);
    });

    it('needs an automatic grid for tetrahedra', () => {
      const list = 'ATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS {alat}\nSi 0 0 0\nSi 1 1 1\nK_POINTS {crystal}\n1\n0 0 0 1\n';
      expect(codes(make({ system: sys("occupations = 'tetrahedra_opt'"), cards: list }))).toEqual(['qe-tetra-kpoints']);
      expect(codes(make({ system: sys("occupations = 'tetrahedra_opt'") }))).toEqual([]);
    });

    it('checks ecutrho against ecutwfc as QE does', () => {
      expect(codes(make({ system: sys('ecutrho = 20') }))).toEqual(['qe-ecutrho']);
      expect(check(make({ system: sys('ecutrho = 25') })).find((d) => d.code === 'qe-ecutrho')?.severity).toBe('error');
      expect(check(make({ system: sys('ecutrho = 60') })).find((d) => d.code === 'qe-ecutrho')?.severity).toBe('warning');
      expect(codes(make({ system: sys('ecutrho = 100') }))).toEqual([]);
    });

    it('notes magnetization mistakes', () => {
      expect(codes(make({ system: sys("nspin = 2, occupations = 'smearing', degauss = 0.01") }))).toEqual(['qe-no-magnetization']);
      expect(codes(make({ system: sys('starting_magnetization(1) = 0.5') }))).toEqual(['qe-magnetization-ignored']);
      expect(codes(make({ system: sys('nspin = 4') }))).toContain('qe-nspin4');
    });

    it('ties the OCCUPATIONS card to occupations = from_input', () => {
      expect(codes(make({ system: sys("occupations = 'from_input'") }))).toEqual(['qe-card-missing']);
      expect(codes(make({ cards: make().split('&ELECTRONS')[1].split('/\n')[1] + 'OCCUPATIONS\n2 2\n' }))).toEqual(['qe-card-ignored']);
    });
  });
});
