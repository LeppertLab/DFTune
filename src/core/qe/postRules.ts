// Checks for the post-processing programs dos.x, projwfc.x and bands.x. They read the data of an
// earlier pw.x run (same prefix and outdir), so each is also compared with the pw.x input next to it.
// Every error mirrors a condition in the QE 7.4 source (PP/src/dos.f90, projwfc.f90, bands.f90).

import type { QeDoc } from './parse';
import { Reader } from './reader';
import type { Report } from './rules';
import type { QeProgram } from './tags';

const NAMELIST: Partial<Record<QeProgram, string>> = { dos: 'DOS', projwfc: 'PROJWFC', bands: 'BANDS', ph: 'INPUTPH' };

/** Directory spellings that mean the same: "./tmp/", "tmp" . */
const dir = (d: string | undefined) => (d ?? '.').replace(/\/+$/, '').replace(/^\.\//, '') || '.';

/** The run continues pw.x data: its prefix and outdir must be the same as in the pw.x input. */
export function checkSamePrefixAndOutdir(post: Reader, pw: Reader, namelist: string, program: string, report: Report) {
  const nl = post.namelist(namelist);
  if (!nl) return;
  const prefix = post.str(namelist, 'prefix') ?? 'pwscf';
  const pwPrefix = pw.str('CONTROL', 'prefix') ?? 'pwscf';
  if (prefix !== pwPrefix) {
    report('warning', 'qe-post-prefix', `prefix = '${prefix}' but the pw.x input has prefix = '${pwPrefix}': ${program}.x reads the data of its own prefix and stops if they are missing.`, post.entry(namelist, 'prefix')?.valueSpan ?? nl.nameSpan);
  }
  if (dir(post.str(namelist, 'outdir')) !== dir(pw.str('CONTROL', 'outdir'))) {
    report('warning', 'qe-post-outdir', `outdir = '${post.str(namelist, 'outdir') ?? './'}' but the pw.x input has outdir = '${pw.str('CONTROL', 'outdir') ?? './'}': ${program}.x looks for the data in its own outdir.`, post.entry(namelist, 'outdir')?.valueSpan ?? nl.nameSpan);
  }
}

/** Checks within one dos.x, projwfc.x or bands.x input. */
export function checkPost(doc: QeDoc, program: QeProgram, report: Report) {
  const r = new Reader(doc);
  if (program === 'projwfc') {
    const nl = 'PROJWFC';
    const paw = r.bool(nl, 'pawproj') === true;
    const forcet = r.bool(nl, 'lforcet') === true;
    const boxes = r.bool(nl, 'tdosinboxes') === true;
    const incompatible = (a: string, b: string, at: string) => report('error', 'qe-post-incompatible', `${a} and ${b} cannot be used together: projwfc.x stops with "incompatible options".`, r.entry(nl, at)!.keySpan);
    if (paw && forcet) incompatible('pawproj', 'lforcet', 'pawproj');
    if (paw && boxes) incompatible('pawproj', 'tdosinboxes', 'pawproj');
    if (forcet && boxes) incompatible('lforcet', 'tdosinboxes', 'lforcet');
    // lsym is .true. unless the input says otherwise.
    if (forcet && r.bool(nl, 'lsym') !== false) report('error', 'qe-post-incompatible', "lforcet needs lsym = .false. (lsym is .true. by default): projwfc.x stops with \"incompatible options\".", r.entry(nl, 'lforcet')!.keySpan);
    if (r.bool(nl, 'diag_basis') === true && paw) incompatible('diag_basis', 'pawproj', 'diag_basis');
    if (r.bool(nl, 'lbinary_data') === true) report('info', 'qe-post-binary', 'lbinary_data has no effect: projwfc.x prints "binary output disabled".', r.entry(nl, 'lbinary_data')!.keySpan);
  }
  if (program === 'bands') {
    const spin = r.num('BANDS', 'spin_component');
    if (spin !== undefined && spin !== 1 && spin !== 2) report('error', 'qe-bands-spin', 'spin_component must be 1 or 2.', r.entry('BANDS', 'spin_component')!.valueSpan);
  }
}

/** A post-processing input against the pw.x input of the run it continues. */
export function checkPostAgainstPw(post: QeDoc, program: QeProgram, pw: QeDoc, report: Report) {
  const namelist = NAMELIST[program];
  if (!namelist) return;
  const p = new Reader(post);
  const w = new Reader(pw);
  if (!p.namelist(namelist)) return;
  checkSamePrefixAndOutdir(p, w, namelist, program, report);

  const kpoints = w.card('K_POINTS');
  const kType = kpoints?.option ?? 'tpiba';
  const noncolin = w.bool('SYSTEM', 'noncolin') === true;
  const calc = w.str('CONTROL', 'calculation') ?? 'scf';
  const at = p.entry(namelist, 'prefix')?.keySpan ?? p.namelist(namelist)!.nameSpan;

  if (program === 'dos') {
    const bz = (p.str('DOS', 'bz_sum') ?? '').toLowerCase();
    const degauss = p.num('DOS', 'degauss') ?? 0;
    // dos.f90: "tetrahedra integration only with automatic uniform k_point meshes".
    if (bz.startsWith('tetrahedra') && degauss === 0 && kpoints && kType !== 'automatic') {
      report('error', 'qe-dos-tetra', `bz_sum = '${bz}' needs the pw.x run to use an automatic k-point grid (K_POINTS {automatic}); it uses {${kType}}: dos.x stops.`, p.entry('DOS', 'bz_sum')!.valueSpan);
    }
  }
  if (program === 'bands') {
    if (kType === 'gamma') report('error', 'qe-bands-gamma', 'bands.x does not support Γ-only runs (K_POINTS {gamma}): "gamma_only case not implemented".', at);
    if (p.bool('BANDS', 'lsigma') === true && !noncolin) report('error', 'qe-bands-lsigma', 'lsigma needs a noncollinear pw.x run (noncolin = .true.).', p.entry('BANDS', 'lsigma')!.keySpan);
    const spin = p.num('BANDS', 'spin_component');
    if (spin !== undefined && spin !== 1 && w.num('SYSTEM', 'nspin') !== 2) report('error', 'qe-bands-spin', 'spin_component other than 1 needs a spin-polarized (nspin = 2) pw.x run.', p.entry('BANDS', 'spin_component')!.valueSpan);
    if (calc === 'scf') report('info', 'qe-bands-scf', "The pw.x input next to it is an scf run: bands.x is meant for the output of a 'bands' (or nscf) calculation along a k-point path.", at);
  }
  if (program === 'projwfc') {
    const disk = w.str('CONTROL', 'disk_io');
    if (disk === 'nowf' || disk === 'none') report('warning', 'qe-projwfc-wfc', `The pw.x input has disk_io = '${disk}': wavefunctions are not saved, and projwfc.x needs them.`, at);
    if (p.bool('PROJWFC', 'pawproj') === true && noncolin) report('error', 'qe-post-incompatible', 'pawproj is not implemented for noncollinear runs.', p.entry('PROJWFC', 'pawproj')!.keySpan);
    if (p.bool('PROJWFC', 'diag_basis') === true && noncolin) report('error', 'qe-post-incompatible', 'diag_basis = .true. is not implemented for noncollinear runs.', p.entry('PROJWFC', 'diag_basis')!.keySpan);
    if (p.bool('PROJWFC', 'diag_basis') === true && kType === 'gamma') report('error', 'qe-post-incompatible', 'diag_basis = .true. is not implemented for Γ-only runs.', p.entry('PROJWFC', 'diag_basis')!.keySpan);
  }
}
