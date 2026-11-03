// Checks on an INCAR, shared by the Problems panel and the builder.

import type { IncarDoc, Span } from '../incar/parse';
import { meshSize, type KpointsInfo } from '../kpoints/read';
import { expandArray, parseBool, parseInt_, parseReal } from '../incar/values';
import { effective, tagReader, type TagReader } from '../intents/reader';
import type { PoscarInfo } from '../poscar/read';
import { TAGS, tagDef } from '../tags/definitions';
import { KNOWN_TAG_NAMES, knownTag, wikiValueType } from '../tags/known';
import type { TagDef } from '../tags/schema';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  /** Tag the diagnostic is about; the span then defaults to that tag's statement. */
  tag?: string;
  span?: Span;
}

export interface ValidationContext {
  poscar?: PoscarInfo;
  /** The KPOINTS file next to the INCAR; null when there is none, undefined when not looked up. */
  kpoints?: KpointsInfo | null;
}

export function validate(doc: IncarDoc, ctx: ValidationContext = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  // VASP skips lines it can't make sense of, so the tag is silently not set: a warning, not an error.
  for (const issue of doc.issues) out.push({ code: 'syntax', severity: 'warning', message: issue.message, span: issue.span });
  checkTags(doc, out);
  const r = tagReader(doc);
  for (const rule of RULES) rule(r, ctx, out);
  // Attach spans for tag-level diagnostics.
  for (const d of out) {
    if (!d.span && d.tag) d.span = doc.tags.get(d.tag)?.span;
  }
  return out;
}

function checkTags(doc: IncarDoc, out: Diagnostic[]) {
  const seen = new Set<string>();
  for (const e of doc.entries) {
    if (seen.has(e.key)) {
      out.push({ code: 'duplicate', severity: 'warning', message: `${e.key} is set more than once; VASP uses only one of the values.`, span: e.span });
      continue;
    }
    seen.add(e.key);
    const def = tagDef(e.key);
    const known = knownTag(e.key);
    if (known?.deprecated) {
      out.push({ code: 'deprecated', severity: 'warning', message: `${e.key} is deprecated: ${known.deprecated}`, span: e.keySpan });
    }
    if (known?.aliasOf) {
      out.push({ code: 'alias', severity: 'info', message: `${e.key} is an older or alternative name for ${known.aliasOf}; check that your VASP version still reads it.`, span: e.keySpan });
    }
    if (!def && known) {
      // Uncurated tags: check the value against the type the wiki states, when it is clear-cut.
      const type = wikiValueType(known.type);
      const problem = type && checkValue({ name: known.name, type, category: known.category ?? 'electronic', summary: '' }, e.value);
      if (problem) out.push({ code: 'bad-value', severity: 'error', message: `${e.key}: ${problem}`, span: e.valueSpan.start === e.valueSpan.end ? e.span : e.valueSpan });
      continue;
    }
    if (!def) {
      // VASP silently ignores tags it doesn't know, so a typo quietly changes the calculation.
      const close = closestTag(e.key);
      out.push(
        close
          ? { code: 'unknown-tag', severity: 'warning', message: `Unknown tag ${e.key}. Did you mean ${close}?`, span: e.keySpan }
          : { code: 'unknown-tag', severity: 'info', message: `${e.key} is not a documented VASP tag; VASP ignores tags it does not know.`, span: e.keySpan },
      );
      continue;
    }
    const span = e.valueSpan.start === e.valueSpan.end ? e.span : e.valueSpan;
    // A value VASP cannot read stops it ("Error reading item"); a readable value outside the
    // documented options may still run, so that is only a warning.
    const unreadable = checkValue({ ...def, open: true }, e.value);
    const unlisted = !unreadable && checkValue(def, e.value);
    if (unreadable) out.push({ code: 'bad-value', severity: 'error', message: `${e.key}: ${unreadable}`, span });
    else if (unlisted) out.push({ code: 'unknown-option', severity: 'warning', message: `${e.key}: ${unlisted}`, span });
  }
}

/** Why `value` is not a valid value for `def`, or undefined if it is. */
export function checkValue(def: TagDef, value: string): string | undefined {
  if (value === '') return 'missing value';
  switch (def.type) {
    case 'int':
      if (parseInt_(value) === undefined) return `expected an integer, got '${value}'`;
      break;
    case 'real':
      if (parseReal(value) === undefined) return `expected a number, got '${value}'`;
      break;
    case 'bool':
      if (parseBool(value) === undefined) return `expected .TRUE. or .FALSE., got '${value}'`;
      return undefined;
    case 'intArray':
    case 'realArray': {
      const items = expandArray(value);
      if (!items) return `malformed repeat (use N*value), got '${value}'`;
      const parse = def.type === 'intArray' ? parseInt_ : parseReal;
      const bad = items.find((x) => parse(x) === undefined);
      if (bad !== undefined) return `'${bad}' is not ${def.type === 'intArray' ? 'an integer' : 'a number'}`;
      return undefined;
    }
  }
  if (def.options && !def.open) {
    const ok = def.options.some((o) => sameValue(def, o.value, value));
    if (!ok) return `'${value}' is not one of ${def.options.map((o) => o.value).join(', ')}`;
  }
  return undefined;
}

export function sameValue(def: TagDef, a: string, b: string): boolean {
  switch (def.type) {
    case 'int':
    case 'real': {
      const x = parseReal(a);
      const y = parseReal(b);
      return x !== undefined && y !== undefined ? x === y : a.trim().toUpperCase() === b.trim().toUpperCase();
    }
    case 'bool':
      return parseBool(a) === parseBool(b);
    default: {
      // LREAL mixes logicals and keywords: .TRUE. ≡ T ≡ On.
      const norm = (s: string) => {
        const bool = parseBool(s);
        if (bool !== undefined) return bool ? 'TRUE' : 'FALSE';
        const u = s.trim().toUpperCase();
        return u === 'ON' || u === 'R' ? 'TRUE' : u === 'A' ? 'AUTO' : u;
      };
      return norm(a) === norm(b);
    }
  }
}

/** Too few values stop VASP while reading the INCAR; extra values are silently ignored. */
function lengthSeverity(actual: number, expected: number): { severity: Severity } {
  return { severity: actual < expected ? 'error' : 'warning' };
}

function closestTag(key: string): string | undefined {
  let best: string | undefined;
  let bestDist = key.length > 5 ? 2 : 1;
  // Curated (common) tags first, so they win ties against rarely used ones.
  for (const name of [...TAGS.keys(), ...KNOWN_TAG_NAMES]) {
    if (Math.abs(name.length - key.length) > bestDist) continue;
    const d = editDistance(key, name);
    if (d > 0 && (best ? d < bestDist : d <= bestDist)) {
      best = name;
      bestDist = d;
    }
  }
  return best;
}

/** Edit distance counting a swap of adjacent letters as one edit (ENCTU → ENCUT). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

type Rule = (r: TagReader, ctx: ValidationContext, out: Diagnostic[]) => void;

const RULES: Rule[] = [
  // NSW > 0 without IBRION silently runs molecular dynamics.
  (r, _ctx, out) => {
    if (effective.nsw(r) > 0 && !r.has('IBRION')) {
      out.push({ code: 'nsw-without-ibrion', severity: 'warning', tag: 'NSW', message: 'NSW > 0 without IBRION: VASP defaults to IBRION = 0, i.e. molecular dynamics. Set IBRION = 1/2/3 for a relaxation.' });
    }
  },
  // MD needs a time step and a temperature.
  (r, _ctx, out) => {
    if (!effective.isMD(r) || r.bool('ML_LMLFF') && r.str('ML_MODE') === 'SELECT') return;
    if (!r.has('POTIM')) out.push({ code: 'md-potim', severity: 'warning', tag: 'IBRION', message: 'Molecular dynamics: set POTIM (time step in fs, ~0.5–2).' });
    if (!r.has('TEBEG')) out.push({ code: 'md-tebeg', severity: 'warning', tag: 'IBRION', message: 'Molecular dynamics: TEBEG (temperature) defaults to 0 K.' });
    if ((r.num('ISYM') ?? 2) !== 0) out.push({ code: 'md-isym', severity: 'info', tag: 'IBRION', message: 'Symmetry is usually switched off for MD (ISYM = 0).' });
    if (r.num('MDALGO') === 3 && !r.has('LANGEVIN_GAMMA')) {
      out.push({ code: 'md-langevin', severity: 'warning', tag: 'MDALGO', message: 'Langevin thermostat (MDALGO = 3) needs LANGEVIN_GAMMA, one value per species.' });
    }
  },
  // ISIF without ionic steps.
  (r, _ctx, out) => {
    const isif = r.num('ISIF');
    if (isif !== undefined && isif >= 3 && effective.nsw(r) === 0 && !effective.isPhonon(r)) {
      out.push({ code: 'isif-static', severity: 'info', tag: 'ISIF', message: `ISIF = ${isif} has no effect without ionic steps (NSW = 0).` });
    }
  },
  // Pulay stress in cell relaxations.
  (r, _ctx, out) => {
    const isif = effective.isif(r);
    if ((effective.isRelaxation(r) || effective.isMD(r)) && [3, 6, 7, 8].includes(isif) && !r.has('ENCUT')) {
      out.push({ code: 'pulay', severity: 'warning', tag: 'ISIF', message: 'Volume changes with the default ENCUT suffer from Pulay stress: set ENCUT ≈ 1.3 × ENMAX of the POTCAR.' });
    }
  },
  // Smearing choices.
  (r, _ctx, out) => {
    const ismear = effective.ismear(r);
    if (ismear === -5 && (effective.isRelaxation(r) || effective.isMD(r))) {
      out.push({ code: 'tetra-forces', severity: 'warning', tag: 'ISMEAR', message: 'ISMEAR = -5 forces are not variational for metals: use ISMEAR = 0 or 1 for relaxations and MD.' });
    }
    if (ismear > 0 && !r.has('ISMEAR')) {
      out.push({ code: 'default-mp', severity: 'info', span: { start: 0, end: 0 }, message: 'ISMEAR defaults to 1 (Methfessel–Paxton), which is wrong for semiconductors and insulators. Set ISMEAR explicitly.' });
    }
    const sigma = r.num('SIGMA');
    if (ismear > 0 && sigma !== undefined && sigma > 0.3) {
      out.push({ code: 'large-sigma', severity: 'info', tag: 'SIGMA', message: 'SIGMA > 0.3 eV with Methfessel–Paxton: check that the entropy term T·S is below ~1 meV/atom.' });
    }
  },
  // Functional consistency.
  (r, _ctx, out) => {
    if (r.has('METAGGA') && r.str('METAGGA') !== 'MBJ' && r.bool('LASPH') !== true) {
      out.push({ code: 'metagga-lasph', severity: 'warning', tag: 'METAGGA', message: 'Meta-GGAs need LASPH = .TRUE. for accurate results.' });
    }
    if (r.has('METAGGA') && r.has('GGA')) {
      out.push({ code: 'gga-and-metagga', severity: 'warning', tag: 'GGA', message: 'Both GGA and METAGGA are set; specify the functional with one of them (or with XC).' });
    }
    if ((r.has('HFSCREEN') || r.has('AEXX')) && r.bool('LHFCALC') !== true) {
      out.push({ code: 'hybrid-off', severity: 'warning', tag: r.has('HFSCREEN') ? 'HFSCREEN' : 'AEXX', message: 'Hybrid parameters have no effect without LHFCALC = .TRUE.' });
    }
    if (r.bool('LHFCALC') && r.str('ALGO') === 'VERYFAST') {
      out.push({ code: 'hybrid-algo', severity: 'warning', tag: 'ALGO', message: 'RMM-DIIS (ALGO = VeryFast) is not suitable for hybrid functionals; use Normal, All or Damped.' });
    }
  },
  // Magnetism.
  (r, ctx, out) => {
    const nc = effective.noncollinear(r);
    if (r.has('MAGMOM') && effective.ispin(r) !== 2 && !nc) {
      out.push({ code: 'magmom-unused', severity: 'warning', tag: 'MAGMOM', message: 'MAGMOM is ignored unless ISPIN = 2 or LNONCOLLINEAR = .TRUE.' });
    }
    if (r.bool('LSORBIT') && r.has('ISPIN')) {
      out.push({ code: 'soc-ispin', severity: 'hint', tag: 'ISPIN', message: 'ISPIN is ignored with LSORBIT (spin–orbit is always noncollinear).' });
    }
    const magmom = r.array('MAGMOM');
    if (magmom && ctx.poscar && (effective.ispin(r) === 2 || nc)) {
      const expected = ctx.poscar.nions * (nc ? 3 : 1);
      if (magmom.length !== expected) {
        out.push({
          code: 'magmom-length',
          ...lengthSeverity(magmom.length, expected),
          tag: 'MAGMOM',
          message: `MAGMOM has ${magmom.length} values; POSCAR has ${ctx.poscar.nions} atoms, so ${expected} are needed${nc ? ' (3 per atom)' : ''}.`,
        });
      }
    }
  },
  // Per-species arrays.
  (r, ctx, out) => {
    if (!ctx.poscar) return;
    const ntyp = ctx.poscar.counts.length;
    for (const def of TAGS.values()) {
      if (!def.perSpecies) continue;
      if (def.category === 'ldau' && r.bool('LDAU') !== true) continue;
      const items = r.array(def.name);
      if (items && items.length !== ntyp) {
        out.push({ code: 'species-length', ...lengthSeverity(items.length, ntyp), tag: def.name, message: `${def.name} has ${items.length} values; POSCAR has ${ntyp} species${ctx.poscar.species ? ` (${ctx.poscar.species.join(' ')})` : ''}.` });
      }
    }
  },
  // DFT+U.
  (r, _ctx, out) => {
    if (r.bool('LDAU') !== true) {
      if (r.has('LDAUU')) out.push({ code: 'ldau-off', severity: 'warning', tag: 'LDAUU', message: 'LDAUU has no effect without LDAU = .TRUE.' });
      return;
    }
    if (!r.has('LDAUL') || !r.has('LDAUU')) {
      out.push({ code: 'ldau-incomplete', severity: 'warning', tag: 'LDAU', message: 'LDAU = .TRUE. needs LDAUL and LDAUU (and LDAUJ for LDAUTYPE = 1).' });
    }
    const maxL = Math.max(-1, ...(r.array('LDAUL') ?? []).map(Number).filter(Number.isFinite));
    const needed = maxL >= 3 ? 6 : maxL === 2 ? 4 : 0;
    if (needed && (r.num('LMAXMIX') ?? 2) < needed) {
      out.push({ code: 'ldau-lmaxmix', severity: 'warning', tag: 'LDAU', message: `Set LMAXMIX = ${needed} for ${needed === 6 ? 'f' : 'd'} electrons; otherwise the +U occupations are lost when restarting from CHGCAR.` });
    }
  },
  // Non-SCF runs.
  (r, _ctx, out) => {
    if (r.num('ICHARG') === 11 && effective.nsw(r) > 0) {
      out.push({ code: 'nonscf-ionic', severity: 'warning', tag: 'ICHARG', message: 'ICHARG = 11 keeps the density fixed; it cannot be combined with ionic steps.' });
    }
  },
  // Parallelization.
  (r, _ctx, out) => {
    if (r.has('NCORE') && r.has('NPAR')) {
      out.push({ code: 'ncore-npar', severity: 'warning', tag: 'NCORE', message: 'NCORE and NPAR are both set; NPAR takes precedence.' });
    }
  },
  // Real-space projection for large cells.
  (r, ctx, out) => {
    if (ctx.poscar && ctx.poscar.nions > 20 && !r.has('LREAL')) {
      out.push({ code: 'lreal-large', severity: 'hint', span: { start: 0, end: 0 }, message: `${ctx.poscar.nions} atoms: LREAL = Auto is usually much faster at negligible cost in accuracy.` });
    }
  },
  // Phonons and linear response.
  (r, _ctx, out) => {
    const ibrion = effective.ibrion(r);
    if (effective.isPhonon(r) && (r.num('EDIFF') ?? 1e-4) > 1e-6) {
      out.push({ code: 'phonon-ediff', severity: 'warning', tag: 'IBRION', message: `IBRION = ${ibrion} needs accurate forces: set EDIFF = 1E-6 or tighter (default 1E-4).` });
    }
    if (ibrion === 5 || ibrion === 7) {
      out.push({ code: 'phonon-symmetry', severity: 'info', tag: 'IBRION', message: `IBRION = ${ibrion} ignores symmetry and is deprecated: IBRION = ${ibrion + 1} gives the same result, often much faster.` });
    }
    if (r.bool('LEPSILON') && r.bool('LHFCALC')) {
      out.push({ code: 'lepsilon-hybrid', severity: 'warning', tag: 'LEPSILON', message: 'LEPSILON does not support hybrid functionals: use LOPTICS or LCALCEPS instead.' });
    }
    if (r.bool('LEPSILON') && r.bool('LOPTICS')) {
      out.push({ code: 'lepsilon-loptics', severity: 'warning', tag: 'LOPTICS', message: 'LEPSILON and LOPTICS together are not recommended: run them separately.' });
    }
    if (r.bool('LOPTICS') && effective.ismear(r) === -2) {
      out.push({ code: 'loptics-ismear', severity: 'warning', tag: 'ISMEAR', message: 'LOPTICS does not support ISMEAR = -2.' });
    }
  },
  // k points: KPOINTS file vs. KSPACING.
  (r, ctx, out) => {
    if (ctx.kpoints && r.has('KSPACING')) {
      out.push({ code: 'kspacing-ignored', severity: 'warning', tag: 'KSPACING', message: 'KSPACING is ignored: VASP takes the k points from the KPOINTS file when there is one.' });
    }
    if (ctx.kpoints === null && !r.has('KSPACING')) {
      out.push({ code: 'no-kpoints', severity: 'info', span: { start: 0, end: 0 }, message: 'No KPOINTS file: VASP generates a mesh from the default KSPACING = 0.5 Å⁻¹. Set KSPACING explicitly or add a KPOINTS file.' });
    }
    if (ctx.kpoints?.mode === 'line' && r.num('ICHARG') !== 11) {
      out.push({ code: 'line-mode-scf', severity: 'warning', span: { start: 0, end: 0 }, message: 'The KPOINTS file is in line mode, which is meant for non-self-consistent band structures (ICHARG = 11).' });
    }
  },
  // Tetrahedron methods need a Γ-centred mesh with enough k points.
  (r, ctx, out) => {
    if (![-4, -5, -14, -15].includes(effective.ismear(r))) return;
    const k = ctx.kpoints;
    if (k?.mode === 'mesh' && k.centering === 'monkhorst-pack') {
      out.push({ code: 'tetra-mesh', severity: 'warning', tag: 'ISMEAR', message: 'Tetrahedron methods need a Γ-centred mesh, but KPOINTS uses Monkhorst–Pack.' });
    }
    if (k === null && r.bool('KGAMMA') === false) {
      out.push({ code: 'tetra-mesh', severity: 'warning', tag: 'KGAMMA', message: 'Tetrahedron methods need a Γ-centred mesh: remove KGAMMA = .FALSE.' });
    }
    const n = k ? meshSize(k) : undefined;
    if (n !== undefined && n < 4) {
      out.push({ code: 'tetra-few-k', severity: 'error', tag: 'ISMEAR', message: `The tetrahedron method needs at least 4 k points; KPOINTS has ${n}. Use ISMEAR = 0 for small meshes.` });
    }
  },
];
