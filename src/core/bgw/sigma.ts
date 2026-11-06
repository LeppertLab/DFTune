// Checks for sigma.inp beyond the syntax: combinations of keywords that Sigma/inread.f90 refuses
// (call die) or warns about. Every rule is a condition from that file.

import { isInteger, isNumber } from '../lines';
import type { BgwDoc } from './parse';
import { BgwReader, type Report } from './reader';

export function checkSigma(doc: BgwDoc, report: Report) {
  const r = new BgwReader(doc);
  const at = (name: string) => r.keyAt(name);
  const valueAt = (name: string) => r.valueAt(name);

  // Defaults of the reader: GPP (1), contour deformation as the full-frequency method (2).
  const freq = r.num('frequency_dependence') ?? 1;
  const method = r.num('frequency_dependence_method') ?? 2;
  if (![-1, 0, 1, 2, 3].includes(freq)) {
    report('error', 'bgw-sig-frequency', `frequency_dependence = ${freq} is not -1 (Hartree–Fock), 0 (static COHSEX), 1 (GPP), 2 (full frequency) or 3 (Godby–Needs): Sigma stops with "Invalid option for frequency_dependence".`, valueAt('frequency_dependence'));
  } else if (freq === 2 && ![0, 2].includes(method)) {
    report('error', 'bgw-sig-frequency', `frequency_dependence_method = ${method} is not 0 (real axis) or 2 (contour deformation) for a full-frequency Sigma.`, valueAt('frequency_dependence_method'));
  }
  const cd = r.num('cd_integration_method');
  if (cd !== undefined && freq === 2 && method === 2 && ![0, 2, 3].includes(cd)) {
    report('error', 'bgw-sig-frequency', 'cd_integration_method must be 0, 2 or 3.', valueAt('cd_integration_method'));
  }

  // Hartree–Fock sums over a q-grid: it needs the q-points block, the grid and a q→0 point.
  const qpoints = r.block('qpoints');
  if (freq === -1) {
    const where = r.entry('frequency_dependence')!.keySpan;
    if (!qpoints) report('error', 'bgw-sig-hf', 'Hartree–Fock needs a `begin qpoints` block: Sigma stops with "The `begin qpoints` block could not be found".', where);
    const grid = r.entry('qgrid');
    if (!grid || grid.args.slice(0, 3).every((t) => Number(t.text) === 0)) {
      report('error', 'bgw-sig-hf', 'Hartree–Fock needs qgrid: Sigma stops with "qgrid must be specified for Hartree-Fock".', where);
    }
    if (qpoints) {
      const q0 = qpoints.rows.some((l) => l.tokens.length >= 5 && isInteger(l.tokens[4].text) && Number(l.tokens[4].text) === 1);
      if (!q0) report('error', 'bgw-sig-hf', 'No q→0 point in the qpoints block (the fifth column must be 1 for one of them): Sigma stops with "No q0 specified in qpoints block".', qpoints.nameSpan);
    }
  } else if (qpoints) {
    report('warning', 'bgw-sig-qpoints', 'The qpoints block is only used for Hartree–Fock (frequency_dependence -1) and is ignored here.', qpoints.nameSpan);
  }

  // Partial occupations need full frequency with contour deformation and an absolute Fermi level.
  if (r.has('occ_broadening')) {
    if (!(freq === 2 && method === 2)) {
      report('error', 'bgw-sig-fermi', 'occ_broadening needs frequency_dependence 2 and frequency_dependence_method 2: Sigma stops otherwise.', at('occ_broadening'));
    }
    if (!r.after('fermi_level_absolute', 'fermi_level_relative')) {
      report('error', 'bgw-sig-fermi', 'occ_broadening needs fermi_level_absolute (the Fermi level is relative to the band edges by default): Sigma stops with "fermi_level_absolute must be specified if using occ_broadening".', at('occ_broadening'));
    }
  }

  // The bands: a diag block, number_diag or band_index_min/max.
  const diag = r.block('diag');
  const nmin = r.num('band_index_min') ?? 0;
  const nmax = r.num('band_index_max') ?? 0;
  const ndiag = r.num('number_diag') ?? 0;
  if (diag && ndiag > diag.rows.length) {
    report('error', 'bgw-sig-bands', `number_diag is ${ndiag} but the diag block has ${diag.rows.length} rows: Sigma stops with "ndiag too small".`, valueAt('number_diag'));
  }
  const noff = r.num('number_offdiag') ?? 0;
  const offdiag = r.block('offdiag');
  if (offdiag && noff > offdiag.rows.length && !r.has('sigma_matrix')) {
    report('error', 'bgw-sig-bands', `number_offdiag is ${noff} but the offdiag block has ${offdiag.rows.length} rows: Sigma stops with "offdiag error".`, valueAt('number_offdiag'));
  }

  // sigma_matrix l t: l in [-2, 0] or a band in range, t in [-1, 1]; it overrides the offdiag block.
  const sm = r.entry('sigma_matrix');
  if (sm) {
    const loff = Number(sm.args[0]?.text);
    const toff = Number(sm.args[1]?.text);
    const lo = nmin * nmax !== 0 ? nmin : undefined;
    const bad = !isNumber(sm.args[0]?.text ?? '') || !isNumber(sm.args[1]?.text ?? '') || loff < -2 || toff < -1 || toff > 1 || (lo !== undefined && loff > 0 && (loff < nmin || loff > nmax));
    if (bad) report('error', 'bgw-sig-matrix', 'sigma_matrix parameters out of range: the first value is -2, -1, 0 or a band inside band_index_min..max, the second -1, 0 or 1. Sigma stops with "sigma_matrix parameters out of range".', sm.valueSpan);
    if (loff !== 0 && offdiag) report('warning', 'bgw-sig-matrix', 'Both an offdiag block and sigma_matrix are given: sigma_matrix overrides the block.', offdiag.nameSpan);
  }

  // The cutoffs and the band sum: the screened cutoff cannot exceed the bare one, and the bands
  // computed cannot lie beyond the bands summed over.
  const ecuts = r.num('screened_coulomb_cutoff');
  const ecutb = r.num('bare_coulomb_cutoff');
  if (ecuts !== undefined && ecutb !== undefined && ecuts > ecutb) {
    report('error', 'bgw-sig-cutoff', `screened_coulomb_cutoff (${ecuts}) is larger than bare_coulomb_cutoff (${ecutb}): Sigma stops with "The screened_coulomb_cutoff cannot be greater than the bare_coulomb_cutoff".`, valueAt('screened_coulomb_cutoff'));
  }
  const nbands = r.num('number_bands');
  if (nbands !== undefined && !r.has('for_EXX')) {
    const top = Math.max(nmax, ...(diag?.rows.map((l) => (isInteger(l.tokens[0]?.text ?? '') ? Number(l.tokens[0].text) : 0)) ?? [0]));
    if (top > nbands) {
      report('error', 'bgw-sig-bands', `Band ${top} is computed but number_bands is ${nbands}: Sigma stops with "band_index_max cannot be greater than number_bands".`, r.has('band_index_max') && nmax === top ? valueAt('band_index_max') : valueAt('number_bands'));
    }
  }

  // The remaining ranges.
  const ch = r.num('exact_static_ch');
  if (ch !== undefined && freq !== -1 && ![0, 1].includes(ch)) report('error', 'bgw-sig-range', 'exact_static_ch must be 0 or 1: Sigma stops with "Illegal value for exact_static_ch".', valueAt('exact_static_ch'));
  const conv = r.num('full_ch_conv_log');
  if (conv !== undefined && ![0, 1].includes(conv)) report('error', 'bgw-sig-range', 'full_ch_conv_log must be 0 or 1: Sigma stops with "Invalid full_ch_conv_log".', valueAt('full_ch_conv_log'));
  const smin = r.num('spin_index_min') ?? 1;
  const smax = r.num('spin_index_max') ?? 1;
  if (!(smin === smax ? smin === 1 || smin === 2 : smin === 1 && smax === 2)) {
    report('error', 'bgw-sig-range', `The spin indices ${smin} to ${smax} are not allowed: use 1–1, 2–2 or 1–2.`, valueAt(r.has('spin_index_min') ? 'spin_index_min' : 'spin_index_max'));
  }
  const shift = r.num('frequency_grid_shift');
  if (shift !== undefined && ![0, 1, 2].includes(shift)) report('error', 'bgw-sig-range', 'frequency_grid_shift must be 0, 1 or 2: Sigma stops with "Invalid value for frequency_grid_shift".', valueAt('frequency_grid_shift'));
  const grid = r.entry('init_frequency_eval') ?? r.entry('number_frequency_eval');
  if (grid && (shift ?? 2) === 2) {
    report('error', 'bgw-sig-range', 'init_frequency_eval / number_frequency_eval are set but frequency_grid_shift is still 2 (the default): set frequency_grid_shift to 0 or 1, or drop these keywords. Sigma stops with "Inconsistent flags with frequency_grid_shift".', grid.keySpan);
  }
  // dont_symmetrize switches the symmetrization off, so the q-grid must not be symmetrized either.
  if (r.has('dont_symmetrize') && !r.after('no_symmetries_q_grid', 'use_symmetries_q_grid')) {
    report('error', 'bgw-sig-symmetry', 'dont_symmetrize needs no_symmetries_q_grid: Sigma stops with "Must use no_symmetries_q_grid flag with dont_symmetrize flag".', at('dont_symmetrize'));
  }
  for (const name of ['number_kpoints', 'number_qpoints']) {
    if (r.has(name)) report('warning', 'bgw-deprecated', `${name} is deprecated: Sigma works out the number from the block.`, at(name));
  }
}
