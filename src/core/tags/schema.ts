export type TagType = 'int' | 'real' | 'bool' | 'string' | 'intArray' | 'realArray';

export type Category =
  | 'flow'
  | 'electronic'
  | 'smearing'
  | 'xc'
  | 'vdw'
  | 'spin'
  | 'ldau'
  | 'ionic'
  | 'md'
  | 'response'
  | 'manybody'
  | 'mlff'
  | 'parallel';

/** Labels, in the order the builder and the formatter show the categories. */
export const CATEGORY_LABELS: Record<Category, string> = {
  electronic: 'Electronic structure',
  smearing: 'Occupations & smearing',
  xc: 'Exchange–correlation',
  vdw: 'van der Waals',
  spin: 'Magnetism & spin–orbit',
  ldau: 'DFT+U',
  ionic: 'Ionic relaxation',
  md: 'Molecular dynamics',
  response: 'Response properties',
  manybody: 'Many-body (GW, BSE, RPA)',
  mlff: 'Machine-learned force fields',
  parallel: 'Parallelization',
  flow: 'Flow control',
};

export interface TagOption {
  /** Value as written in the INCAR. Compared case-insensitively for strings. */
  value: string;
  label: string;
  description?: string;
}

export interface TagDef {
  name: string;
  type: TagType;
  category: Category;
  summary: string;
  /** Default as VASP 6 applies it, when it is a single fixed value. */
  default?: string;
  /** Human-readable default when it depends on other tags or on POTCAR. */
  defaultNote?: string;
  options?: TagOption[];
  /** For tags with options: whether values outside `options` are still valid. */
  open?: boolean;
  unit?: string;
  /** Array tags: expected length is the number of atoms (×3 if noncollinear). */
  perAtom?: boolean;
  /** Array tags: expected length is the number of species in POSCAR. */
  perSpecies?: boolean;
  /** Rarely changed: hidden in the builder unless "show advanced" is on or the tag is set. */
  advanced?: boolean;
}

export function wikiUrl(tag: string): string {
  return `https://vasp.at/wiki/${encodeURIComponent(tag).replace(/%2F/g, '/')}`;
}
