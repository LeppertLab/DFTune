import { describe, expect, it } from 'vitest';
import { parseBgw } from '../../src/core/bgw/parse';
import { validateBgw } from '../../src/core/bgw/validate';

const BANDS = 'number_val_bands_fine 2\nnumber_val_bands_coarse 2\nnumber_cond_bands_fine 2\nnumber_cond_bands_coarse 2\n';
const ABS = BANDS + 'use_momentum\npolarization 1 0 0\nenergy_resolution 0.1\n';
const abs = (extra = '', base = ABS) => validateBgw(parseBgw(base + extra + '\n'), 'absorption').map((d) => d.code);

describe('absorption.inp', () => {
  it('accepts a plain run', () => {
    expect(abs()).toEqual([]);
  });
  it('needs an operator and a broadening', () => {
    expect(abs('', BANDS + 'energy_resolution 0.1\n')).toEqual(['bgw-bse-operator']);
    expect(abs('', BANDS + 'use_dos\nenergy_resolution 0.1\n')).toEqual([]);
    expect(abs('', BANDS + 'use_dos\n')).toEqual(['bgw-required']);
    expect(abs('', BANDS + 'use_dos\nenergy_resolution 0\n')).toEqual(['bgw-bse-broadening']);
  });
  it('wants a polarization for the momentum operator with Haydock', () => {
    expect(abs('haydock\nnumber_iterations 50', BANDS + 'use_momentum\nenergy_resolution 0.1\n')).toEqual(['bgw-bse-polarization']);
    expect(abs('polarization 0 0 0', BANDS + 'use_momentum\nenergy_resolution 0.1\n')).toEqual(['bgw-bse-polarization']);
  });
  it('checks the bands, iterations and PRIMME', () => {
    expect(abs('', ABS.replace('number_val_bands_fine 2', 'number_val_bands_fine 3'))).toEqual(['bgw-bse-bands']);
    expect(abs('lanczos\nnumber_iterations 0')).toEqual(['bgw-bse-iterations']);
    expect(abs('diagonalization_primme')).toEqual(['bgw-bse-primme']);
  });
  it('checks interpolation and quasiparticle corrections', () => {
    expect(abs('skip_interpolation\neqp_co_corrections')).toEqual(['bgw-bse-interp']);
    expect(abs('read_dtmat\neqp_co_corrections')).toEqual(['bgw-bse-interp']);
    expect(abs('use_velocity\nskip_interpolation')).toContain('bgw-bse-interp');
    expect(abs('fermi_level_absolute\nfermi_level 5.0\neqp_corrections')).toEqual(['bgw-bse-fermi']);
    expect(abs('fermi_level_absolute\nfermi_level 5.0\neqp_corrections\neqp_co_corrections')).toEqual([]);
  });
  it('checks Voigt broadening and Hamiltonian files', () => {
    expect(abs('voigt_broadening')).toEqual(['bgw-bse-broadening']);
    expect(abs('voigt_broadening\nenergy_resolution_sigma 0.1\nenergy_resolution_gamma 0.05')).toEqual([]);
    expect(abs('dump_bse_hamiltonian\nread_bse_hamiltonian')).toEqual(['bgw-bse-hamiltonian']);
  });
});

describe('inteqp.inp', () => {
  const inteqp = (text: string) => validateBgw(parseBgw(text), 'inteqp').map((d) => d.code);
  it('checks only the bands and refuses absorption-only keywords', () => {
    expect(inteqp(BANDS)).toEqual([]);
    expect(inteqp(BANDS.replace('number_cond_bands_fine 2', 'number_cond_bands_fine 5'))).toEqual(['bgw-bse-bands']);
    expect(inteqp(BANDS + 'energy_resolution 0.1\n')).toEqual(['bgw-unknown-keyword']);
  });
});
