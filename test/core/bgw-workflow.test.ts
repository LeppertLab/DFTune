import { describe, expect, it } from 'vitest';
import { parseBgw } from '../../src/core/bgw/parse';
import type { BgwProgram } from '../../src/core/bgw/tags';
import { validateBgw } from '../../src/core/bgw/validate';
import { bgwRunSuffix, pairBgwFiles } from '../../src/core/bgw/workflow';

const KPT = 'begin kpoints\n  0 0 0 1\nend\n';
const QPT = 'begin qpoints\n  0 0 0.001 1 1\nend\n';
const EPS = (extra = '') => `epsilon_cutoff 10.0\nnumber_bands 20\n${extra}\n${QPT}`;
const SIG = (extra = '') => `band_index_min 1\nband_index_max 8\n${extra}\n${KPT}`;
const nb = (program: BgwProgram, text: string, fileName = `${program}.inp`) => ({ program, fileName, doc: parseBgw(text) });
const codes = (program: BgwProgram, text: string, ...neighbors: ReturnType<typeof nb>[]) => validateBgw(parseBgw(text), program, { neighbors }).map((d) => d.code);

describe('workflow: epsilon ↔ sigma', () => {
  it('accepts the usual GPP pair', () => {
    expect(codes('sigma', SIG(), nb('epsilon', EPS()))).toEqual([]);
    expect(codes('epsilon', EPS(), nb('sigma', SIG()))).toEqual([]);
  });
  it('refuses a screened cutoff above the epsilon cutoff, on both sides', () => {
    expect(codes('sigma', SIG('screened_coulomb_cutoff 20'), nb('epsilon', EPS()))).toEqual(['bgw-wf-cutoff']);
    expect(codes('epsilon', EPS(), nb('sigma', SIG('screened_coulomb_cutoff 20')))).toEqual(['bgw-wf-cutoff']);
    expect(codes('sigma', SIG('screened_coulomb_cutoff 8'), nb('epsilon', EPS()))).toEqual([]);
  });
  it('wants the dielectric matrix that goes with the frequency dependence', () => {
    expect(codes('sigma', SIG('frequency_dependence 2'), nb('epsilon', EPS()))).toEqual(['bgw-wf-frequency']);
    expect(codes('sigma', SIG('frequency_dependence 2'), nb('epsilon', EPS('frequency_dependence 2')))).toEqual([]);
    expect(codes('epsilon', EPS('frequency_dependence 2'), nb('sigma', SIG()))).toEqual(['bgw-wf-frequency']);
    expect(codes('sigma', SIG('frequency_dependence 0'), nb('epsilon', EPS()))).toEqual([]);
  });
});

describe('workflow: kernel ↔ absorption', () => {
  const KER = (extra = '') => `number_val_bands 3\nnumber_cond_bands 3\n${extra}\n`;
  const ABS = (extra = '') => `number_val_bands_coarse 3\nnumber_cond_bands_coarse 3\nnumber_val_bands_fine 2\nnumber_cond_bands_fine 2\nuse_momentum\npolarization 1 0 0\nenergy_resolution 0.1\n${extra}\n`;
  it('accepts a matching pair', () => {
    expect(codes('absorption', ABS(), nb('kernel', KER()))).toEqual([]);
  });
  it('wants the same coarse bands', () => {
    expect(codes('absorption', ABS().replace('number_cond_bands_coarse 3', 'number_cond_bands_coarse 4'), nb('kernel', KER()))).toEqual(['bgw-wf-bands']);
    expect(codes('kernel', KER(), nb('absorption', ABS().replace('number_val_bands_coarse 3', 'number_val_bands_coarse 2')))).toEqual(['bgw-wf-bands']);
  });
  it('wants the same symmetry flag, extended kernel and Q shift', () => {
    expect(codes('absorption', ABS('use_symmetries_coarse_grid'), nb('kernel', KER('no_symmetries_coarse_grid')))).toEqual(['bgw-wf-symmetry']);
    expect(codes('absorption', ABS('use_symmetries_coarse_grid'), nb('kernel', KER('use_symmetries_coarse_grid')))).toEqual([]);
    expect(codes('absorption', ABS('extended_kernel'), nb('kernel', KER()))).toEqual(['bgw-wf-extended']);
    expect(codes('absorption', ABS('full_bse'), nb('kernel', KER('extended_kernel')))).toEqual([]);
    expect(codes('absorption', ABS('exciton_Q_shift 0 0.1 0 0'), nb('kernel', KER('exciton_Q_shift 0 0.2 0 0')))).toEqual(['bgw-wf-qshift']);
  });
});

describe('pairing files in a folder', () => {
  it('names the run by what follows the program prefix', () => {
    expect(bgwRunSuffix('eps_cd.inp')).toBe('cd');
    expect(bgwRunSuffix('sig_cd.inp')).toBe('cd');
    expect(bgwRunSuffix('epsilon.inp')).toBe('');
  });
  it('pairs by run suffix, or the only candidate when each program has one file', () => {
    expect(pairBgwFiles('sig_cd.inp', ['eps_ff.inp', 'eps_cd.inp', 'sig_cd.inp', 'sig_ff.inp'])).toEqual({ epsilon: 'eps_cd.inp' });
    expect(pairBgwFiles('sigma.inp', ['epsilon.inp', 'sigma.inp', 'kernel.inp'])).toEqual({ epsilon: 'epsilon.inp', kernel: 'kernel.inp' });
    // several runs of each: nothing says which goes with which
    expect(pairBgwFiles('sigma.inp', ['eps_a.inp', 'eps_b.inp', 'sigma.inp'])).toEqual({});
    expect(pairBgwFiles('sigma.inp', ['epsilon_a.inp', 'sigma.inp', 'sig_b.inp'])).toEqual({});
  });
});
