// Lookup of CASTEP cell and param keywords, generated from the CASTEP community documentation
// (castep-docs, see keywords.generated.ts). CASTEP reads keywords case-insensitively and knows several
// spellings of some (KPOINT_ and KPOINTS_, BS_KPOINT_ and SPECTRAL_KPOINT_ …), which are resolved here.
//
// The documentation is not a complete keyword reference, so a keyword missing from the table is not
// necessarily one CASTEP rejects.

import { CASTEP_ALIASES, CASTEP_CELL_DEFS, CASTEP_DOCS_COMMIT, CASTEP_EXCLUSIVE, CASTEP_PARAM_DEFS, CASTEP_PREFIX_ALIASES, type CastepKeywordRow } from './keywords.generated';

export { CASTEP_DOCS_COMMIT, CASTEP_EXCLUSIVE };

export const CASTEP_FILES = ['cell', 'param'] as const;
export type CastepFile = (typeof CASTEP_FILES)[number];

export interface CastepKeyword {
  /** The name as the documentation writes it. */
  name: string;
  file: CastepFile;
  kind: 'keyword' | 'block';
  /** `logical`, `integer`, `real`, `physical` (a number with an optional unit), `string`, `defined` (a flag), `integer-vector`, `real-vector`, `block`, or empty when the docs do not say. */
  type: string;
  /** A default, only where the documentation states one. */
  default: string;
  unit: string;
  doc: string;
  /** A closed list of values, where the documentation gives one. */
  options: string[];
  /** Values the documentation uses in examples (not a closed list). */
  examples: string[];
  /** The documentation page, relative to docs/. */
  source: string;
}

const DEFS: Record<CastepFile, Record<string, CastepKeywordRow>> = { cell: CASTEP_CELL_DEFS, param: CASTEP_PARAM_DEFS };

const toKeyword = (file: CastepFile, r: CastepKeywordRow): CastepKeyword => ({
  name: r[0],
  file,
  kind: r[1] === 'block' ? 'block' : 'keyword',
  type: r[1],
  default: r[2],
  unit: r[3],
  doc: r[4],
  options: r[5],
  examples: r[6],
  source: r[7],
});

/** The one lower-case spelling of a keyword name: prefix and spelling synonyms resolved. */
export function canonicalCastepName(name: string): string {
  let n = name.toLowerCase();
  for (const [from, to] of CASTEP_PREFIX_ALIASES) {
    if (n.startsWith(from)) {
      n = to + n.slice(from.length);
      break;
    }
  }
  return CASTEP_ALIASES[n] ?? n;
}

const cache = new Map<CastepFile, Map<string, CastepKeyword>>();
function table(file: CastepFile): Map<string, CastepKeyword> {
  let t = cache.get(file);
  if (!t) {
    t = new Map(Object.entries(DEFS[file]).map(([k, r]) => [k, toKeyword(file, r)]));
    cache.set(file, t);
  }
  return t;
}

export const castepKeywordsOf = (file: CastepFile): CastepKeyword[] => [...table(file).values()];

/** The documented keyword or block, whatever its case and spelling variant. */
export const lookupCastepKeyword = (file: CastepFile, name: string): CastepKeyword | undefined => table(file).get(canonicalCastepName(name));

/** Every name the table knows, in the case of the docs. */
export const allCastepKeywordNames = (file: CastepFile): string[] => castepKeywordsOf(file).map((k) => k.name);

export const castepDocsUrl = (source: string): string => `https://castep-docs.github.io/castep-docs/${source.replace(/\.(md|cell|param)$/, '/')}`;

/** Which file type a path is: `<seed>.cell` or `<seed>.param`. */
export function castepFileOf(fileName: string): CastepFile | undefined {
  const m = fileName.toLowerCase().match(/\.(cell|param)$/);
  return m ? (m[1] as CastepFile) : undefined;
}

/** The seed of an input: the file name without `.cell` or `.param`. */
export const castepSeed = (fileName: string): string => (fileName.split('/').pop() ?? fileName).replace(/\.(cell|param)$/i, '');
