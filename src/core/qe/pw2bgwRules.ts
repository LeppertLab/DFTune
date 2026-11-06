// Checks for pw2bgw.x, which converts the data of a pw.x run into BerkeleyGW input files.
// Every rule mirrors a condition in PP/src/pw2bgw.f90 (QE 7.4).

import type { QeDoc } from './parse';
import { Reader } from './reader';
import type { Report } from './rules';

const NL = 'INPUT_PW2BGW';

/** Checks within one pw2bgw.x input. */
export function checkPw2bgw(doc: QeDoc, report: Report) {
  const r = new Reader(doc);
  if (!r.namelist(NL)) return;
  const at = (name: string) => r.entry(NL, name)!;

  // Values the program reads and refuses ("errore(codename, 'real_or_complex', 1)").
  const flavor = r.num(NL, 'real_or_complex');
  if (flavor !== undefined && flavor !== 1 && flavor !== 2) {
    report('error', 'qe-bgw-value', 'real_or_complex must be 1 (real flavor, with inversion and time-reversal symmetry) or 2 (complex flavor).', at('real_or_complex').valueSpan);
  }
  const integral = r.str(NL, 'vxc_integral');
  if (integral !== undefined && integral !== 'g' && integral !== 'r') report('error', 'qe-bgw-value', "vxc_integral must be 'g' (G-space, recommended) or 'r' (R-space).", at('vxc_integral').valueSpan);

  // A k-grid for the wavefunction file needs positive divisions.
  if (r.bool(NL, 'wfng_flag') === true && r.bool(NL, 'wfng_kgrid') === true) {
    for (const n of ['wfng_nk1', 'wfng_nk2', 'wfng_nk3']) {
      const v = r.num(NL, n);
      if (v === undefined || v <= 0) {
        report('error', 'qe-bgw-kgrid', `wfng_kgrid = .true. needs wfng_nk1, wfng_nk2 and wfng_nk3 above 0 (${n} is ${v ?? 'not set'}): pw2bgw.x stops with "bad_kgrid".`, r.entry(NL, n)?.valueSpan ?? at('wfng_kgrid').keySpan);
        break;
      }
    }
  }

  // Band ranges of the Vxc (and KIH) matrix elements: min above max stops the program.
  if (r.bool(NL, 'vxc_flag') === true || r.bool(NL, 'kih_flag') === true) {
    for (const kind of ['diag', 'offdiag']) {
      const lo = r.num(NL, `vxc_${kind}_nmin`);
      const hi = r.num(NL, `vxc_${kind}_nmax`);
      if (lo !== undefined && hi !== undefined && lo > hi) {
        report('error', 'qe-bgw-range', `vxc_${kind}_nmin (${lo}) is larger than vxc_${kind}_nmax (${hi}): pw2bgw.x stops with "${kind}_nmin > ${kind}_nmax".`, at(`vxc_${kind}_nmin`).valueSpan);
      }
    }
    if (r.num(NL, 'real_or_complex') === 1 && r.bool(NL, 'vxc_flag') === true && (r.num(NL, 'vxc_offdiag_nmax') ?? 0) > 0) {
      report('error', 'qe-bgw-real-offdiag', 'Off-diagonal Vxc matrix elements are not implemented for real wavefunctions (real_or_complex = 1): compute them in Sigma using VXC, or use real_or_complex = 2.', at('vxc_offdiag_nmax').valueSpan);
    }
  }
  if (r.bool(NL, 'vxc_flag') === true && r.bool(NL, 'kih_flag') !== true && (r.num(NL, 'vxc_diag_nmax') ?? 0) === 0 && (r.num(NL, 'vxc_offdiag_nmax') ?? 0) === 0) {
    report('warning', 'qe-bgw-range', 'vxc_flag is on but vxc_diag_nmax and vxc_offdiag_nmax are 0: vxc.dat will hold no matrix elements. Set the band range Sigma needs.', at('vxc_flag').keySpan);
  }
  // The Hubbard potential has its own ranges.
  if (r.bool(NL, 'vhub_flag') === true) {
    for (const kind of ['diag', 'offdiag']) {
      const lo = r.num(NL, `vhub_${kind}_nmin`);
      const hi = r.num(NL, `vhub_${kind}_nmax`);
      if (lo !== undefined && hi !== undefined && lo > hi) report('error', 'qe-bgw-range', `vhub_${kind}_nmin (${lo}) is larger than vhub_${kind}_nmax (${hi}).`, at(`vhub_${kind}_nmin`).valueSpan);
    }
  }

  // Nothing requested: the program runs and writes nothing.
  const flags = ['wfng_flag', 'rhog_flag', 'vxcg_flag', 'vxc0_flag', 'vxc_flag', 'vscg_flag', 'vkbg_flag', 'kih_flag', 'vxc_hybrid_flag', 'vhub_flag'];
  if (!flags.some((f) => r.bool(NL, f) === true)) {
    report('warning', 'qe-bgw-nothing', 'No output is requested: set wfng_flag (WFN), rhog_flag (RHO), vxc_flag (vxc.dat) or another *_flag to .true.; pw2bgw.x otherwise writes nothing.', r.namelist(NL)!.nameSpan);
  }
  // rhog and wfng band ranges: both must be set to be used.
  if (r.bool(NL, 'rhog_flag') === true && ((r.num(NL, 'rhog_nvmin') ?? 0) === 0) !== ((r.num(NL, 'rhog_nvmax') ?? 0) === 0)) {
    report('warning', 'qe-bgw-range', 'rhog_nvmin and rhog_nvmax must both be nonzero to compute the charge density of a band range; with only one set it is ignored.', at(r.has(NL, 'rhog_nvmin') ? 'rhog_nvmin' : 'rhog_nvmax').keySpan);
  }
}

/** pw2bgw.x input against the pw.x input of the run it converts. */
export function checkPw2bgwAgainstPw(post: Reader, pw: Reader, report: Report) {
  const kpoints = pw.card('K_POINTS');
  const at = post.entry(NL, 'prefix')?.keySpan ?? post.namelist(NL)!.nameSpan;
  if (kpoints?.option === 'gamma') {
    report('error', 'qe-bgw-gamma', 'BerkeleyGW cannot use a Γ-only run (K_POINTS {gamma}): pw2bgw.x stops with "BGW cannot use gamma-only run". Use {tpiba}, {automatic} or {crystal}, even for Γ alone.', at);
  }
  const nspin = pw.num('SYSTEM', 'nspin');
  if (post.num(NL, 'real_or_complex') === 1 && (pw.bool('SYSTEM', 'noncolin') === true || nspin === 4)) {
    report('error', 'qe-bgw-real-spinor', 'The real flavor (real_or_complex = 1) cannot be used with a noncollinear pw.x run.', post.entry(NL, 'real_or_complex')!.valueSpan);
  }
  const calc = pw.str('CONTROL', 'calculation') ?? 'scf';
  if (calc === 'scf') {
    report('info', 'qe-bgw-scf', "The pw.x input next to it is an scf run: BerkeleyGW wants wavefunctions on a k-grid from a 'bands' (or nscf) run, with the k-points of kgrid.x.", at);
  }
  const nbnd = pw.num('SYSTEM', 'nbnd');
  const top = Math.max(post.num(NL, 'vxc_diag_nmax') ?? 0, post.num(NL, 'vxc_offdiag_nmax') ?? 0);
  if (nbnd !== undefined && post.bool(NL, 'vxc_flag') === true && top > nbnd) {
    report('warning', 'qe-bgw-range', `The Vxc band range goes up to ${top}, but the pw.x input has nbnd = ${nbnd}: pw2bgw.x resets it to ${nbnd}.`, post.entry(NL, 'vxc_diag_nmax')?.valueSpan ?? post.entry(NL, 'vxc_offdiag_nmax')!.valueSpan);
  }
  const disk = pw.str('CONTROL', 'disk_io');
  if (disk === 'nowf' || disk === 'none') report('warning', 'qe-bgw-wfc', `The pw.x input has disk_io = '${disk}': wavefunctions are not saved, and pw2bgw.x needs them.`, at);
}
