// Lookup of BerkeleyGW input keywords (generated from the 4.0 documentation and input readers).
//
// BerkeleyGW compares keywords case-sensitively (RPA_insulator, exciton_Q_shift), dies on a keyword
// it does not know, and reads a fixed file name per program (epsilon.inp, sigma.inp, …).

import { BGW_ACCEPTED, BGW_DEFS, BGW_VERSION, type BgwKeywordRow } from './keywords.generated';

export { BGW_VERSION };

export const BGW_PROGRAMS = ['epsilon', 'sigma', 'kernel', 'absorption', 'inteqp'] as const;
export type BgwProgram = (typeof BGW_PROGRAMS)[number];

export interface BgwKeyword {
  name: string;
  program: BgwProgram;
  kind: 'keyword' | 'block';
  /** `toggle` (a flag without value), `integer`, `float`, `string`, `array` or `block`. */
  type: string;
  unit: string;
  /** Marked as mandatory in the documentation. */
  required: boolean;
  /** A default, only where the documentation states one in its metadata. */
  default: string;
  doc: string;
  options: { value: string; note: string }[];
  /** An example value from the documentation (not a default). */
  example: string;
}

const toKeyword = (program: BgwProgram, name: string, r: BgwKeywordRow): BgwKeyword => ({
  name,
  program,
  kind: r[0],
  type: r[1],
  unit: r[2],
  required: r[3],
  default: r[4],
  doc: r[5],
  options: r[6].map(([value, note]) => ({ value, note })),
  example: r[8],
});

const cache = new Map<BgwProgram, Map<string, BgwKeyword>>();
function table(program: BgwProgram): Map<string, BgwKeyword> {
  let t = cache.get(program);
  if (!t) {
    t = new Map(Object.entries(BGW_DEFS[program]).map(([name, row]) => [name, toKeyword(program, name, row)]));
    cache.set(program, t);
  }
  return t;
}

export const keywordsOf = (program: BgwProgram): BgwKeyword[] => [...table(program).values()];

/** The documented keyword with exactly this name (case-sensitive, like BerkeleyGW). */
export const lookupKeyword = (program: BgwProgram, name: string): BgwKeyword | undefined => table(program).get(name);

/** Keywords BerkeleyGW reads but the documentation does not list. */
export const isAcceptedUndocumented = (program: BgwProgram, name: string): boolean => BGW_ACCEPTED[program]?.includes(name) ?? false;

/** Every name the program accepts, documented or not. */
export const allKeywordNames = (program: BgwProgram): string[] => [...table(program).keys(), ...(BGW_ACCEPTED[program] ?? [])];

export const bgwManualUrl = (program: BgwProgram) => `https://manual.berkeleygw.org/${BGW_VERSION}/${program}-keywords/`;

/** File names of the other BerkeleyGW programs (nonlinearoptics.inp, plotxct.inp, parabands.inp, …). */
const OTHER_TOOLS = /^(nonlinear|plotxct|parabands|bgw2sgw|sig2wan|summarize|epsconv|epsmat|epsinv|epsomega|kgrid|gsphere|pw2bgw|subsample|epm|abi2bgw|sapo|scissors|screening|common)/;

/**
 * Which program an input is for: from the file name (epsilon.inp, eps_cd.inp, sigma.inp, sig_GPP.inp,
 * kernel.inp, absorption.inp, absp_haydock.inp, inteqp.inp), else from keywords only one program has.
 */
export function detectBgwProgram(fileName: string, text = ''): BgwProgram | undefined {
  const name = fileName.split('/').pop()!.toLowerCase();
  if (/^eps(ilon)?([._-]|$)/.test(name)) return 'epsilon';
  if (/^sig(ma)?([._-]|$)/.test(name)) return 'sigma';
  if (/^kern(el)?([._-]|$)/.test(name)) return 'kernel';
  if (/^inteqp([._-]|$)/.test(name)) return 'inteqp';
  if (/^abs(orption|p)?([._-]|$)/.test(name)) return 'absorption';
  // Inputs of other BerkeleyGW tools share keywords with these programs: never guess for them.
  if (OTHER_TOOLS.test(name)) return undefined;
  if (/^epsilon_cutoff\b/m.test(text)) return 'epsilon';
  if (/^(band_index_min|screened_coulomb_cutoff)\b/m.test(text)) return 'sigma';
  if (/^number_(val|cond)_bands_(coarse|fine)\b/m.test(text)) return 'absorption';
  if (/^number_(val|cond)_bands\b/m.test(text)) return 'kernel';
  return undefined;
}
