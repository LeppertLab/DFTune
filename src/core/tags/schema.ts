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

/** Fine-grained labels of the categories (the wiki topics a tag belongs to), for hovers. */
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

export type SectionId = 'calculation' | 'electronic' | 'xc' | 'spin' | 'smearing' | 'ldau' | 'manybody' | 'parallel' | 'flow';

/**
 * The sections of an INCAR: the one grouping used everywhere. The formatter writes one
 * `# Label` header per section, the builder shows its cards under the same headings in the same
 * order, and the tag table lists the same sections. A section collects several categories; inside
 * it the tags are sorted by category, then by definition.
 */
export const SECTIONS: { id: SectionId; label: string; categories: Category[] }[] = [
  { id: 'calculation', label: 'Calculation', categories: ['ionic', 'md', 'mlff', 'response'] },
  { id: 'electronic', label: 'Electronic structure', categories: ['electronic'] },
  { id: 'xc', label: 'Exchange–correlation', categories: ['xc', 'vdw'] },
  { id: 'spin', label: 'Magnetism & spin–orbit', categories: ['spin'] },
  { id: 'smearing', label: 'Occupations & smearing', categories: ['smearing'] },
  { id: 'ldau', label: 'DFT+U', categories: ['ldau'] },
  { id: 'manybody', label: 'Many-body (GW, BSE, RPA)', categories: ['manybody'] },
  { id: 'parallel', label: 'Parallelization', categories: ['parallel'] },
  { id: 'flow', label: 'Flow control & output', categories: ['flow'] },
];

export const SECTION_LABELS = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label])) as Record<SectionId, string>;

const SECTION_OF = new Map(SECTIONS.flatMap((s) => s.categories.map((c) => [c, s.id] as const)));

export const sectionOf = (category: Category): SectionId => SECTION_OF.get(category)!;

/** Position of a category in the INCAR order: its section first, then its place in the section. */
export const categoryRank = (category: Category): number => SECTIONS.findIndex((s) => s.id === sectionOf(category)) * 10 + SECTIONS.find((s) => s.id === sectionOf(category))!.categories.indexOf(category);

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
