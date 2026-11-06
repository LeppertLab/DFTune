import { describe, expect, it } from 'vitest';
import { detectProgram, parseQe } from '../../src/core';
import { cardsOf, type QeProgram } from '../../src/core/qe/tags';
import { validateQe } from '../../src/core/qe/validate';

const parse = (t: string, program: QeProgram) => parseQe(t, { cards: cardsOf(program) });
const codes = (body: string, pw?: string) => {
  const text = `&INPUT_PW2BGW\n  prefix = 'si'\n${body}\n/\n`;
  return validateQe(parse(text, 'pw2bgw'), 'pw2bgw', { pw: pw ? parse(pw, 'pw') : undefined }).map((d) => d.code);
};
const PW = (calc = 'bands', kpoints = 'K_POINTS crystal\n1\n0 0 0 1\n', system = '') =>
  `&CONTROL\ncalculation = '${calc}'\nprefix = 'si'\noutdir = './'\n/\n&SYSTEM\nibrav = 2, celldm(1) = 10.2, nat = 1, ntyp = 1, ecutwfc = 25${system}\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\n${kpoints}`;

describe('pw2bgw.x', () => {
  it('is recognized by its namelist', () => {
    expect(detectProgram("&input_pw2bgw\n prefix='x'\n/")).toBe('pw2bgw');
    expect(detectProgram("&INPUTPP\n/")).toBe('pp');
  });

  it('accepts a normal conversion', () => {
    expect(codes('  wfng_flag = .true.\n  wfng_file = \'WFN\'\n  real_or_complex = 2\n  symm_type = \'cubic\'')).toEqual([]);
    expect(codes('  vxc_flag = .true.\n  vxc_diag_nmin = 1\n  vxc_diag_nmax = 20\n  kih_flag = .false.')).toEqual([]);
  });

  it('knows the variables that only the source declares', () => {
    expect(codes('  kih_flag = .true.\n  vxc_diag_nmax = 10')).toEqual([]);
    expect(codes('  wfng_flag = .true.\n  exx_flag = .true.')).toEqual(['qe-unknown-variable']);
  });

  it('wants a prefix', () => {
    const d = validateQe(parse('&INPUT_PW2BGW\n wfng_flag = .true.\n/\n', 'pw2bgw'), 'pw2bgw');
    expect(d.map((x) => x.code)).toEqual(['qe-required']);
  });

  it('checks the values the program refuses', () => {
    expect(codes('  wfng_flag = .true.\n  real_or_complex = 3')).toEqual(['qe-bgw-value']);
    expect(codes("  wfng_flag = .true.\n  symm_type = 'tetragonal'")).toEqual(['qe-option']);
    expect(codes("  vxc_flag = .true.\n  vxc_diag_nmax = 5\n  vxc_integral = 'x'")).toEqual(['qe-bgw-value']);
    expect(codes("  wfng_flag = .true.\n  symm_type = 'Hexagonal'")).toEqual([]);
  });

  it('checks the k-grid and band ranges', () => {
    expect(codes('  wfng_flag = .true.\n  wfng_kgrid = .true.\n  wfng_nk1 = 4\n  wfng_nk2 = 4')).toEqual(['qe-bgw-kgrid']);
    expect(codes('  wfng_flag = .true.\n  wfng_kgrid = .true.\n  wfng_nk1 = 4\n  wfng_nk2 = 4\n  wfng_nk3 = 4')).toEqual([]);
    expect(codes('  vxc_flag = .true.\n  vxc_diag_nmin = 20\n  vxc_diag_nmax = 5')).toEqual(['qe-bgw-range']);
    expect(codes('  vxc_flag = .true.\n  real_or_complex = 1\n  vxc_diag_nmax = 8\n  vxc_offdiag_nmin = 1\n  vxc_offdiag_nmax = 8')).toEqual(['qe-bgw-real-offdiag']);
    expect(codes('  vxc_flag = .true.')).toEqual(['qe-bgw-range']);
  });

  it('warns when nothing is requested', () => {
    expect(codes('')).toEqual(['qe-bgw-nothing']);
  });

  it('is checked against the pw.x input', () => {
    const on = '  wfng_flag = .true.';
    expect(codes(on, PW())).toEqual([]);
    expect(codes(on, PW('bands', 'K_POINTS gamma\n'))).toEqual(['qe-bgw-gamma']);
    expect(codes(on, PW('scf'))).toEqual(['qe-bgw-scf']);
    expect(codes(on + '\n  real_or_complex = 1', PW('bands', undefined, ', noncolin = .true.'))).toContain('qe-bgw-real-spinor');
    expect(codes('  vxc_flag = .true.\n  vxc_diag_nmax = 30', PW('bands', undefined, ', nbnd = 20'))).toEqual(['qe-bgw-range']);
  });
});
