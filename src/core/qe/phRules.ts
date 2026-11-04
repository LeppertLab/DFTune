// Checks for ph.x inputs (https://www.quantum-espresso.org/Doc/INPUT_PH.html). Every error mirrors
// a condition in QE 7.4's PHonon/PH/phq_readin.f90.
//
//   Title line                    (anything; required, a first line &inputph is an error)
//   &INPUTPH ... /
//   xq1 xq2 xq3                   when ldisp = .false. and qplot = .false.: the q point
//   nqs, then nqs lines           when qplot = .true.: `xq1 xq2 xq3 weight`
//
// ph.x continues the pw.x scf run with the same prefix and outdir, so the pw.x input next to it
// (when there is one) is checked against it too.

import type { Span } from '../incar/parse';
import type { Line } from '../lines';
import { Reader } from './reader';
import type { QeDoc } from './parse';
import type { Report } from './rules';
import { isInteger, isReal, toReal } from './values';

const NL = 'INPUTPH';
const lineSpan = (l: Line): Span => ({ start: l.start, end: l.end });

export function checkPh(doc: QeDoc, report: Report) {
  const r = new Reader(doc);
  const nl = r.namelist(NL);
  if (!nl) return;

  // The first line is read as the title: a namelist there is a missing title.
  if (/^\s*&\s*inputph/i.test(doc.lines[0]?.text ?? '')) {
    report('error', 'qe-ph-title', 'ph.x reads a title line before &INPUTPH (any text, e.g. "phonons"): this input starts with the namelist, so pw.x stops with "Title line missing".', nl.nameSpan, {
      title: 'Add a title line',
      edit: { start: 0, end: 0, text: `${r.str(NL, 'prefix') ? `phonons of ${r.str(NL, 'prefix')}` : 'phonons'}${doc.text.includes('\r\n') ? '\r\n' : '\n'}` },
    });
  }

  const ldisp = r.bool(NL, 'ldisp') === true;
  const qplot = r.bool(NL, 'qplot') === true;
  const after = doc.loose.filter((l) => l.start > nl.span.end && l.text.trim() !== '');

  // The q point(s) after the namelist.
  if (qplot) {
    const head = after[0];
    if (!head || !isInteger(head.tokens[0]?.text ?? '')) {
      report('error', 'qe-ph-xq', 'qplot = .true. needs, after the namelist, the number of q points and then one line "xq1 xq2 xq3 weight" for each.', nl.nameSpan);
    } else {
      const n = Number(head.tokens[0].text);
      const points = after.slice(1, 1 + n);
      if (points.length < n) report('error', 'qe-ph-xq', `${n} q points announced but ${points.length} listed.`, lineSpan(head));
      for (const p of points) {
        if (p.tokens.length < 4 || !p.tokens.slice(0, 4).every((t) => isReal(t.text))) report('error', 'qe-ph-xq', 'A q point needs four numbers: xq1 xq2 xq3 and the weight (the number of points to the next one).', lineSpan(p));
      }
    }
  } else if (!ldisp) {
    const line = after[0];
    if (!line || line.tokens.length < 3 || !line.tokens.slice(0, 3).every((t) => isReal(t.text))) {
      report('error', 'qe-ph-xq', 'ph.x needs the q point after the namelist (three numbers, e.g. 0.0 0.0 0.0 for Γ): "reading xq" otherwise fails.', line ? lineSpan(line) : nl.nameSpan, line ? undefined : {
        title: 'Add the Γ point (0.0 0.0 0.0)',
        edit: { start: nl.span.end, end: nl.span.end, text: `${doc.text.includes('\r\n') ? '\r\n' : '\n'}0.0 0.0 0.0` },
      });
    } else {
      const xq = line.tokens.slice(0, 3).map((t) => toReal(t.text));
      const gamma = xq.every((x) => x === 0);
      const field = ['epsil', 'zue', 'lraman', 'elop'].find((v) => r.bool(NL, v) === true);
      if (field && !gamma) report('error', 'qe-ph-gamma', `${field} = .true. needs the Γ point (0 0 0); "gamma is needed for elec.field".`, lineSpan(line));
    }
  } else if (after.length && !qplot) {
    report('info', 'qe-ph-xq-ignored', 'ldisp = .true. generates the q points from nq1, nq2, nq3: the lines after the namelist are not read.', lineSpan(after[0]));
  }

  // ldisp needs the grid.
  if (ldisp && !qplot) {
    for (const n of ['nq1', 'nq2', 'nq3']) {
      const v = r.num(NL, n);
      if (v === undefined || v <= 0) {
        report('error', 'qe-ph-nq', 'ldisp = .true. needs nq1, nq2, nq3 greater than 0: "nq1, nq2, and nq3 must be greater than 0".', r.entry(NL, 'ldisp')?.valueSpan ?? nl.nameSpan);
        break;
      }
    }
  }
  if (r.bool(NL, 'zue') === true && r.bool(NL, 'trans') === false && !ldisp) {
    report('error', 'qe-ph-zue', "zue = .true. needs trans = .true.: the effective charges come from the phonon calculation.", r.entry(NL, 'zue')!.keySpan);
  }
  if ((r.num(NL, 'modenum') ?? 0) > 0 && ldisp) report('error', 'qe-ph-modenum', 'A single-mode calculation (modenum) cannot be combined with ldisp.', r.entry(NL, 'modenum')!.keySpan);
  if (r.bool(NL, 'only_init') === true && r.bool(NL, 'only_wfc') === true) report('error', 'qe-ph-only', 'only_init and only_wfc cannot both be .true.', r.entry(NL, 'only_init')!.keySpan);
  if (ldisp && r.bool(NL, 'only_init') === true && r.bool(NL, 'lqdir') !== true) report('error', 'qe-ph-only', 'only_init = .true. with ldisp needs lqdir = .true.: otherwise the data are lost.', r.entry(NL, 'only_init')!.keySpan);
  const tr2 = r.num(NL, 'tr2_ph');
  if (tr2 !== undefined && tr2 <= 0) report('error', 'qe-ph-tr2', 'tr2_ph must be positive.', r.entry(NL, 'tr2_ph')!.valueSpan);
  else if (tr2 !== undefined && tr2 > 1e-10) report('info', 'qe-ph-tr2', `tr2_ph = ${r.entry(NL, 'tr2_ph')!.value} is loose: the default is 1.0d-12, and 1.0d-14 is common for production phonons.`, r.entry(NL, 'tr2_ph')!.valueSpan);
  const startQ = r.num(NL, 'start_q');
  if (startQ !== undefined && startQ <= 0) report('error', 'qe-ph-start', 'start_q must be at least 1.', r.entry(NL, 'start_q')!.valueSpan);
  if ((r.num(NL, 'start_irr') ?? 0) < 0) report('error', 'qe-ph-start', 'start_irr cannot be negative.', r.entry(NL, 'start_irr')!.valueSpan);
}

/** The pw.x input a ph.x run continues: same prefix and outdir, an scf calculation, a tight convergence, no metal with epsil. */
export function checkPhAgainstPw(ph: QeDoc, pw: QeDoc, report: Report) {
  const p = new Reader(ph);
  const w = new Reader(pw);
  if (!p.namelist(NL)) return;
  const prefixPh = p.str(NL, 'prefix') ?? 'pwscf';
  const prefixPw = w.str('CONTROL', 'prefix') ?? 'pwscf';
  const dir = (d: string | undefined) => (d ?? '.').replace(/\/+$/, '').replace(/^\.\//, '') || '.';
  if (prefixPh !== prefixPw) {
    report('warning', 'qe-ph-prefix', `prefix = '${prefixPh}' but the pw.x input has prefix = '${prefixPw}': ph.x reads the scf data of its own prefix and stops if they are missing.`, p.entry(NL, 'prefix')?.valueSpan ?? p.namelist(NL)!.nameSpan);
  }
  if (dir(p.str(NL, 'outdir')) !== dir(w.str('CONTROL', 'outdir'))) {
    report('warning', 'qe-ph-outdir', `outdir = '${p.str(NL, 'outdir') ?? './'}' but the pw.x input has outdir = '${w.str('CONTROL', 'outdir') ?? './'}': ph.x looks for the scf data in its own outdir.`, p.entry(NL, 'outdir')?.valueSpan ?? p.namelist(NL)!.nameSpan);
  }
  const calc = w.str('CONTROL', 'calculation') ?? 'scf';
  if (calc === 'nscf' || calc === 'bands') {
    report('warning', 'qe-ph-pw-calc', `The pw.x input next to it is a '${calc}' run; ph.x needs the data of a self-consistent (scf) run.`, p.namelist(NL)!.nameSpan);
  }
  const conv = w.num('ELECTRONS', 'conv_thr');
  if (conv !== undefined && conv > 1e-9 && calc !== 'nscf' && calc !== 'bands') {
    report('info', 'qe-ph-conv', `The pw.x scf has conv_thr = ${w.entry('ELECTRONS', 'conv_thr')!.value}: phonons need a tight scf (1.0d-12 or smaller).`, p.namelist(NL)!.nameSpan);
  }
  const occ = w.str('SYSTEM', 'occupations');
  if (p.bool(NL, 'epsil') === true && (occ === 'smearing' || (occ ?? '').startsWith('tetrahedra'))) {
    report('error', 'qe-ph-metal', `epsil = .true. is only for insulators, but the pw.x input uses occupations = '${occ}': "no elec. field with metals".`, p.entry(NL, 'epsil')!.keySpan);
  }
}
