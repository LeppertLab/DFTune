// Every tag name VASP is known to read, beyond the curated TAG_DEFS: the full INCAR tag list of
// the VASP wiki (generated, with its redirects as aliases) plus the widely used VTST and VASPsol
// patches. Used to tell "valid but uncommon" tags apart from typos, and to give them at least a
// one-line description.

import { tagDef } from './definitions';
import type { Category, TagDef, TagType } from './schema';
import { WIKI_ALIASES, WIKI_TAGS } from './wikiTags.generated';

export interface KnownTag {
  /** Name as written in the INCAR (upper case). */
  name: string;
  /** Wiki page that documents it (LIBXC1_P2 → LIBXC1_Pn); undefined for patch tags. */
  page?: string;
  /** For older or alternative names: the tag the wiki documents instead (ML_FF_LMLFF → ML_LMLFF). */
  aliasOf?: string;
  /** 'vtst' and 'vaspsol' tags are only read by VASP builds with that patch. */
  source: 'vasp' | 'vtst' | 'vaspsol';
  summary: string;
  type?: string;
  default?: string;
  /** Category derived from the wiki's page categories (VTST: ionic, VASPsol: electronic). */
  category?: Category;
  /** The wiki's deprecation note, if the tag is deprecated. */
  deprecated?: string;
}

// VTST Tools (https://theory.cm.utexas.edu/vtsttools/): NEB, dimer, optimizers. Only read by a
// VASP built with the VTST patch; standard VASP ignores them.
const VTST_TAGS: Record<string, string> = {
  ICHAIN: 'VTST: method (0 NEB, 1 dynamical matrix, 2 dimer, 3 Lanczos).',
  LCLIMB: 'VTST: climbing-image NEB.',
  LTANGENTOLD: 'VTST: use the old central-difference NEB tangent.',
  LDNEB: 'VTST: doubly nudged elastic band.',
  LNEBCELL: 'VTST: solid-state NEB (images may change their cell).',
  JACOBIAN: 'VTST: weight of cell vs. atomic degrees of freedom in solid-state NEB.',
  IOPT: 'VTST: optimizer (0 VASP IBRION, 1 LBFGS, 2 CG, 3 QM, 4 SD, 7 FIRE); use with IBRION = 3, POTIM = 0.',
  MAXMOVE: 'VTST: maximum step size of the VTST optimizers.',
  ILBFGSMEM: 'VTST: number of steps kept in LBFGS memory.',
  LGLOBAL: 'VTST: optimize the NEB globally rather than image by image.',
  LAUTOSCALE: 'VTST: automatically determine INVCURV.',
  INVCURV: 'VTST: initial inverse curvature for LBFGS.',
  LLINEOPT: 'VTST: force-based line minimizer for LBFGS.',
  FDSTEP: 'VTST: finite-difference step for the CG/LBFGS curvature.',
  TIMESTEP: 'VTST: dynamical time step for the QM and FIRE optimizers.',
  SDALPHA: 'VTST: step size of the steepest-descent optimizer.',
  FTIMEMAX: 'VTST: FIRE maximum time step.',
  FTIMEDEC: 'VTST: FIRE time-step decrease factor.',
  FTIMEINC: 'VTST: FIRE time-step increase factor.',
  FALPHA: 'VTST: FIRE initial velocity-mixing parameter.',
  FNMIN: 'VTST: FIRE minimum steps before the time step grows.',
  DDR: 'VTST: dimer separation.',
  DROTMAX: 'VTST: maximum dimer rotations per step.',
  DFNMIN: 'VTST: rotational force below which the dimer stops rotating.',
  DFNMAX: 'VTST: rotational force below which the dimer rotates only once.',
};

// VASPsol implicit solvation (https://github.com/henniggroup/VASPsol).
const VASPSOL_TAGS: Record<string, string> = {
  LSOL: 'VASPsol: switch on the implicit solvation model (water by default).',
  EB_K: 'VASPsol: relative permittivity of the solvent (78.4 for water).',
  TAU: 'VASPsol: surface tension for the cavitation energy (0 neglects it).',
  LAMBDA_D_K: 'VASPsol: Debye length in Å; switches on the linearized Poisson–Boltzmann electrolyte.',
  NC_K: 'VASPsol: critical density at which the dielectric cavity forms.',
  SIGMA_K: 'VASPsol: width of the dielectric cavity.',
  LRHOB: 'VASPsol: write the bound charge density to RHOB.',
  LRHOION: 'VASPsol: write the ionic charge density to RHOION.',
};

/** Wiki pages that document a family of numbered tags. */
const PATTERNS: [RegExp, string][] = [
  [/^LIBXC1_P\d+$/, 'LIBXC1_Pn'],
  [/^LIBXC2_P\d+$/, 'LIBXC2_Pn'],
  [/^XC\d+_P\d+$/, 'XCm_Pn'],
];

const WIKI_BY_UPPER = new Map(Object.keys(WIKI_TAGS).map((page) => [page.toUpperCase(), page]));

/** Category of any tag: curated definition first, then the wiki's; undefined when neither fits. */
export function tagCategory(name: string): Category | undefined {
  return tagDef(name)?.category ?? knownTag(name)?.category;
}

/** What is known about a tag outside the curated definitions, or undefined for an unknown name. */
export function knownTag(name: string): KnownTag | undefined {
  const upper = name.toUpperCase();
  const page = WIKI_BY_UPPER.get(upper) ?? PATTERNS.find(([re]) => re.test(upper))?.[1];
  if (page) {
    const [summary, type, def, category, deprecated] = WIKI_TAGS[page];
    return { name: upper, page, source: 'vasp', summary, type: type || undefined, default: def || undefined, category: category || undefined, deprecated };
  }
  if (VTST_TAGS[upper]) return { name: upper, source: 'vtst', summary: VTST_TAGS[upper], category: 'ionic' };
  if (VASPSOL_TAGS[upper]) return { name: upper, source: 'vaspsol', summary: VASPSOL_TAGS[upper], category: 'electronic' };
  const target = WIKI_ALIASES[upper];
  if (target) {
    const [summary, , , category] = WIKI_TAGS[target];
    return { name: upper, page: target, aliasOf: target, source: 'vasp', summary, category: category || undefined };
  }
  return undefined;
}

/**
 * Value type implied by the wiki's free-text type ("logical", "real array", "0 | 1 | 2"…), for
 * checking values of tags without a curated definition. Undefined when it is not clear-cut.
 */
export function wikiValueType(type: string | undefined): TagType | undefined {
  const t = type?.trim().toLowerCase();
  if (!t) return undefined;
  if (t === 'real' || t === 'positive real') return 'real';
  if (t === 'integer' || /^-?\d+(\s*\|\s*-?\d+)+$/.test(t)) return 'int';
  if (t === 'logical' || /^\.(true|false)\.\s*\|\s*\.(true|false)\.?$/.test(t)) return 'bool';
  // "real (array)": a single value or one per species/atom.
  if (t === 'real array' || t === 'real (array)') return 'realArray';
  if (t === 'integer array' || t === 'array of three integers') return 'intArray';
  return undefined;
}

/**
 * A definition built from the wiki data, for tags without a curated one: enough for a typed field,
 * a placeholder and a category. Undefined for unknown tags.
 */
export function fallbackDef(name: string): TagDef | undefined {
  const known = knownTag(name);
  if (!known) return undefined;
  const literal = known.default && /^(-?[\d.]+([eEdD][-+]?\d+)?|\.(TRUE|FALSE)\.)$/i.test(known.default);
  return {
    name: known.name,
    type: wikiValueType(known.type) ?? 'string',
    category: known.category ?? 'electronic',
    summary: known.summary,
    ...(literal ? { default: known.default } : { defaultNote: known.default }),
  };
}

/** Group prefixes of nested tags (KERNEL_TRUNCATION for KERNEL_TRUNCATION/LTRUNCATE). */
export function tagGroup(name: string): string | undefined {
  const slash = name.lastIndexOf('/');
  return slash > 0 ? name.slice(0, slash).toUpperCase() : undefined;
}

/** Documented tags of a group, e.g. all KERNEL_TRUNCATION/… tags on the wiki. */
export function groupTags(group: string): string[] {
  const prefix = `${group.toUpperCase()}/`;
  return KNOWN_TAG_NAMES.filter((n) => n.startsWith(prefix));
}

export function isKnownTag(name: string): boolean {
  return !!tagDef(name) || !!knownTag(name);
}

/** Current tag names (wiki, VTST, VASPsol; not aliases), for typo suggestions and completion. */
export const KNOWN_TAG_NAMES: readonly string[] = [
  ...new Set(
    [...WIKI_BY_UPPER.keys(), ...Object.keys(VTST_TAGS), ...Object.keys(VASPSOL_TAGS)].filter((n) => !PATTERNS.some(([, page]) => page.toUpperCase() === n)),
  ),
];
