// Checks for absorption.inp and inteqp.inp beyond the syntax: the conditions BSE/inread.f90 refuses
// (call die). inteqp.f90 uses the same reader, so the band-count rules apply to both; the rest
// belongs to absorption only (the reader skips it when `is_absorption` is false).

import { isNumber } from '../lines';
import type { BgwDoc } from './parse';
import { BgwReader, type Report } from './reader';

export function checkBse(doc: BgwDoc, program: 'absorption' | 'inteqp', report: Report) {
  const r = new BgwReader(doc);
  const at = (name: string) => r.keyAt(name);
  const valueAt = (name: string) => r.valueAt(name);

  // The fine-grid bands are a subset of the coarse-grid bands.
  for (const kind of ['val', 'cond']) {
    const fine = r.num(`number_${kind}_bands_fine`);
    const coarse = r.num(`number_${kind}_bands_coarse`);
    if (fine !== undefined && coarse !== undefined && fine > coarse) {
      report('error', 'bgw-bse-bands', `number_${kind}_bands_fine (${fine}) is larger than number_${kind}_bands_coarse (${coarse}): BerkeleyGW stops with "The number_${kind}_bands_coarse should be greater than the number_${kind}_bands_fine".`, valueAt(`number_${kind}_bands_fine`));
    }
  }
  if (program !== 'absorption') return;

  // The operator: absorption has no default; the last of the switches wins.
  const operators = ['use_velocity', 'use_momentum', 'use_dos'].filter((k) => r.has(k));
  const operator = operators.sort((a, b) => r.entry(a)!.span.start - r.entry(b)!.span.start).pop();
  if (!operator) {
    report('error', 'bgw-bse-operator', 'absorption.inp needs an operator: use_momentum, use_velocity or use_dos. BerkeleyGW stops with "No flag for operator".', { start: 0, end: 0 });
  }

  // Momentum operator: the polarization of Haydock or a given `polarization` must not be zero.
  const pol = r.entry('polarization');
  const haydock = r.has('haydock') && !r.after('diagonalization', 'haydock') && !r.after('lanczos', 'haydock') && !r.after('diagonalization_primme', 'haydock');
  if (operator === 'use_momentum' && (pol || haydock)) {
    const zero = !pol || pol.args.slice(0, 3).every((t) => isNumber(t.text) && Number(t.text) === 0);
    if (zero) report('error', 'bgw-bse-polarization', 'The polarization direction is not set (or is 0 0 0): BerkeleyGW stops with "Polarization direction not set". Add `polarization 1 0 0` or the direction you want.', pol ? pol.span : at('haydock'));
  }

  const iterations = r.num('number_iterations');
  const iterative = ['haydock', 'lanczos'].some((k) => r.has(k)) && !(r.after('diagonalization', 'haydock') && r.after('diagonalization', 'lanczos'));
  if (iterations !== undefined && iterations < 1 && (iterative || r.has('diagonalization_primme'))) {
    report('error', 'bgw-bse-iterations', 'number_iterations must be at least 1: BerkeleyGW stops with "Invalid number of iterations".', valueAt('number_iterations'));
  }
  if (r.has('diagonalization_primme')) {
    if ((r.num('number_eigenvalues') ?? 0) === 0) report('error', 'bgw-bse-primme', 'diagonalization_primme needs number_eigenvalues: BerkeleyGW stops with "Number of eigenvalues must be set for iterative diagonalization".', at('diagonalization_primme'));
    if (r.after('full_bse', 'tda_bse')) report('error', 'bgw-bse-primme', 'The iterative (PRIMME) diagonalization does not work with full_bse: BerkeleyGW stops with "Iterative diagonalization not implemented with full BSE solver".', at('full_bse'));
  }

  // Interpolation and quasiparticle corrections.
  const skip = r.has('skip_interpolation');
  if (skip && operator === 'use_velocity') report('error', 'bgw-bse-interp', 'skip_interpolation cannot be used with use_velocity.', at('skip_interpolation'));
  if (skip && r.has('eqp_co_corrections')) report('error', 'bgw-bse-interp', 'eqp_co_corrections cannot be used with skip_interpolation; use eqp_corrections instead.', at('eqp_co_corrections'));
  if (skip && r.has('read_dtmat')) report('error', 'bgw-bse-interp', 'read_dtmat and skip_interpolation are incompatible.', at('read_dtmat'));
  if (r.has('read_dtmat') && r.has('eqp_co_corrections')) report('error', 'bgw-bse-interp', 'read_dtmat and eqp_co_corrections cannot be used together (read_dtmat would make BerkeleyGW ignore the corrections): set one of them off.', at('read_dtmat'));
  if (r.has('eqp_co_corrections') && !r.has('eqp_corrections') && r.has('noeh_only')) {
    report('error', 'bgw-bse-interp', 'eqp_co_corrections cannot be used with noeh_only (no interpolation to the fine grid): run inteqp first and use eqp_corrections.', at('eqp_co_corrections'));
  }
  const fermi = r.num('fermi_level');
  const adjusted = (fermi !== undefined && Math.abs(fermi) > 1e-9) || r.after('fermi_level_absolute', 'fermi_level_relative');
  if (adjusted && r.has('eqp_corrections') !== r.has('eqp_co_corrections') && !skip) {
    report('error', 'bgw-bse-fermi', 'With an adjusted Fermi level and interpolation, use both or neither of eqp_corrections and eqp_co_corrections (get eqp.dat from inteqp).', at(r.has('eqp_corrections') ? 'eqp_corrections' : 'eqp_co_corrections'));
  }
  if (r.has('use_symmetries_fine_grid') && operator === 'use_velocity') {
    report('error', 'bgw-bse-interp', 'use_symmetries_fine_grid cannot be used with use_velocity.', at('use_symmetries_fine_grid'));
  }

  // Broadening.
  if (r.has('energy_resolution') && r.num('energy_resolution') === 0) {
    report('error', 'bgw-bse-broadening', 'energy_resolution is 0: BerkeleyGW stops with "The energy_resolution keyword could not be found".', valueAt('energy_resolution'));
  }
  if (r.has('voigt_broadening') && !r.after('gaussian_broadening', 'voigt_broadening') && !r.after('lorentzian_broadening', 'voigt_broadening')) {
    const sigma = r.num('energy_resolution_sigma') ?? 0;
    const gamma = r.num('energy_resolution_gamma') ?? 0;
    if (sigma <= 1e-6 || gamma < 0) report('error', 'bgw-bse-broadening', 'voigt_broadening needs energy_resolution_sigma > 0 and energy_resolution_gamma >= 0.', at('voigt_broadening'));
  }

  // Subsampling and the Hamiltonian file.
  if (r.has('subsample_line')) {
    if (r.has('dont_use_hdf5')) report('error', 'bgw-bse-subsample', 'subsample_line needs the HDF5 file format: remove dont_use_hdf5.', at('subsample_line'));
    if (r.has('kernel_k_interpolation')) report('error', 'bgw-bse-subsample', 'subsample_line cannot be used with kernel_k_interpolation.', at('subsample_line'));
  }
  const algo = r.num('subsample_algo');
  if (algo !== undefined && ![0, 1].includes(algo)) report('error', 'bgw-bse-subsample', 'subsample_algo must be 0 or 1.', valueAt('subsample_algo'));
  if (r.has('dump_bse_hamiltonian') && r.has('read_bse_hamiltonian')) {
    report('error', 'bgw-bse-hamiltonian', 'dump_bse_hamiltonian and read_bse_hamiltonian cannot be used in the same run.', at('read_bse_hamiltonian'));
  }
}
