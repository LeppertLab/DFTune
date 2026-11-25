// Lookup of MolGW input variables (generated from src/input_variables.yaml and the Fortran source of MolGW).
//
// MolGW reads its input with a Fortran namelist (`read(inputfile, molgw)` in read_inputfile_namelist,
// src/m_inputparam.f90): names are not case-sensitive, an unknown name stops it, and so does a value
// that cannot be read as the type of the variable. The character variables are compared in upper case.

import { editDistance } from '../validation/rules';
import {
  MOLGW_COMMIT,
  MOLGW_DEFS,
  MOLGW_ELEMENTS,
  MOLGW_LISTED,
  MOLGW_NO,
  MOLGW_POSTSCF,
  MOLGW_SCF_BUILTIN,
  MOLGW_SCF_FUNCTIONALS,
  MOLGW_STRICT,
  MOLGW_VERSION,
  MOLGW_YES,
  type MolgwKeywordRow,
} from './keywords.generated';

export { MOLGW_COMMIT, MOLGW_VERSION, MOLGW_ELEMENTS, MOLGW_NO, MOLGW_POSTSCF, MOLGW_YES };

export type MolgwType = MolgwKeywordRow[0];

export interface MolgwKeyword {
  /** Lower case, as in the table; the input may spell it in any case. */
  name: string;
  type: MolgwType;
  /** The section of the manual (docs/input_variables.md). */
  section: string;
  mandatory: boolean;
  experimental: boolean;
  /** The default of the Fortran source ('' when there is none). */
  default: string;
  doc: string;
  /** Values the code accepts (scf, postscf, yes/no, …) or the manual lists, lower case. */
  values: string[];
  /** Whether MolGW stops on any other value (`strict`) or only the manual lists them. */
  valuesAre: 'strict' | 'listed' | 'none';
  /** Where the values come from (listed ones). */
  valuesSource: string;
}

export const MOLGW_YESNO = [...MOLGW_YES, ...MOLGW_NO];

/** Every scf name MolGW knows: built-in schemes and functionals (LIBXC:<id> is accepted too). */
export const scfNames = (): string[] => [...MOLGW_SCF_BUILTIN, ...MOLGW_SCF_FUNCTIONALS];
export const postscfNames = (): string[] => Object.keys(MOLGW_POSTSCF);

/** The values worth suggesting for a variable: the first spelling of each, readable ones first. */
function valuesOf(name: string, type: MolgwType): Pick<MolgwKeyword, 'values' | 'valuesAre' | 'valuesSource'> {
  if (type === 'yesno') return { values: ['yes', 'no'], valuesAre: 'strict', valuesSource: 'yesno_to_logical (src/m_string_tools.f90)' };
  if (name === 'scf') return { values: scfNames(), valuesAre: 'strict', valuesSource: 'init_calculation_type and init_dft_type (src/m_inputparam.f90)' };
  if (name === 'postscf') return { values: postscfNames(), valuesAre: 'strict', valuesSource: 'init_calculation_type (src/m_inputparam.f90)' };
  const strict = MOLGW_STRICT[name];
  if (strict) return { values: strict.values, valuesAre: 'strict', valuesSource: 'read_inputfile_namelist (src/m_inputparam.f90)' };
  const listed = MOLGW_LISTED[name];
  if (listed) return { values: listed.values, valuesAre: 'listed', valuesSource: listed.source };
  return { values: [], valuesAre: 'none', valuesSource: '' };
}

const table = new Map<string, MolgwKeyword>(
  Object.entries(MOLGW_DEFS).map(([name, r]) => [name, { name, type: r[0], section: r[1], mandatory: r[2], experimental: r[3], default: r[4], doc: r[5], ...valuesOf(name, r[0]) }]),
);

export const molgwKeywords = (): MolgwKeyword[] => [...table.values()];

/** The variable with this name, in any case (Fortran namelist names are not case-sensitive). */
export const lookupMolgw = (name: string): MolgwKeyword | undefined => table.get(name.toLowerCase());

/** Subscripts (`a1(2)=…`) name an element of the same variable. */
export const baseName = (name: string) => name.replace(/\(.*$/, '');

export const molgwManualUrl = (name: string) => `https://github.com/molgw/molgw/blob/main/docs/input_variables.md#${name}`;

/** The nearest candidate by edit distance (a name that differs only in case is not a typo: none then). */
export function closestOf(name: string, candidates: string[]): string | undefined {
  const low = name.toLowerCase();
  const max = low.length > 6 ? 2 : 1;
  let best: string | undefined;
  let bestDist = max + 1;
  for (const c of candidates) {
    if (Math.abs(c.length - low.length) > max) continue;
    const d = editDistance(low, c.toLowerCase());
    // Closest first; among equals the shorter name (pbee: pbe rather than pbex).
    if (d > 0 && d <= max && (d < bestDist || (d === bestDist && c.length < best!.length))) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** The elements MolGW knows (H … Lr), matched case-sensitively like `element_number` does. */
export const isElementSymbol = (s: string) => MOLGW_ELEMENTS.includes(s);
export const atomicNumber = (symbol: string): number | undefined => {
  const i = MOLGW_ELEMENTS.indexOf(symbol);
  return i < 0 ? undefined : i + 1;
};

/**
 * Whether a file is a MolGW input: the usual names (molgw.in, *.molgw, *.molgw.in), or a first namelist
 * `&molgw` (comments and blank lines before it are fine).
 */
export function isMolgwInput(fileName: string, text = ''): boolean {
  const name = fileName.split('/').pop()!.toLowerCase();
  if (name === 'molgw.in' || name.endsWith('.molgw') || name.endsWith('.molgw.in')) return true;
  return startsWithMolgwNamelist(text);
}

/** The first line that is not blank or a ! comment opens the group `&molgw`. */
export function startsWithMolgwNamelist(text: string): boolean {
  for (const line of text.slice(0, 4000).split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('!')) continue;
    return /^&\s*molgw\b/i.test(t);
  }
  return false;
}
