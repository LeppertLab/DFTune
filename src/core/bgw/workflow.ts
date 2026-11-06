// Checks across the input files of one BerkeleyGW workflow in a folder: epsilon.inp → sigma.inp and
// kernel.inp → absorption.inp. Each file is checked against its neighbours and reports on its own
// side. The rules are the consistency requirements stated in the BerkeleyGW documentation
// (documentation/input_files/*.inp: "Make sure to use the same parameter that you used in
// `kernel`", the cutoff limits, the frequency dependence of the dielectric matrix).

import type { Span } from '../incar/parse';
import type { Diagnostic } from '../validation/rules';
import type { BgwDoc } from './parse';
import { BgwReader } from './reader';
import { detectBgwProgram, type BgwProgram } from './tags';

type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => void;

export interface BgwNeighbor {
  program: BgwProgram;
  fileName: string;
  doc: BgwDoc;
}

const PREFIX = /^(?:epsilon|eps|sigma|sig|kernel|kern|absorption|absp|abs|inteqp)(?=$|[._-])/i;

/** The part of a file name that tells the runs apart: `eps_cd.inp` and `sig_cd.inp` share "cd". */
export function bgwRunSuffix(fileName: string): string {
  const base = (fileName.split('/').pop() ?? fileName).replace(/\.inp$/i, '');
  return base.replace(PREFIX, '').replace(/^[._-]+/, '');
}

/**
 * Which file of each other program belongs with `fileName`: the one with the same run suffix, else
 * the only one of that program in the folder, provided `fileName` is the only one of its own program
 * too (a folder with several runs of each says nothing about which goes with which).
 */
export function pairBgwFiles(fileName: string, siblings: string[]): Partial<Record<BgwProgram, string>> {
  const self = detectBgwProgram(fileName);
  if (!self) return {};
  const suffix = bgwRunSuffix(fileName);
  const out: Partial<Record<BgwProgram, string>> = {};
  const alone = !siblings.some((n) => n !== fileName && detectBgwProgram(n) === self);
  const byProgram = new Map<BgwProgram, string[]>();
  for (const name of siblings) {
    const p = detectBgwProgram(name);
    if (!p || p === self || name === fileName) continue;
    byProgram.set(p, [...(byProgram.get(p) ?? []), name]);
  }
  for (const [program, names] of byProgram) {
    const same = names.filter((n) => bgwRunSuffix(n) === suffix);
    const pick = same.length === 1 ? same[0] : alone && names.length === 1 ? names[0] : undefined;
    if (pick) out[program] = pick;
  }
  return out;
}

const FREQ_OF_SIGMA: Record<number, number> = { 0: 0, 1: 0, 2: 2, 3: 3 };
const FREQ_NAME: Record<number, string> = { 0: 'static', 2: 'full-frequency', 3: 'Godby–Needs' };

export function checkWorkflow(self: BgwProgram, doc: BgwDoc, neighbors: BgwNeighbor[], report: Report) {
  const r = new BgwReader(doc);
  const other = (p: BgwProgram) => neighbors.find((n) => n.program === p);
  const spanOf = (name: string, fallback?: string): Span => {
    const e = r.entry(name) ?? (fallback ? r.entry(fallback) : undefined);
    return e ? (e.args.length ? e.valueSpan : e.keySpan) : { start: 0, end: 0 };
  };

  const eps = other('epsilon');
  const sig = other('sigma');
  const ker = other('kernel');
  const abs = other('absorption');

  // The screened Coulomb cutoff cannot exceed the epsilon cutoff (Sigma and Kernel read W from the epsilon matrices).
  if (self === 'sigma' || self === 'kernel') {
    const cut = r.num('screened_coulomb_cutoff');
    const epsCut = eps && new BgwReader(eps.doc).num('epsilon_cutoff');
    if (eps && cut !== undefined && epsCut !== undefined && cut > epsCut) {
      report('error', 'bgw-wf-cutoff', `screened_coulomb_cutoff (${cut}) is larger than epsilon_cutoff (${epsCut}) in ${eps.fileName}: the dielectric matrix has no G-vectors beyond ${epsCut} Ry.`, spanOf('screened_coulomb_cutoff'));
    }
  }
  if (self === 'epsilon') {
    const epsCut = r.num('epsilon_cutoff');
    for (const n of [sig, ker]) {
      const cut = n && new BgwReader(n.doc).num('screened_coulomb_cutoff');
      if (n && epsCut !== undefined && cut !== undefined && cut > epsCut) {
        report('error', 'bgw-wf-cutoff', `epsilon_cutoff (${epsCut}) is below the screened_coulomb_cutoff (${cut}) of ${n.fileName}: ${n.program} cannot use G-vectors the dielectric matrix does not have.`, spanOf('epsilon_cutoff'));
      }
    }
  }

  // The frequency dependence of Sigma follows the dielectric matrix: static for COHSEX and GPP, full frequency, Godby–Needs.
  if (self === 'sigma' && eps) {
    const sf = r.num('frequency_dependence') ?? 1;
    const ef = new BgwReader(eps.doc).num('frequency_dependence') ?? 0;
    if (sf in FREQ_OF_SIGMA && FREQ_OF_SIGMA[sf] !== ef) {
      report('warning', 'bgw-wf-frequency', `frequency_dependence ${sf} needs a ${FREQ_NAME[FREQ_OF_SIGMA[sf]]} dielectric matrix (epsilon frequency_dependence ${FREQ_OF_SIGMA[sf]}), but ${eps.fileName} has ${ef}.`, spanOf('frequency_dependence'));
    }
  }
  if (self === 'epsilon' && sig) {
    const sf = new BgwReader(sig.doc).num('frequency_dependence') ?? 1;
    const ef = r.num('frequency_dependence') ?? 0;
    if (sf in FREQ_OF_SIGMA && FREQ_OF_SIGMA[sf] !== ef) {
      report('warning', 'bgw-wf-frequency', `${sig.fileName} has frequency_dependence ${sf}, which needs frequency_dependence ${FREQ_OF_SIGMA[sf]} here (${FREQ_NAME[FREQ_OF_SIGMA[sf]]}).`, spanOf('frequency_dependence'));
    }
  }

  // Absorption continues the kernel: its coarse-grid choices must be the kernel's.
  if (self === 'absorption' && ker) {
    const k = new BgwReader(ker.doc);
    for (const kind of ['val', 'cond']) {
      const mine = r.num(`number_${kind}_bands_coarse`);
      const theirs = k.num(`number_${kind}_bands`);
      if (mine !== undefined && theirs !== undefined && mine !== theirs) {
        report('warning', 'bgw-wf-bands', `number_${kind}_bands_coarse is ${mine}, but the kernel in ${ker.fileName} used number_${kind}_bands ${theirs}: absorption reads the kernel matrices with these dimensions.`, spanOf(`number_${kind}_bands_coarse`));
      }
    }
    // Only when both say it: the default depends on the grids.
    const sym = (rd: BgwReader) => (rd.has('use_symmetries_coarse_grid') || rd.has('no_symmetries_coarse_grid') ? (rd.after('use_symmetries_coarse_grid', 'no_symmetries_coarse_grid') ? 'use' : 'no') : undefined);
    const a = sym(r);
    const b = sym(k);
    if (a && b && a !== b) {
      report('warning', 'bgw-wf-symmetry', `Use the same coarse-grid symmetry flag as the kernel: ${ker.fileName} has ${b}_symmetries_coarse_grid.`, spanOf(`${a}_symmetries_coarse_grid`));
    }
    const wantsExtended = r.has('extended_kernel') || r.after('full_bse', 'tda_bse');
    if (wantsExtended !== k.has('extended_kernel')) {
      report('warning', 'bgw-wf-extended', wantsExtended ? `The kernel in ${ker.fileName} is not an extended kernel: add extended_kernel there (full_bse and extended_kernel need it).` : `The kernel in ${ker.fileName} is an extended kernel: use extended_kernel (or full_bse) here too.`, spanOf(r.has('extended_kernel') ? 'extended_kernel' : 'full_bse', 'number_val_bands_coarse'));
    }
    const q = (rd: BgwReader) => rd.entry('exciton_Q_shift')?.args.map((t) => t.text).join(' ');
    if (q(r) !== q(k) && (q(r) !== undefined || q(k) !== undefined)) {
      report('warning', 'bgw-wf-qshift', `exciton_Q_shift ${q(r) ?? '(not set)'} differs from the kernel's in ${ker.fileName} (${q(k) ?? 'not set'}): finite-Q needs it in both, with the same value.`, spanOf('exciton_Q_shift', 'number_val_bands_coarse'));
    }
  }
  if (self === 'kernel' && abs) {
    const k = r;
    const a = new BgwReader(abs.doc);
    for (const kind of ['val', 'cond']) {
      const mine = k.num(`number_${kind}_bands`);
      const theirs = a.num(`number_${kind}_bands_coarse`);
      if (mine !== undefined && theirs !== undefined && mine !== theirs) {
        report('warning', 'bgw-wf-bands', `number_${kind}_bands is ${mine}, but ${abs.fileName} reads the kernel with number_${kind}_bands_coarse ${theirs}.`, spanOf(`number_${kind}_bands`));
      }
    }
  }
}
