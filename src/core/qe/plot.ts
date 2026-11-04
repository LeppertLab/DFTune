// Inputs of plotband.x and plotrho.x: they have no namelist, the programs read their answers to
// prompts from standard input (`plotband.x < plotband.in`), one value per line:
//
//   plotband.x                                   plotrho.x
//   1  Emin Emax [firstk lastk]                  1  output file
//   2  output file for gnuplot/xmgr (blank=skip) 2  y or n: logarithmic scale  (only asked if the data are all positive)
//   3  PostScript file (blank = stop here)       3  min max nlevels
//   4  Efermi
//   5  deltaE, reference energy for the tics
//   6  file for the projected-band gnuplot script (when projections exist)
//
// (PP/src/plotband.f90 and plotrho.f90.) The input file of the data comes from the command line.

import type { Span } from '../incar/parse';
import { isBlank, isInteger, isNumber, lineSpan, splitLines, toNumber, type Line } from '../lines';
import type { Diagnostic } from '../validation/rules';

export type PlotProgram = 'plotband' | 'plotrho';

/** Which program a file is for, from its name (plotband.in, run1.plotrho, …). */
export function plotProgramOf(fileName: string): PlotProgram | undefined {
  const name = fileName.split('/').pop()!.toLowerCase();
  return name.includes('plotband') ? 'plotband' : name.includes('plotrho') ? 'plotrho' : undefined;
}

const PROMPTS: Record<PlotProgram, string[]> = {
  plotband: ['Energy range: Emin Emax [firstk lastk]', 'Output file for gnuplot/xmgr (blank skips it)', 'PostScript file (blank stops here)', 'Fermi energy (eV)', 'deltaE and reference energy for the tics', 'Output file for the projected-band gnuplot script'],
  plotrho: ['Output file', 'Logarithmic scale (y/n); only asked when all values are positive', 'Contour levels: min max number-of-levels'],
};

/** What the line at `offset` is answering, as hover text. */
export function plotHover(program: PlotProgram, text: string, offset: number): { markdown: string; start: number; end: number } | undefined {
  const lines = splitLines(text, 'x');
  const line = lines.find((l) => offset >= l.start && offset <= l.end);
  if (!line) return undefined;
  const roles = roleOf(program, lines);
  const prompt = roles.get(line.n);
  return prompt === undefined ? undefined : { markdown: `**${program}.x** · ${PROMPTS[program][prompt]}`, start: line.start, end: line.end };
}

/** Which prompt each line answers (a prompt index), following the program's own reads. */
function roleOf(program: PlotProgram, lines: Line[]): Map<number, number> {
  const roles = new Map<number, number>();
  if (program === 'plotband') {
    lines.slice(0, 5).forEach((l, i) => roles.set(l.n, i));
    if (lines[5]) roles.set(lines[5].n, 5);
    return roles;
  }
  roles.set(0, 0);
  const second = lines[1];
  const logical = second && /^[yYnN]/.test(second.text.trim()) && !isNumber(second.tokens[0]?.text ?? '');
  if (logical) roles.set(1, 1);
  const levels = lines[logical ? 2 : 1];
  if (levels) roles.set(levels.n, 2);
  return roles;
}

export function lintPlotInput(program: PlotProgram, text: string): Diagnostic[] {
  const lines = splitLines(text, 'x');
  const out: Diagnostic[] = [];
  const report = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => out.push({ severity, code, message, span });
  const end: Span = { start: text.length, end: text.length };
  const numbers = (l: Line, min: number, max: number, what: string): number[] | undefined => {
    const t = l.tokens.slice(0, max);
    if (t.length < min || !t.slice(0, min).every((x) => isNumber(x.text))) {
      report('error', 'plot-line', `${what}: expected ${min === max ? min : `${min} or ${max}`} number${max > 1 ? 's' : ''}, found "${l.text.trim()}".`, lineSpan(l));
      return undefined;
    }
    return t.filter((x) => isNumber(x.text)).map((x) => toNumber(x.text));
  };

  if (program === 'plotband') {
    const range = lines[0];
    if (!range) {
      report('error', 'plot-line', 'The file is empty: the first line is "Emin Emax [firstk lastk]".', end);
      return out;
    }
    // Emin Emax, and optionally firstk lastk (otherwise all k points).
    const v = numbers(range, 2, 4, 'Energy range');
    if (v) {
      if (v[0] >= v[1]) report('warning', 'plot-range', 'Emin should be smaller than Emax.', lineSpan(range));
      if (v.length === 3) report('warning', 'plot-range', 'firstk and lastk go together: with three numbers only Emin and Emax are read.', lineSpan(range));
      if (v.length === 4 && (!Number.isInteger(v[2]) || !Number.isInteger(v[3]) || v[2] > v[3] || v[2] < 1)) report('error', 'plot-range', 'firstk and lastk must be integers with 1 <= firstk <= lastk.', lineSpan(range));
    }
    const ps = lines[2];
    if (!lines[1]) report('error', 'plot-incomplete', 'The second line (output file for gnuplot/xmgr, blank to skip) is missing.', end);
    else if (!ps) report('error', 'plot-incomplete', 'The third line (PostScript file, blank to stop) is missing.', end);
    else if (isBlank(ps)) {
      if (lines.slice(3).some((l) => !isBlank(l))) report('info', 'plot-ignored', 'A blank PostScript file name stops the program: the lines below are not read.', lineSpan(lines.slice(3).find((l) => !isBlank(l))!));
    } else {
      const ef = lines[3];
      if (!ef) report('error', 'plot-incomplete', 'A PostScript file needs the Fermi energy on the next line: reading it fails at the end of the file.', end);
      else numbers(ef, 1, 1, 'Fermi energy');
      const tics = lines[4];
      if (ef && !tics) report('error', 'plot-incomplete', 'The line "deltaE, reference energy" is missing.', end);
      else if (tics) numbers(tics, 2, 2, 'deltaE and the reference energy');
    }
    return out;
  }

  // plotrho
  const file = lines[0];
  if (!file || isBlank(file)) report('error', 'plot-line', 'The first line must be the name of the output file.', file ? lineSpan(file) : end);
  const second = lines[1];
  if (!second) {
    report('error', 'plot-incomplete', 'The contour levels are missing: "min max number-of-levels".', end);
    return out;
  }
  const isChoice = !isNumber(second.tokens[0]?.text ?? '');
  if (isChoice && !/^[yYnN]/.test(second.text.trim())) report('error', 'plot-line', 'Expected y or n (logarithmic scale), or the contour levels "min max number-of-levels".', lineSpan(second));
  const levels = lines[isChoice ? 2 : 1];
  if (!levels) {
    report('error', 'plot-incomplete', 'The contour levels are missing: "min max number-of-levels".', end);
    return out;
  }
  const t = levels.tokens.slice(0, 3);
  if (t.length < 3 || !t.every((x) => isNumber(x.text)) || !isInteger(t[2].text)) {
    report('error', 'plot-line', 'Contour levels need three values: min max and the (integer) number of levels.', lineSpan(levels));
  } else {
    if (toNumber(t[1].text) <= toNumber(t[0].text)) report('error', 'plot-range', 'max must be larger than min ("Out of Bounds! try again").', lineSpan(levels));
    if (Number(t[2].text) > 1000) report('warning', 'plot-levels', 'More than 1000 levels: plotrho.x asks "are you sure?".', t[2]);
  }
  return out;
}
