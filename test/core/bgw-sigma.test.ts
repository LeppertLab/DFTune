import { describe, expect, it } from 'vitest';
import { parseBgw } from '../../src/core/bgw/parse';
import { validateBgw } from '../../src/core/bgw/validate';

const KPT = 'begin kpoints\n  0.0 0.0 0.0 1.0\nend\n';
const BASE = 'band_index_min 1\nband_index_max 8\n' + KPT;
const check = (text: string) => validateBgw(parseBgw(text), 'sigma');
const codes = (text: string) => check(text).map((d) => d.code);
const HF_BLOCK = 'begin qpoints\n  0.0 0.0 0.0 1.0 1\n  0.5 0.0 0.0 1.0 0\nend\n';

describe('sigma.inp', () => {
  it('accepts a plain GPP calculation', () => {
    expect(codes(BASE)).toEqual([]);
  });

  it('checks the frequency dependence', () => {
    expect(codes(BASE + 'frequency_dependence 4')).toContain('bgw-sig-frequency');
    expect(codes(BASE + 'frequency_dependence 2\nfrequency_dependence_method 1')).toContain('bgw-sig-frequency');
    expect(codes(BASE + 'frequency_dependence 2\ncd_integration_method 1')).toContain('bgw-sig-frequency');
    expect(codes(BASE + 'frequency_dependence 2\ncd_integration_method 2')).toEqual([]);
  });

  it('needs q-points, a grid and a q→0 point for Hartree–Fock', () => {
    expect(codes(BASE + 'frequency_dependence -1\n')).toEqual(['bgw-sig-hf', 'bgw-sig-hf']);
    expect(codes(BASE + 'frequency_dependence -1\nqgrid 4 4 4\n' + HF_BLOCK)).toEqual([]);
    expect(codes(BASE + 'frequency_dependence -1\nqgrid 4 4 4\nbegin qpoints\n  0.5 0.0 0.0 1.0 0\nend\n')).toEqual(['bgw-sig-hf']);
  });

  it('warns about a qpoints block outside Hartree–Fock', () => {
    const d = check(BASE + HF_BLOCK);
    expect(d.map((x) => x.code)).toEqual(['bgw-sig-qpoints']);
    expect(d[0].severity).toBe('warning');
  });

  it('ties occ_broadening to contour deformation and an absolute Fermi level', () => {
    expect(codes(BASE + 'occ_broadening 0.01')).toEqual(['bgw-sig-fermi', 'bgw-sig-fermi']);
    expect(codes(BASE + 'frequency_dependence 2\nfermi_level_absolute\nocc_broadening 0.01')).toEqual([]);
  });

  it('wants bands', () => {
    expect(codes(KPT)).toContain('bgw-required');
    expect(codes(KPT + 'begin diag\n  1\n  2\nend\nnumber_diag 2')).toEqual([]);
    expect(codes(KPT + 'begin diag\n  1\nend\nnumber_diag 3')).toContain('bgw-sig-bands');
  });

  it('checks sigma_matrix', () => {
    expect(codes(BASE + 'sigma_matrix -1 0')).toEqual([]);
    expect(codes(BASE + 'sigma_matrix -3 0')).toEqual(['bgw-sig-matrix']);
    expect(codes(BASE + 'sigma_matrix 0 2')).toEqual(['bgw-sig-matrix']);
    expect(codes(BASE + 'sigma_matrix 12 0')).toEqual(['bgw-sig-matrix']);
  });

  it('checks the small ranges', () => {
    expect(codes(BASE + 'exact_static_ch 2')).toEqual(['bgw-sig-range']);
    expect(codes(BASE + 'full_ch_conv_log 2')).toEqual(['bgw-sig-range']);
    expect(codes(BASE + 'spin_index_min 2\nspin_index_max 1')).toEqual(['bgw-sig-range']);
    expect(codes(BASE + 'frequency_grid_shift 3')).toEqual(['bgw-sig-range']);
    expect(codes(BASE + 'number_frequency_eval 11')).toEqual(['bgw-sig-range']);
    expect(codes(BASE + 'number_frequency_eval 11\nfrequency_grid_shift 1')).toEqual([]);
  });

  it('wants no_symmetries_q_grid with dont_symmetrize', () => {
    expect(codes(BASE + 'dont_symmetrize')).toEqual(['bgw-sig-symmetry']);
    expect(codes(BASE + 'dont_symmetrize\nno_symmetries_q_grid')).toEqual([]);
  });

  it('warns about deprecated keywords', () => {
    expect(codes(BASE + 'number_kpoints 1')).toEqual(['bgw-deprecated']);
  });
});

describe('sigma.inp: cutoffs and band sums', () => {
  it('refuses a screened cutoff above the bare cutoff', () => {
    expect(codes(BASE + 'screened_coulomb_cutoff 20\nbare_coulomb_cutoff 30')).toEqual([]);
    expect(codes(BASE + 'screened_coulomb_cutoff 40\nbare_coulomb_cutoff 30')).toEqual(['bgw-sig-cutoff']);
  });
  it('refuses computing bands beyond number_bands', () => {
    expect(codes(BASE + 'number_bands 8')).toEqual([]);
    expect(codes(BASE + 'number_bands 6')).toEqual(['bgw-sig-bands']);
    expect(codes(BASE + 'number_bands 6\nfor_EXX')).toEqual([]);
  });
});
