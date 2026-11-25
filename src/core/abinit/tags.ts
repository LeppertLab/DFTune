// Lookup of ABINIT input variables (generated from abimkdocs/variables_abinit.py of the ABINIT repository).
//
// ABINIT upper-cases the whole input before it looks for a name, so names are case-insensitive. A name in the
// input may carry a dataset suffix (ecut1, ecut?2, ecut1?, ecut:, ecut+, ecut*), described in `splitAbinitWord`.

import { ABINIT_REVISION, ABINIT_UNDOCUMENTED, ABINIT_VARIABLES, type AbinitVariableRow } from './variables.generated';

export { ABINIT_REVISION };

export interface AbinitVariable {
  name: string;
  /** False for the names ABINIT reads (or echoes) but the documentation does not list. */
  documented: boolean;
  /** `integer`, `real`, `string`, `integer or string`, or `logical` (T / F) for a few undocumented ones. */
  type: string;
  /** Dimensions as written in the documentation (`3`, `natom`, `min(natom,natrd)`); empty for a scalar. */
  dims: string[];
  default: string;
  mnemonic: string;
  /** Lower case: energy, length, magnetic_field, develop, evolving, no_multi, input_only, internal_only. */
  characteristics: string[];
  varset: string;
  doc: string;
  options: { value: string; note: string }[];
  requires: string;
  excludes: string;
  commentDefault: string;
  addedIn: string;
}

const toVariable = (name: string, r: AbinitVariableRow): AbinitVariable => ({
  name,
  documented: true,
  type: r[0],
  dims: r[1],
  default: r[2],
  mnemonic: r[3],
  characteristics: r[4],
  varset: r[5],
  doc: r[6],
  options: r[7].map(([value, note]) => ({ value, note })),
  requires: r[8],
  excludes: r[9],
  commentDefault: r[10],
  addedIn: r[11],
});

/** Read by ABINIT, listed nowhere in the documentation: tests/v8 sets it, the echo routine of src/57_iovars/m_outvar_i_n.F90 names it. */
const EXTRA_ACCEPTED: Record<string, string> = { dmftctqmc_triqs_nleg: 'int' };

/** The type of an undocumented name from the `typevarphys` it is read with (int, dpr, len, ene, bfi, tim, log, key). */
const undocumentedType = (kind: string) => (kind === 'int' ? 'integer' : kind === 'log' ? 'logical' : kind === 'key' ? 'string' : 'real');

const table = new Map<string, AbinitVariable>();
const undocumented = new Map<string, AbinitVariable>();
function init() {
  if (table.size) return;
  for (const [name, row] of Object.entries(ABINIT_VARIABLES)) table.set(name, toVariable(name, row));
  for (const [name, kind] of Object.entries({ ...ABINIT_UNDOCUMENTED, ...EXTRA_ACCEPTED })) {
    if (table.has(name)) continue;
    undocumented.set(name, {
      name,
      documented: false,
      type: undocumentedType(kind),
      dims: [],
      default: '',
      mnemonic: '',
      characteristics: kind === 'ene' ? ['energy'] : kind === 'len' ? ['length'] : [],
      varset: '',
      doc: '',
      options: [],
      requires: '',
      excludes: '',
      commentDefault: '',
      addedIn: '',
    });
  }
}

/** The documented variables. */
export function abinitVariables(): AbinitVariable[] {
  init();
  return [...table.values()];
}

/** The documented variable with this name (any case). */
export function lookupAbinitVariable(name: string): AbinitVariable | undefined {
  init();
  const n = name.toLowerCase();
  return table.get(n) ?? undocumented.get(n);
}

export const abinitVariableNames = (): string[] => abinitVariables().map((v) => v.name);

export const abinitDocUrl = (name: string) => `https://docs.abinit.org/variables/${table.get(name)?.varset ?? 'basic'}/#${name}`;

/** Strings ABINIT skips as one word when it checks the names (chkvars_in_string: list_strings), so they may be unquoted. */
export const isAbinitStringVariable = (v: AbinitVariable) => v.type === 'string';

/** Logical variables take T or F (chkvars_in_string: list_logicals). */
export const isAbinitLogicalVariable = (v: AbinitVariable) => v.type === 'logical';

export const isAbinitArray = (v: AbinitVariable) => v.dims.length > 0;

/** The physical dimension ABINIT converts units for, from the characteristics of the variable. */
export type AbinitUnitClass = 'energy' | 'length' | 'field' | 'time';
export const abinitUnitClassOf = (v: AbinitVariable): AbinitUnitClass | undefined =>
  v.characteristics.includes('energy') ? 'energy' : v.characteristics.includes('length') ? 'length' : v.characteristics.includes('magnetic_field') ? 'field' : undefined;

/**
 * Words ABINIT accepts after the values of a variable as units (doc/guide/abinit.md, "More about ABINIT input
 * variables", and `inarray` in src/42_parser/m_parser.F90). `none` units are read but do not change the value:
 * the parser works in atomic units anyway.
 */
export const ABINIT_UNIT_WORDS: Record<string, AbinitUnitClass | 'none'> = {
  ha: 'none', hartree: 'none', hartrees: 'none', au: 'none', bohr: 'none', bohrs: 'none',
  ry: 'energy', rydberg: 'energy', rydbergs: 'energy', ev: 'energy', mev: 'energy', k: 'energy', kelvin: 'energy',
  ang: 'length', angstr: 'length', angstrom: 'length', angstroms: 'length', nm: 'length',
  t: 'field', tesla: 'field', te: 'field',
  s: 'time', sec: 'time', second: 'time', seconds: 'time', as: 'time', asec: 'time', asecond: 'time', ps: 'time', psec: 'time', psecond: 'time', fs: 'time', fsec: 'time',
};

export interface AbinitWordParts {
  /** The letters (and inner digits/underscores) up to the last letter: the variable name as written. */
  base: string;
  /** What follows the last letter: dataset digits, `?`, `:`, `+`, `*`. */
  suffix: string;
}

/** ABINIT (chkvars_in_string) cuts a word back to its last letter: `ecut?1` → `ecut`, `xred2` → `xred`. */
export function splitAbinitWord(word: string): AbinitWordParts {
  let end = word.length;
  while (end > 0 && !/[A-Za-z]/.test(word[end - 1])) end--;
  return { base: word.slice(0, end), suffix: word.slice(end) };
}

export type AbinitSuffixKind =
  | { kind: 'plain' }
  /** ecut1 */
  | { kind: 'dataset'; index: number }
  /** ecut?1 (units digit) or ecut1? (tens) */
  | { kind: 'wild'; unit?: number; tens?: number }
  /** ecut: ecut+ ecut*, also with ? on either side (ecut?: ecut:?) */
  | { kind: 'series'; op: ':' | '+' | '*'; where: 'ds' | 'units' | 'tens' }
  /** Something ABINIT never matches. */
  | { kind: 'invalid' };

export function parseAbinitSuffix(suffix: string): AbinitSuffixKind {
  if (suffix === '') return { kind: 'plain' };
  let m = /^(\d{1,4})$/.exec(suffix);
  if (m) return { kind: 'dataset', index: Number(m[1]) };
  m = /^\?(\d)$/.exec(suffix);
  if (m) return { kind: 'wild', unit: Number(m[1]) };
  m = /^(\d+)\?$/.exec(suffix);
  if (m) return { kind: 'wild', tens: Number(m[1]) };
  m = /^([:+*])$/.exec(suffix);
  if (m) return { kind: 'series', op: m[1] as ':' | '+' | '*', where: 'ds' };
  m = /^\?([:+*])$/.exec(suffix);
  if (m) return { kind: 'series', op: m[1] as ':' | '+' | '*', where: 'units' };
  m = /^([:+*])\?$/.exec(suffix);
  if (m) return { kind: 'series', op: m[1] as ':' | '+' | '*', where: 'tens' };
  return { kind: 'invalid' };
}

/**
 * The variable a word names, with the `img` / `lastimg` image suffix of the variables that take one
 * (ABINIT accepts xredimg, acell_lastimg, … for the variables in its image list).
 */
export function abinitVariableOfWord(base: string): { variable: AbinitVariable; image: boolean } | undefined {
  const v = lookupAbinitVariable(base);
  if (v) return { variable: v, image: false };
  // chkvars_in_string: drop LASTIMG / IMG, then the digits and underscores in front of it (occ_1img, xcart_lastimg)
  const m = /^(.*?[A-Za-z])[^A-Za-z]*(?:lastimg|img)$/i.exec(base);
  const w = m && lookupAbinitVariable(m[1]);
  return w ? { variable: w, image: true } : undefined;
}

/** Strings that ABINIT reads as quoted keywords (intagm with 'KEY' in src/57_iovars): the quotes are mandatory. */
export const ABINIT_QUOTED_STRINGS = new Set([
  'geoopt', 'moldyn', 'structure', 'pseudos', 'pp_dirpath', 'xcname', 'write_files', 'wfk_task', 'gwr_task', 'gstore_gname', 'gstore_kfilter', 'gstore_kzone', 'gstore_qzone',
  'eph_fix_korq', 'vpq_aseed', 'vpq_pkind', 'dmft_orbital_filepath',
  'get1wf_filepath', 'getabiwan_filepath', 'getddb_filepath', 'getden_filepath', 'getdrhodb_filepath', 'getdvdb_filepath', 'getgstore_filepath', 'getgwan_filepath',
  'getkerange_filepath', 'getpot_filepath', 'getqpdata_filepath', 'getscr_filepath', 'getsigeph_filepath', 'getvpq_filepath', 'getwfk_filepath', 'getwfkfine_filepath',
  'getwfmq_filepath', 'getwfq_filepath',
]);
