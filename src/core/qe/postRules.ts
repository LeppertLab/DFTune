// Checks for the post-processing programs dos.x, projwfc.x and bands.x. They read the data of an
// earlier pw.x run (same prefix and outdir), so each is also compared with the pw.x input next to it.
// Every error mirrors a condition in the QE 7.4 source (PP/src/dos.f90, projwfc.f90, bands.f90).

import type { QeDoc } from './parse';
import { Reader } from './reader';
import type { Report } from './rules';
import { checkPw2bgwAgainstPw } from './pw2bgwRules';
import type { QeProgram } from './tags';

const NAMELIST: Partial<Record<QeProgram, string>> = { dos: 'DOS', projwfc: 'PROJWFC', bands: 'BANDS', ph: 'INPUTPH', pw2bgw: 'INPUT_PW2BGW' };

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
  if (program === 'pw2bgw') {
    checkPw2bgwAgainstPw(p, w, report);
    return;
  }

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

/** output_format values chdens accepts: 1 and 4 are obsolete, anything below 0 or above 7 is wrong. */
const VALID_FORMATS = [0, 2, 3, 5, 6, 7];

/** pw.x data → plots: &INPUTPP (what to extract) and &PLOT (how to write it). Conditions from PP/src/postproc.f90 and chdens_module.f90. */
export function checkPp(doc: QeDoc, report: Report) {
  const r = new Reader(doc);
  const inputpp = r.namelist('INPUTPP');
  const plot = r.namelist('PLOT');

  const plotNum = r.num('INPUTPP', 'plot_num');
  if (plotNum !== undefined && plotNum !== -1 && (plotNum < 0 || (plotNum > 24 && plotNum !== 119 && plotNum !== 123))) {
    report('error', 'qe-pp-plotnum', `plot_num = ${plotNum} is not a quantity pp.x knows: use 0–24, 119 or 123 ("Wrong plot_num").`, r.entry('INPUTPP', 'plot_num')!.valueSpan);
  }
  const spin = r.num('INPUTPP', 'spin_component', '1') ?? (r.entry('INPUTPP', 'spin_component') && !r.entry('INPUTPP', 'spin_component')!.index ? r.num('INPUTPP', 'spin_component') : undefined);
  if (spin !== undefined) {
    const max = plotNum === 7 || plotNum === 13 || plotNum === 18 ? 3 : plotNum === 10 ? 2 : Infinity;
    if (spin < 0 || spin > max) report('error', 'qe-pp-spin', `spin_component = ${spin} is out of range for plot_num = ${plotNum ?? 0}${max < Infinity ? ` (0–${max})` : ''}: "wrong spin_component".`, r.entry('INPUTPP', 'spin_component', r.has('INPUTPP', 'spin_component', '1') ? '1' : undefined)!.valueSpan);
  }
  const emin = r.num('INPUTPP', 'emin');
  const emax = r.num('INPUTPP', 'emax');
  if (emin !== undefined && emax !== undefined && emin > emax) report('error', 'qe-pp-emin', 'emin > emax: pp.x stops.', r.entry('INPUTPP', 'emin')!.keySpan);

  if (inputpp && !plot && plotNum !== undefined && plotNum >= 0) {
    report('info', 'qe-pp-plot-missing', 'There is no &PLOT namelist: pp.x only writes the file named by filplot, no plot. Add &PLOT (iflag, output_format, …) to get one.', inputpp.nameSpan);
  }
  if (!plot) return;
  const iflag = r.num('PLOT', 'iflag');
  const format = r.num('PLOT', 'output_format');
  if (iflag === undefined || format === undefined) {
    report('warning', 'qe-pp-format', 'iflag and output_format must both be set: without them pp.x prints "output format not set, exiting" and writes no plot.', plot.nameSpan);
    return; // chdens returns here: nothing else in &PLOT is looked at
  }
  const nfile = r.num('PLOT', 'nfile');
  if (nfile !== undefined && nfile < 1) report('error', 'qe-pp-nfile', 'nfile must be at least 1.', r.entry('PLOT', 'nfile')!.valueSpan);
  if (format !== undefined && !VALID_FORMATS.includes(format)) {
    report('error', 'qe-pp-format', `output_format = ${format} is wrong or obsolete: use 0, 2, 3, 5, 6 or 7 (see the documentation of output_format for your iflag).`, r.entry('PLOT', 'output_format')!.valueSpan);
  }
  if (iflag === undefined) return;
  const vec = (n: string) => [1, 2, 3].map((i) => r.num('PLOT', n, String(i)) ?? 0);
  const len2 = (v: number[]) => v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [e1, e2, e3] = [vec('e1'), vec('e2'), vec('e3')];
  const at = r.entry('PLOT', 'iflag')!.valueSpan;
  const nx = r.num('PLOT', 'nx') ?? 0;
  const ny = r.num('PLOT', 'ny') ?? 0;
  if (iflag <= 1) {
    if (len2(e1) < 1e-6) report('error', 'qe-pp-vectors', `iflag = ${iflag} needs the vector e1 (e1(1), e1(2), e1(3)): "missing e1 vector".`, at);
    if (nx <= 0) report('error', 'qe-pp-nx', `iflag = ${iflag} needs nx > 0 (the number of points): "wrong nx".`, at);
  } else if (iflag === 2) {
    if (len2(e1) < 1e-6 || len2(e2) < 1e-6) report('error', 'qe-pp-vectors', 'iflag = 2 (2D plot) needs the vectors e1 and e2: "missing e1/e2 vectors".', at);
    else if (Math.abs(dot(e1, e2)) > 1e-6) report('error', 'qe-pp-vectors', 'e1 and e2 are not orthogonal: pp.x stops.', at);
    if (nx <= 0 || ny <= 0) report('error', 'qe-pp-nx', 'iflag = 2 needs nx > 0 and ny > 0: "wrong nx/ny".', at);
  } else if (iflag === 3) {
    if (Math.abs(dot(e1, e2)) > 1e-6 || Math.abs(dot(e1, e3)) > 1e-6 || Math.abs(dot(e2, e3)) > 1e-6) report('error', 'qe-pp-vectors', 'e1, e2, e3 are not orthogonal: pp.x stops.', at);
    if (format !== undefined && (format < 3 || format > 6)) report('error', 'qe-pp-format', 'iflag = 3 (3D) needs output_format between 3 and 6: "incompatible iflag/output_format".', r.entry('PLOT', 'output_format')!.valueSpan);
  } else if (iflag === 4) {
    if (nx <= 0 || ny <= 0) report('error', 'qe-pp-nx', 'iflag = 4 needs nx > 0 and ny > 0: "wrong nx/ny".', at);
  } else {
    report('error', 'qe-pp-iflag', `iflag = ${iflag} is not implemented (use 1 for a line, 2 plane, 3 3D grid, 4 spherical average).`, at);
  }
}
