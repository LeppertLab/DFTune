import { describe, expect, it } from 'vitest';
import { parseBgw } from '../../src/core/bgw/parse';
import { validateBgw } from '../../src/core/bgw/validate';

const EPS = 'epsilon_cutoff 10.0\nnumber_bands 20\n\nbegin qpoints\n  0.0 0.0 0.001 1.0 1\n  0.0 0.0 0.5 1.0 0\nend\n';
const check = (extra: string, base = EPS) => validateBgw(parseBgw(extra ? base.replace('\nbegin', `${extra}\nbegin`) : base), 'epsilon');
const codes = (extra: string, base = EPS) => check(extra, base).map((d) => d.code);

describe('epsilon.inp: frequency dependence', () => {
  it('accepts static, full-frequency and Godby–Needs', () => {
    expect(codes('frequency_dependence 0')).toEqual([]);
    expect(codes('frequency_dependence 2\nfrequency_dependence_method 2\nnumber_imaginary_freqs 15')).toEqual([]);
    expect(codes('frequency_dependence 3\nimaginary_frequency 2.0')).toEqual([]);
  });

  it('stops on other values', () => {
    expect(check('frequency_dependence 1').map((d) => d.code)).toContain('bgw-eps-frequency');
    expect(check('frequency_dependence 1').find((d) => d.code === 'bgw-eps-frequency')?.severity).toBe('error');
    expect(codes('frequency_dependence 2\nfrequency_dependence_method 3')).toContain('bgw-eps-frequency');
  });

  it('needs a nonzero delta_frequency for full frequency', () => {
    expect(codes('frequency_dependence 2\ndelta_frequency 0.0')).toEqual(['bgw-eps-delta']);
    expect(codes('frequency_dependence 2\ndelta_frequency 0.1')).toEqual([]);
    expect(codes('delta_frequency 0.0')).toEqual([]); // not used without full frequency
  });
});

describe('epsilon.inp: partial occupations', () => {
  it('needs fermi_level_absolute, the last of the two switches winning', () => {
    expect(codes('occ_broadening 0.1')).toEqual(['bgw-eps-fermi']);
    expect(codes('occ_broadening 0.1\nfermi_level_absolute\nfermi_level 5.0')).toEqual([]);
    expect(codes('occ_broadening 0.1\nfermi_level_absolute\nfermi_level_relative')).toEqual(['bgw-eps-fermi']);
    expect(codes('occ_broadening 0.1\nfermi_level_relative\nfermi_level_absolute')).toEqual([]);
    expect(codes('fermi_level_relative')).toEqual([]);
  });
});

describe('epsilon.inp: other combinations', () => {
  it('refuses skip_epsilon with skip_chi', () => {
    expect(codes('skip_epsilon')).toEqual([]);
    expect(codes('skip_epsilon\nskip_chi')).toEqual(['bgw-eps-skip']);
  });

  it('checks ranges', () => {
    expect(codes('full_chi_conv_log 3')).toContain('bgw-eps-range');
    expect(codes('full_chi_conv_log -1')).toEqual([]);
  });

  it('warns about number_qpoints, which is deprecated', () => {
    expect(check('number_qpoints 2').map((d) => `${d.code}:${d.severity}`)).toEqual(['bgw-deprecated:warning']);
  });
});

describe('epsilon.inp: q-points', () => {
  const qs = (rows: string, extra = '') => `epsilon_cutoff 10.0\n${extra}begin qpoints\n${rows}end\n`;
  it('allows one q→0 point', () => {
    expect(validateBgw(parseBgw(qs('  0 0 0.001 1 1\n  0 0 0.5 1 0\n')), 'epsilon')).toEqual([]);
    expect(validateBgw(parseBgw(qs('  0 0 0 1 0\n  0 0 0.5 1 0\n')), 'epsilon')).toEqual([]);
  });

  it('stops on several q→0 points, unless subsampling, and on mixed values', () => {
    const two = qs('  0 0 0.001 1 1\n  0 0 0.002 1 1\n');
    expect(validateBgw(parseBgw(two), 'epsilon').map((d) => d.code)).toEqual(['bgw-eps-q0']);
    expect(validateBgw(parseBgw(qs('  0 0 0.001 1 1\n  0 0 0.002 1 1\n', 'subsample\n')), 'epsilon')).toEqual([]);
    const mixed = qs('  0 0 0.001 1 1\n  0 0 0.002 1 2\n', 'subsample\n');
    expect(validateBgw(parseBgw(mixed), 'epsilon').map((d) => d.code)).toEqual(['bgw-eps-q0']);
  });

  it('wants a nonnegative weight for do_rpa', () => {
    const rpa = (w: string) => `epsilon_cutoff 10.0\ndo_rpa\nbegin qpoints\n  0 0 0.001 1 1 ${w}\nend\n`;
    expect(validateBgw(parseBgw(rpa('0.5')), 'epsilon')).toEqual([]);
    expect(validateBgw(parseBgw(rpa('-0.5')), 'epsilon').map((d) => d.code)).toEqual(['bgw-eps-rpa']);
  });
});
