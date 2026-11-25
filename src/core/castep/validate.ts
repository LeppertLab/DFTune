// Checks on a CASTEP cell or param file.
//
// Severity: an error is something CASTEP itself cannot read (a block that is not closed, a value that is
// not a number where the documentation says it is one, rows that do not have the documented layout, two
// keywords the documentation says exclude each other for the structure). A warning is a pitfall the
// documentation points out. The keyword table comes from the CASTEP community documentation, which is not
// a complete keyword reference (CASTEP has `castep -h all`): a keyword that is not in it is only a warning.
//
// Every rule names the page of the documentation it comes from (castep-docs, docs/ folder).

import type { Span } from '../incar/parse';
import type { Diagnostic, Fix } from '../validation/rules';
import { editDistance } from '../validation/rules';
import { checkCellBlocks, isCastepNumber, type Report } from './blocks';
import type { CastepDoc, CastepEntry } from './parse';
import { CASTEP_EXCLUSIVE, allCastepKeywordNames, canonicalCastepName, lookupCastepKeyword, type CastepFile } from './tags';

export interface CastepContext {
  /** The other file of the same seed (the .param next to a .cell, the .cell next to a .param), when found. */
  neighbor?: CastepDoc;
}

const LOGICAL = new Set(['t', 'f', 'true', 'false', '.true.', '.false.', 'yes', 'no', 'y', 'n', 'on', 'off', '1', '0']);
const isTrue = (v: string | undefined) => v !== undefined && ['t', 'true', '.true.', 'yes', 'y', 'on', '1'].includes(v.toLowerCase());
const isFalse = (v: string | undefined) => v !== undefined && ['f', 'false', '.false.', 'no', 'n', 'off', '0'].includes(v.toLowerCase());

/** The nearest documented keyword: edit distance 1 (2 for long names). */
export function closestCastepKeyword(file: CastepFile, name: string): string | undefined {
  const lower = name.toLowerCase();
  let best: string | undefined;
  let bestDist = lower.length > 8 ? 2 : 1;
  for (const n of allCastepKeywordNames(file)) {
    if (Math.abs(n.length - lower.length) > bestDist) continue;
    const d = editDistance(lower, n.toLowerCase());
    if (d > 0 && (best ? d < bestDist : d <= bestDist)) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

const rename = (to: string, span: Span): Fix => ({ title: `Change to ${to}`, edit: { start: span.start, end: span.end, text: to } });

/** The last entry of each keyword (canonical name): CASTEP uses one value. */
export const castepEntriesByName = (doc: CastepDoc): Map<string, CastepEntry> => new Map(doc.entries.map((e) => [canonicalCastepName(e.keyword), e]));
const valueOf = (m: Map<string, CastepEntry>, name: string) => m.get(name)?.args[0]?.text.toLowerCase();

export function validateCastep(doc: CastepDoc, file: CastepFile, ctx: CastepContext = {}): Diagnostic[] {
  const out: Diagnostic[] = [...doc.issues];
  const report: Report = (severity, code, message, span) => out.push({ severity, code, message, span });
  const reportFix = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Fix) => out.push({ severity, code, message, span, ...(fix && { fix }) });
  const other: CastepFile = file === 'cell' ? 'param' : 'cell';

  const seen = new Map<string, CastepEntry>();
  for (const e of doc.entries) {
    const name = canonicalCastepName(e.keyword);
    const k = lookupCastepKeyword(file, e.keyword);
    if (seen.has(name)) report('warning', 'castep-duplicate', `${e.keyword} is set more than once (also as ${seen.get(name)!.keyword}).`, e.keySpan);
    seen.set(name, e);
    if (!k) {
      const elsewhere = lookupCastepKeyword(other, e.keyword);
      if (elsewhere) report('warning', 'castep-wrong-file', `${e.keyword} is a keyword of the ${other} file (${elsewhere.source.split('/').pop()}), not of the ${file} file.`, e.keySpan);
      else {
        const close = closestCastepKeyword(file, e.keyword);
        reportFix('warning', 'castep-unknown-keyword', `${e.keyword} is not a keyword of the ${file} file in the CASTEP documentation${close ? `. Did you mean ${close}?` : ' (the documentation does not list every keyword; `castep -s <word>` searches the ones of your CASTEP).'}`, e.keySpan, close ? rename(close, e.keySpan) : undefined);
      }
      continue;
    }
    if (k.kind === 'block') {
      report('warning', 'castep-block-keyword', `${e.keyword} is a block: write %BLOCK ${e.keyword.toUpperCase()}, its rows, and %ENDBLOCK ${e.keyword.toUpperCase()}.`, e.keySpan);
      continue;
    }
    checkValue(e, k.type, k.options, k.name, k.unit, report);
  }

  for (const b of doc.blocks) {
    const k = lookupCastepKeyword(file, b.name);
    if (!k) {
      const elsewhere = lookupCastepKeyword(other, b.name);
      if (elsewhere) report('warning', 'castep-wrong-file', `${b.name} is a block of the ${other} file, not of the ${file} file.`, b.nameSpan);
      else {
        const close = closestCastepKeyword(file, b.name);
        reportFix('warning', 'castep-unknown-block', `${b.name} is not a block of the ${file} file in the CASTEP documentation${close ? `. Did you mean ${close}?` : ' (the documentation does not list every block).'}`, b.nameSpan, close ? rename(close, b.nameSpan) : undefined);
      }
    } else if (k.kind !== 'block') {
      report('warning', 'castep-keyword-block', `${b.name} is a keyword with a value, not a block (${k.type || 'value'}).`, b.nameSpan);
    }
    // %ENDBLOCK name: the docs print %ENDBLOCK END POSITIONS_FRAC once, so any word may precede the name.
    if (b.closed && b.endName && !b.endName.toLowerCase().split(/\s+/).includes(b.name.toLowerCase())) {
      report('warning', 'castep-endblock-name', `%ENDBLOCK ${b.endName} does not match %BLOCK ${b.name}.`, b.endSpan!);
    }
  }

  if (file === 'cell') checkCell(doc, report);
  if (file === 'param') checkParam(doc, report);
  checkCross(doc, file, ctx, report);
  return out;
}

/** Reads the value as CASTEP does for the type the documentation gives. */
function checkValue(e: CastepEntry, type: string, options: string[], name: string, unit: string, report: Report) {
  const first = e.args[0];
  const need = (what: string) => report('error', 'castep-value', `${e.keyword} needs ${what}.`, e.keySpan);
  switch (type) {
    case 'logical':
      if (!first) report('warning', 'castep-value', `${e.keyword} is a logical: give TRUE or FALSE.`, e.keySpan);
      else if (!LOGICAL.has(first.text.toLowerCase())) report('error', 'castep-value', `${e.keyword} is a logical (TRUE or FALSE), found "${first.text}".`, first);
      return;
    case 'integer':
      if (!first) need('an integer');
      else if (!/^[+-]?\d+$/.test(first.text)) report('error', 'castep-value', `${e.keyword} needs an integer, found "${first.text}".`, first);
      return;
    case 'real':
    case 'physical':
      if (!first) need(type === 'physical' ? `a number${unit ? ` (in ${unit} unless another unit follows)` : ''}` : 'a number');
      else if (!isCastepNumber(first.text) && !isCastepNumber(e.value.replace(/\s+[A-Za-z][\w/^-]*$/, '').replace(/\s+/g, ''))) report('error', 'castep-value', `${e.keyword} needs a number${type === 'physical' ? ' with an optional unit' : ''}, found "${first.text}".`, first);
      return;
    case 'integer-vector':
    case 'real-vector': {
      const want = type === 'integer-vector' ? /^[+-]?\d+$/ : null;
      const items = e.args.slice(0, 3);
      const bad = items.find((t) => (want ? !want.test(t.text) : !isCastepNumber(t.text)));
      if (items.length < 3) report('error', 'castep-value', `${e.keyword} needs three ${want ? 'integers' : 'numbers'}, found ${items.length}.`, items.length ? e.valueSpan : e.keySpan);
      else if (bad) report('error', 'castep-value', `${e.keyword} needs three ${want ? 'integers' : 'numbers'}, "${bad.text}" is not ${want ? 'an integer' : 'a number'}.`, bad);
      return;
    }
    case 'string':
      if (first && options.length && !options.some((o) => o.toLowerCase() === first.text.toLowerCase())) {
        // basis_precision: param_file.md names exactly these four; elsewhere the lists may not be exhaustive.
        const closed = name.toLowerCase() === 'basis_precision';
        report(closed ? 'error' : 'warning', 'castep-option', `${e.keyword} : ${first.text} is not one of the values the documentation gives (${options.join(', ')}).`, first);
      }
      return;
  }
}

/** Cell file: what the structure needs, and the keywords the documentation says exclude each other. */
function checkCell(doc: CastepDoc, report: Report) {
  const present = new Map<string, Span>();
  for (const e of doc.entries) present.set(canonicalCastepName(e.keyword), e.keySpan);
  for (const b of doc.blocks) present.set(canonicalCastepName(b.name), b.nameSpan);

  // cell_file.md: "CASTEP requires two block entries: a block to specify the lattice, and another to specify the atomic
  // elements and positions"; UNIT_CELL is "mutually exclusive to using %BLOCK LATTICE_CART/ABC and POSITIONS_FRAC/ABS".
  const lattice = present.has('lattice_cart') || present.has('lattice_abc');
  const positions = present.has('positions_frac') || present.has('positions_abs');
  if (present.has('unit_cell')) {
    if (lattice || positions) report('error', 'castep-exclusive', 'UNIT_CELL is mutually exclusive with the lattice and position blocks (cell_file.md).', present.get('unit_cell')!);
  } else {
    if (!lattice) report('error', 'castep-required', 'A cell file needs a lattice: %BLOCK LATTICE_CART or %BLOCK LATTICE_ABC (cell_file.md).', { start: 0, end: 0 });
    if (!positions) report('error', 'castep-required', 'A cell file needs the ionic positions: %BLOCK POSITIONS_FRAC or %BLOCK POSITIONS_ABS (cell_file.md).', { start: 0, end: 0 });
  }

  // cell_keywords.md footnotes: "Only one of … may be present in a cell file". The lattice and the positions define the structure: error.
  // The k-point, symmetry, spectral and phonon groups: the docs give the same rule; as they have defaults CASTEP could choose between, a warning.
  for (const group of CASTEP_EXCLUSIVE) {
    const hits = group.filter((n) => present.has(n));
    if (hits.length < 2) continue;
    const structure = group.some((n) => n.startsWith('lattice_') || n.startsWith('positions_'));
    for (const n of hits.slice(1)) {
      report(structure ? 'error' : 'warning', 'castep-exclusive', `${hits.map((h) => h.toUpperCase()).join(' and ')} exclude each other: the documentation says only one of ${group.map((g) => g.toUpperCase()).join(', ')} may be present.`, present.get(n)!);
    }
  }

  // cell_file.md: KPOINT_MP_OFFSET "may be specified in combination with either KPOINT_MP_GRID or KPOINT_MP_SPACING".
  for (const prefix of ['kpoint', 'spectral_kpoint']) {
    const off = present.get(`${prefix}_mp_offset`);
    if (off && present.has(`${prefix}_list`) && !present.has(`${prefix}_mp_grid`) && !present.has(`${prefix}_mp_spacing`)) {
      report('warning', 'castep-offset', `${prefix.toUpperCase()}_MP_OFFSET goes with ${prefix.toUpperCase()}_MP_GRID or ${prefix.toUpperCase()}_MP_SPACING, not with a list of k-points (cell_file.md).`, off);
    }
  }

  checkCellBlocks(doc.blocks, report);
}

const GEOMOPT = new Set(['geomopt', 'geometryoptimization', 'geometryoptimisation']);

/** Param file: pitfalls the documentation names. */
function checkParam(doc: CastepDoc, report: Report) {
  const m = castepEntriesByName(doc);

  // param_file.md: "coarse and medium are usually only suitable for quick preliminary investigations".
  const bp = m.get('basis_precision');
  if (bp && ['coarse', 'medium'].includes(bp.args[0]?.text.toLowerCase() ?? '')) {
    report('warning', 'castep-basis-precision', `basis_precision ${bp.args[0].text} is usually only suitable for quick preliminary investigations; for research use fine or better (param_file.md).`, bp.args[0]);
  }

  // Geometry optimisation page: "It is useful to set write_cell_structure and write_cif_structure".
  if (GEOMOPT.has(valueOf(m, 'task') ?? '') && !m.has('write_cell_structure') && !m.has('write_cif_structure')) {
    report('hint', 'castep-geom-write', 'For a geometry optimisation it is useful to set write_cell_structure and/or write_cif_structure, so CASTEP writes the final coordinates (Geometry_Optimisation/keywords.md).', m.get('task')!.keySpan);
  }

  // Delta_SCF/overview.md: "the excitation constraints only work for metals_method=DM and spin_treatment=scalar or none".
  const delta = m.get('calculate_deltascf');
  if (delta && isTrue(delta.args[0]?.text)) {
    const mm = m.get('metals_method');
    if (mm && valueOf(m, 'metals_method') !== 'dm') report('warning', 'castep-deltascf', 'The delta-SCF excitation constraints only work for metals_method DM (Delta_SCF/overview.md).', mm.keySpan);
    const st = m.get('spin_treatment');
    if (st && !['scalar', 'none'].includes(valueOf(m, 'spin_treatment') ?? '')) report('warning', 'castep-deltascf', 'The delta-SCF excitation constraints only work for spin_treatment scalar or none (Delta_SCF/overview.md).', st.keySpan);
  }
}

/**
 * Checks across the two files of a seed. Each is reported in the file that is open, on the line it concerns.
 * Without the other file nothing is guessed.
 */
function checkCross(doc: CastepDoc, file: CastepFile, ctx: CastepContext, report: Report) {
  const nb = ctx.neighbor;
  if (!nb) return;
  const param = file === 'param' ? doc : nb;
  const cell = file === 'cell' ? doc : nb;
  const p = castepEntriesByName(param);
  const cellNames = new Set([...cell.entries.map((e) => canonicalCastepName(e.keyword)), ...cell.blocks.map((b) => canonicalCastepName(b.name))]);
  const task = valueOf(p, 'task');
  const specTask = valueOf(p, 'spectral_task');
  const mine = (paramSpan: Span | undefined, cellSpan: Span | undefined) => (file === 'param' ? paramSpan : cellSpan);

  // Magnetic.md: "It is important to start the calculation with an initial spin density", `spin 1` in the param file or SPIN= in the positions.
  const sp = p.get('spin_polarised');
  const spinInCell = cell.blocks.some((b) => /^positions_(frac|abs)$/.test(canonicalCastepName(b.name)) && b.rows.some((r) => r.tokens.some((t) => /^spin=?/i.test(t.text))));
  if (sp && isTrue(sp.args[0]?.text) && !p.has('spin') && !spinInCell && file === 'param') {
    report('warning', 'castep-spin', 'spin_polarised is true but no initial spin is set: give `spin` here or SPIN= on atoms in the positions block of the cell file, otherwise the spin channels stay symmetric (Bands_and_DOS/magnetic.md).', sp.keySpan);
  }
  // …and the other way round: SPIN= in the cell file is without effect when the param file turns spin polarisation off.
  if (file === 'cell' && sp && isFalse(sp.args[0]?.text)) {
    for (const b of doc.blocks) {
      if (!/^positions_(frac|abs)$/.test(canonicalCastepName(b.name))) continue;
      const t = b.rows.flatMap((r) => r.tokens).find((x) => /^spin=?/i.test(x.text));
      if (t) report('warning', 'castep-spin', 'The param file sets spin_polarised to false: the initial spins given by SPIN= are not used (Bands_and_DOS/magnetic.md).', t);
    }
  }

  // cell_keywords.md: the default of SPECTRAL_KPOINT_LIST is the SCF k-points; a band structure needs a path or list along the lines of interest.
  const wantsBands = task === 'bandstructure' || (task === 'spectral' && specTask === 'bandstructure');
  if (wantsBands && ![...cellNames].some((n) => n.startsWith('spectral_kpoint_'))) {
    report('warning', 'castep-bands-kpoints', 'A band structure calculation without SPECTRAL_KPOINT_PATH (or _LIST) in the cell file uses the SCF k-points: define the path through the Brillouin zone there (Input_Files/cell_keywords.md).', mine(p.get('task')?.keySpan, { start: 0, end: 0 })!);
  }
  if (task === 'phonon' && ![...cellNames].some((n) => n.startsWith('phonon_kpoint_'))) {
    report('hint', 'castep-phonon-kpoints', 'No PHONON_KPOINT_* in the cell file: the phonons are calculated at the SCF k-points (Phonons/Castep_Phonons/Keyword-Reference.md).', mine(p.get('task')?.keySpan, { start: 0, end: 0 })!);
  }

  // cell_file.md "Constraints": FIX_ALL_IONS and FIX_ALL_CELL fix every ionic position and every cell parameter.
  const c = castepEntriesByName(cell);
  if (GEOMOPT.has(task ?? '') && isTrue(c.get('fix_all_ions')?.args[0]?.text) && isTrue(c.get('fix_all_cell')?.args[0]?.text)) {
    report('warning', 'castep-fixed', 'A geometry optimisation with FIX_ALL_IONS and FIX_ALL_CELL both TRUE has nothing to move (Input_Files/cell_file.md, "Constraints").', mine(p.get('task')?.keySpan, c.get('fix_all_cell')?.keySpan)!);
  }
}
