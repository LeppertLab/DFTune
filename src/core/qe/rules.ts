// Cross-checks within a pw.x input: variables against each other and against the cards.
//
// Every rule that reports an error mirrors a condition in the QE 7.4 source (PW/src/input.f90,
// setup.f90, Modules/read_cards.f90, cell_base.f90, read_namelists.f90, latgen.f90); softer notes
// say so. Where QE only prints a message, so does this (a warning or note, never an error).

import type { Span } from '../incar/parse';
import type { Line } from '../lines';
import type { Diagnostic, Fix } from '../validation/rules';
import type { QeCard, QeDoc, QeEntry, QeNamelist } from './parse';
import { isInteger, isReal, parseLogical, toReal, unquote, valueItems } from './values';

export type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Fix) => void;

const START: Span = { start: 0, end: 0 };

/** Typed access to the entries of a parsed input. */
export class Reader {
  constructor(readonly doc: QeDoc) {}
  namelist = (name: string): QeNamelist | undefined => this.doc.namelists.find((n) => n.name === name);
  card = (name: string): QeCard | undefined => this.doc.cards.find((c) => c.name === name);
  /** The last entry of `name` (QE uses the last assignment); with `index`, that array element. */
  entry(namelist: string, name: string, index?: string): QeEntry | undefined {
    const list = this.namelist(namelist)?.entries.filter((e) => e.name === name && (index === undefined || e.index?.trim() === index));
    return list?.[list.length - 1];
  }
  has = (namelist: string, name: string, index?: string) => this.entry(namelist, name, index) !== undefined;
  /** First item of the value, unquoted and lower-cased. */
  str(namelist: string, name: string): string | undefined {
    const e = this.entry(namelist, name);
    return e && e.value ? unquote(valueItems(e.value)[0] ?? '').toLowerCase() : undefined;
  }
  num(namelist: string, name: string, index?: string): number | undefined {
    const e = this.entry(namelist, name, index);
    const item = e && valueItems(e.value)[0];
    return item !== undefined && isReal(item) ? toReal(item) : undefined;
  }
  bool(namelist: string, name: string): boolean | undefined {
    const e = this.entry(namelist, name);
    const item = e && valueItems(e.value)[0];
    return item === undefined ? undefined : parseLogical(item);
  }
}

/** What each Bravais-lattice index needs besides celldm(1) (latgen.f90). */
const CELLDM_NEEDED: Record<number, number[]> = {
  0: [], 1: [], 2: [], 3: [], [-3]: [], 4: [3], 5: [4], [-5]: [4], 6: [3], 7: [3], 8: [2, 3], 9: [2, 3], [-9]: [2, 3], 91: [2, 3], 10: [2, 3], 11: [2, 3],
  12: [2, 3, 4], [-12]: [2, 3, 5], 13: [2, 3, 4], [-13]: [2, 3, 5], 14: [2, 3, 4, 5, 6],
};

const POSITION_UNITS = ['alat', 'bohr', 'angstrom', 'crystal', 'crystal_sg'];
const KPOINT_TYPES = ['tpiba', 'automatic', 'crystal', 'gamma', 'tpiba_b', 'crystal_b', 'tpiba_c', 'crystal_c'];
const CELL_UNITS = ['alat', 'bohr', 'angstrom'];

export function checkPw(doc: QeDoc, report: Report) {
  const r = new Reader(doc);
  checkNamelistPresence(r, report);
  checkCell(r, report);
  checkSpeciesAndPositions(r, report);
  checkKpoints(r, report);
  checkElectrons(r, report);
}

/** Text that adds `namelist` after the last namelist that precedes it in the input, or undefined if that cannot be told. */
function insertNamelist(r: Reader, name: 'IONS' | 'CELL'): Fix | undefined {
  const before = name === 'IONS' ? ['ELECTRONS'] : ['IONS', 'ELECTRONS'];
  const anchor = before.map((n) => r.namelist(n)).find((n) => n?.closed);
  if (!anchor) return undefined;
  return { title: `Add an empty &${name} namelist`, edit: { start: anchor.span.end, end: anchor.span.end, text: `\n&${name}\n/` } };
}

function checkNamelistPresence(r: Reader, report: Report) {
  const calc = r.str('CONTROL', 'calculation') ?? 'scf';
  const at = r.entry('CONTROL', 'calculation')?.valueSpan ?? r.namelist('CONTROL')?.nameSpan ?? START;
  const ionic = ['relax', 'md', 'vc-relax', 'vc-md'].includes(calc);
  const variableCell = calc === 'vc-relax' || calc === 'vc-md';
  // QE reads &IONS for every calculation but nscf and bands (optional for scf), and &CELL for vc-* only.
  if (ionic && !r.namelist('IONS')) {
    report('error', 'qe-ions-missing', `calculation = '${calc}' needs an &IONS namelist (it can be empty): pw.x stops reading the input without it.`, at, insertNamelist(r, 'IONS'));
  }
  if (variableCell && !r.namelist('CELL')) {
    report('error', 'qe-cell-missing-namelist', `calculation = '${calc}' needs a &CELL namelist (it can be empty): pw.x stops reading the input without it.`, at, insertNamelist(r, 'CELL'));
  }
  const ions = r.namelist('IONS');
  if (ions && (calc === 'nscf' || calc === 'bands')) report('info', 'qe-ignored-namelist', `&IONS is not read for calculation = '${calc}'.`, ions.nameSpan);
  const cell = r.namelist('CELL');
  if (cell && !variableCell) report('info', 'qe-ignored-namelist', `&CELL is only read for variable-cell calculations (vc-relax, vc-md); it is ignored for '${calc}'.`, cell.nameSpan);
}

function checkCell(r: Reader, report: Report) {
  const ibravEntry = r.entry('SYSTEM', 'ibrav');
  const spaceGroup = r.has('SYSTEM', 'space_group');
  const ibrav = r.num('SYSTEM', 'ibrav');
  const cellCard = r.card('CELL_PARAMETERS');
  const hasCelldm = r.has('SYSTEM', 'celldm');
  const abc = ['a', 'b', 'c', 'cosab', 'cosac', 'cosbc'].map((n) => r.entry('SYSTEM', n)).filter((e): e is QeEntry => !!e);
  const celldm1 = r.has('SYSTEM', 'celldm', '1') || (r.entry('SYSTEM', 'celldm') !== undefined && !r.entry('SYSTEM', 'celldm')?.index);
  const lattice = celldm1 || r.has('SYSTEM', 'a');

  if (ibravEntry && ibrav !== undefined) {
    if (!Number.isInteger(ibrav) || !(ibrav in CELLDM_NEEDED)) {
      report('error', 'qe-ibrav', `ibrav = ${ibravEntry.value} is not a Bravais-lattice index: use 0, 1–14, -3, -5, -9, -12, -13 or 91.`, ibravEntry.valueSpan);
    } else if (ibrav === 0 && !cellCard) {
      report('error', 'qe-cell-card-missing', 'ibrav = 0: the lattice vectors must be given in a CELL_PARAMETERS card.', ibravEntry.valueSpan);
    } else if (ibrav !== 0 && cellCard) {
      report('error', 'qe-cell-card-redundant', `ibrav = ${ibrav}: CELL_PARAMETERS must be absent (the lattice is built from celldm or A…). Remove the card or set ibrav = 0.`, cellCard.nameSpan);
    }
  }
  if (hasCelldm && abc.length) {
    report('error', 'qe-celldm-and-abc', 'Specify the cell with celldm OR with A, B, C, cosAB, cosAC, cosBC, not both.', abc[0].keySpan);
  }
  if (ibrav !== undefined && ibrav !== 0 && ibrav in CELLDM_NEEDED && !spaceGroup) {
    if (!lattice) {
      report('error', 'qe-lattice-parameter', `ibrav = ${ibrav} needs the lattice parameter: celldm(1) (bohr) or A (Å).`, ibravEntry?.valueSpan ?? START);
    } else if (celldm1) {
      for (const k of CELLDM_NEEDED[ibrav]) {
        if (!r.has('SYSTEM', 'celldm', String(k))) report('error', 'qe-celldm-missing', `ibrav = ${ibrav} also needs celldm(${k}).`, ibravEntry?.valueSpan ?? START);
      }
    }
  }
  if (cellCard) {
    const unit = cellCard.option;
    if (unit === undefined) report('warning', 'qe-units-missing', 'No units on the CELL_PARAMETERS card: deprecated, QE then assumes alat (or bohr without a lattice parameter). Write CELL_PARAMETERS {alat}, {bohr} or {angstrom}.', cellCard.nameSpan);
    else if (!CELL_UNITS.includes(unit)) report('error', 'qe-card-option', `CELL_PARAMETERS: unknown unit "${unit}" (use alat, bohr or angstrom).`, cellCard.optionSpan ?? cellCard.nameSpan);
    else if ((unit === 'bohr' || unit === 'angstrom') && lattice) report('error', 'qe-lattice-twice', `CELL_PARAMETERS in ${unit} already fixes the lattice parameter: remove celldm(1) / A, or use {alat}.`, cellCard.optionSpan ?? cellCard.nameSpan);
    else if (unit === 'alat' && !lattice) report('error', 'qe-lattice-parameter', 'CELL_PARAMETERS {alat} needs celldm(1) or A to say what alat is.', cellCard.optionSpan ?? cellCard.nameSpan);
    // Three lines of three numbers.
    const rows = cellCard.lines.filter((l) => l.text.trim());
    if (rows.length < 3) report('error', 'qe-card-lines', `CELL_PARAMETERS needs 3 lines (the lattice vectors), found ${rows.length}.`, cellCard.nameSpan);
    for (const row of rows.slice(0, 3)) {
      if (row.tokens.length < 3 || !row.tokens.slice(0, 3).every((t) => isReal(t.text))) report('error', 'qe-card-line', 'A lattice vector needs three numbers.', lineSpan(row));
    }
  }
}

const lineSpan = (l: Line): Span => ({ start: l.start, end: l.end });

function checkSpeciesAndPositions(r: Reader, report: Report) {
  const species = r.card('ATOMIC_SPECIES');
  const positions = r.card('ATOMIC_POSITIONS');
  const labels = new Set<string>();

  if (species) {
    const rows = species.lines.filter((l) => l.text.trim());
    for (const row of rows) {
      if (row.tokens.length < 3) {
        report('error', 'qe-card-line', 'An ATOMIC_SPECIES line needs: label, mass, pseudopotential file.', lineSpan(row));
        continue;
      }
      labels.add(row.tokens[0].text);
      if (!isReal(row.tokens[1].text)) report('error', 'qe-card-line', `The mass "${row.tokens[1].text}" is not a number (line format: label mass pseudopotential-file).`, row.tokens[1]);
      else if (toReal(row.tokens[1].text) <= 0) report('warning', 'qe-mass', 'A mass of zero or less: only the molecular-dynamics runs use it, but it is stored in the data files.', row.tokens[1]);
    }
    const ntyp = r.num('SYSTEM', 'ntyp');
    if (ntyp !== undefined && Number.isInteger(ntyp) && ntyp !== rows.length) {
      report('error', 'qe-ntyp', `ntyp = ${ntyp} but ATOMIC_SPECIES lists ${rows.length} species.`, r.entry('SYSTEM', 'ntyp')?.valueSpan ?? species.nameSpan);
    }
  }

  if (positions) {
    const unit = positions.option;
    if (unit === undefined) report('warning', 'qe-units-missing', 'No units on the ATOMIC_POSITIONS card: deprecated, QE then assumes alat. Write ATOMIC_POSITIONS {alat}, {bohr}, {angstrom} or {crystal}.', positions.nameSpan);
    else if (!POSITION_UNITS.includes(unit)) report('error', 'qe-card-option', `ATOMIC_POSITIONS: unknown unit "${unit}" (use alat, bohr, angstrom, crystal or crystal_sg).`, positions.optionSpan ?? positions.nameSpan);
    const rows = positions.lines.filter((l) => l.text.trim());
    const wyckoff = unit === 'crystal_sg';
    for (const row of rows) {
      if (!wyckoff) {
        const n = row.tokens.length;
        // label x y z, optionally followed by three 0/1 flags.
        if (n < 4 || (n > 4 && n !== 7) || !row.tokens.slice(1, 4).every((t) => isReal(t.text))) {
          report('error', 'qe-card-line', n === 5 || n === 6 ? 'Unexpected number of columns: after x y z come either nothing or three 0/1 flags (if_pos).' : 'An ATOMIC_POSITIONS line needs: label x y z [if_pos(1) if_pos(2) if_pos(3)].', lineSpan(row));
          continue;
        }
        if (n === 7 && !row.tokens.slice(4).every((t) => /^[01]$/.test(t.text))) report('warning', 'qe-if-pos', 'The if_pos flags are 0 (fixed) or 1 (free).', lineSpan(row));
      }
      const label = row.tokens[0]?.text;
      if (label && labels.size && !labels.has(label)) {
        const nearby = [...labels].find((l) => l.toLowerCase() === label.toLowerCase());
        report('error', 'qe-species-label', `Species ${label} is not in ATOMIC_SPECIES${nearby ? ` (labels are case-sensitive: ${nearby})` : ''}.`, row.tokens[0], nearby ? { title: `Change to ${nearby}`, edit: { start: row.tokens[0].start, end: row.tokens[0].end, text: nearby } } : undefined);
      }
    }
    const nat = r.num('SYSTEM', 'nat');
    if (nat !== undefined && Number.isInteger(nat) && !r.has('SYSTEM', 'space_group') && !wyckoff && nat !== rows.length) {
      report('error', 'qe-nat', `nat = ${nat} but ATOMIC_POSITIONS lists ${rows.length} atoms.`, r.entry('SYSTEM', 'nat')?.valueSpan ?? positions.nameSpan);
    }
  }
}

function checkKpoints(r: Reader, report: Report) {
  const card = r.card('K_POINTS');
  if (!card) return;
  const type = card.option ?? 'tpiba';
  if (!KPOINT_TYPES.includes(type)) {
    report('error', 'qe-card-option', `K_POINTS: unknown type "${type}" (use ${KPOINT_TYPES.join(', ')}).`, card.optionSpan ?? card.nameSpan);
    return;
  }
  const rows = card.lines.filter((l) => l.text.trim());
  if (type === 'gamma') return;
  if (type === 'automatic') {
    const row = rows[0];
    if (!row) {
      report('error', 'qe-card-line', 'K_POINTS automatic needs a line "nk1 nk2 nk3 sk1 sk2 sk3".', card.nameSpan);
      return;
    }
    const t = row.tokens.slice(0, 6);
    if (t.length < 6 || !t.every((x) => isInteger(x.text))) {
      report('error', 'qe-card-line', 'K_POINTS automatic needs six integers: "nk1 nk2 nk3 sk1 sk2 sk3".', lineSpan(row));
      return;
    }
    const [n1, n2, n3, s1, s2, s3] = t.map((x) => Number(x.text));
    if (n1 <= 0 || n2 <= 0 || n3 <= 0) report('error', 'qe-kpoints', 'invalid values for nk1, nk2, nk3: they must be positive.', lineSpan(row));
    if ([s1, s2, s3].some((s) => s < 0 || s > 1)) report('error', 'qe-kpoints', 'invalid offsets: sk1, sk2, sk3 must be 0 or 1.', lineSpan(row));
    return;
  }
  // A list: the number of points, then one line each ("x y z weight").
  const first = rows[0];
  if (!first || !isInteger(first.tokens[0]?.text ?? '')) {
    report('error', 'qe-card-line', `K_POINTS ${type} starts with the number of k points.`, first ? lineSpan(first) : card.nameSpan);
    return;
  }
  const nks = Number(first.tokens[0].text);
  const points = rows.slice(1);
  if (nks <= 0) report('error', 'qe-kpoints', 'The number of k points must be positive.', first.tokens[0]);
  else if (points.length < nks) report('error', 'qe-kpoints', `${nks} k points announced but ${points.length} listed.`, first.tokens[0]);
  else if (points.length > nks) report('warning', 'qe-kpoints', `${nks} k points announced but ${points.length} listed: the last ${points.length - nks} are ignored.`, first.tokens[0]);
  if (type.endsWith('_c') && nks !== 3) report('error', 'qe-kpoints', `K_POINTS ${type} needs exactly 3 points (the origin and two vectors).`, first.tokens[0]);
  for (const p of points.slice(0, Math.max(nks, 0))) {
    // Band paths (_b) may name the point by a Brillouin-zone label instead: "gG 20" (Doc/brillouin_zones.pdf).
    const labelled = type.endsWith('_b') && p.tokens.length >= 2 && !isReal(p.tokens[0].text) && isInteger(p.tokens[1].text);
    if (!labelled && (p.tokens.length < 4 || !p.tokens.slice(0, 4).every((t) => isReal(t.text)))) {
      report('error', 'qe-card-line', type.endsWith('_b') ? 'A k point needs x y z and the number of points to the next one (or a label and that number: gG 20).' : 'A k point needs four numbers: x y z weight.', lineSpan(p));
    }
  }
}

const TETRA = ['tetrahedra', 'tetrahedra_lin', 'tetrahedra_opt'];

function checkElectrons(r: Reader, report: Report) {
  const calc = r.str('CONTROL', 'calculation') ?? 'scf';
  const lscf = calc !== 'nscf' && calc !== 'bands';
  const occ = r.str('SYSTEM', 'occupations') ?? 'fixed';
  const occEntry = r.entry('SYSTEM', 'occupations');
  const nspin = r.num('SYSTEM', 'nspin');
  const nspinEntry = r.entry('SYSTEM', 'nspin');
  const system = r.namelist('SYSTEM');

  // setup.f90: "spin-polarized system, specify occupations".
  if (nspin === 2 && lscf && !r.bool('SYSTEM', 'noncolin') && !['smearing', 'from_input', ...TETRA].includes(occ) && !r.has('SYSTEM', 'tot_magnetization')) {
    report('error', 'qe-spin-occupations', "nspin = 2 needs smearing (occupations = 'smearing' with degauss), tetrahedra, or a fixed total magnetization (tot_magnetization): pw.x stops with \"spin-polarized system, specify occupations\".", occEntry?.valueSpan ?? nspinEntry?.valueSpan ?? START, system ? setEntries(r, system, [['occupations', "'smearing'"], ['smearing', "'mv'"], ['degauss', '0.02']], 'Use smearing (occupations, smearing = mv, degauss = 0.02)', occEntry) : undefined);
  }
  // set_occupations.f90.
  if (occ === 'smearing') {
    const degauss = r.num('SYSTEM', 'degauss');
    if (!(degauss !== undefined && degauss > 0)) {
      report('error', 'qe-degauss', "occupations = 'smearing' requires a positive degauss (the broadening, in Ry; 0.01–0.05 is typical for metals).", occEntry?.valueSpan ?? START, system && !r.has('SYSTEM', 'degauss') ? setEntries(r, system, [['degauss', '0.02']], 'Add degauss = 0.02') : undefined);
    }
  } else if (r.has('SYSTEM', 'degauss') && (r.num('SYSTEM', 'degauss') ?? 0) !== 0) {
    report('warning', 'qe-degauss-ignored', `degauss is ignored with occupations = '${occ}'.`, r.entry('SYSTEM', 'degauss')!.keySpan);
  }
  // setup.f90: "tetrahedra need automatic k-point grid".
  const kp = r.card('K_POINTS');
  if (TETRA.includes(occ) && kp && (kp.option ?? 'tpiba') !== 'automatic') {
    report('error', 'qe-tetra-kpoints', `occupations = '${occ}' needs an automatic k-point grid: K_POINTS {automatic}.`, kp.optionSpan ?? kp.nameSpan);
  }
  // input.f90: set_cutoff.
  const wfc = r.num('SYSTEM', 'ecutwfc');
  const rho = r.num('SYSTEM', 'ecutrho');
  if (wfc !== undefined && rho !== undefined && wfc > 0) {
    if (rho <= wfc) report('error', 'qe-ecutrho', 'ecutrho <= ecutwfc: pw.x stops. The default is 4 × ecutwfc; ultrasoft and PAW pseudopotentials usually need 8–12 ×.', r.entry('SYSTEM', 'ecutrho')!.valueSpan);
    else if (rho < 4 * wfc - 1e-8) report('warning', 'qe-ecutrho', `ecutrho < 4 × ecutwfc (${4 * wfc}): pw.x continues but asks "are you sure?".`, r.entry('SYSTEM', 'ecutrho')!.valueSpan);
  }
  // Magnetization.
  const hasMagnetization = (system?.entries ?? []).some((e) => e.name === 'starting_magnetization');
  if (nspin === 2 && !hasMagnetization && !r.has('SYSTEM', 'tot_magnetization')) {
    report('warning', 'qe-no-magnetization', 'nspin = 2 without starting_magnetization: every atom starts non-magnetic, and the calculation normally stays that way.', nspinEntry!.valueSpan);
  } else if (hasMagnetization && (nspin === undefined || nspin === 1) && !r.bool('SYSTEM', 'noncolin')) {
    report('info', 'qe-magnetization-ignored', 'starting_magnetization is ignored without nspin = 2 (or noncolin = .true.).', system!.entries.find((e) => e.name === 'starting_magnetization')!.keySpan);
  }
  if (nspin === 4) report('warning', 'qe-nspin4', 'Do not set nspin = 4: set noncolin = .true. instead (QE then selects the noncollinear case itself).', nspinEntry!.valueSpan);
  // OCCUPATIONS card.
  const occCard = r.card('OCCUPATIONS');
  if (occCard && occ !== 'from_input') report('info', 'qe-card-ignored', "The OCCUPATIONS card is only read with occupations = 'from_input'.", occCard.nameSpan);
  if (occ === 'from_input' && !occCard) report('error', 'qe-card-missing', "occupations = 'from_input' needs an OCCUPATIONS card.", occEntry?.valueSpan ?? START);
}

/**
 * A fix that sets `assignments` ([name, value]) in a namelist: those not set yet are added before the
 * closing `/`; `replacing` (an existing entry) is overwritten by the first one.
 */
function setEntries(r: Reader, nl: QeNamelist, assignments: [string, string][], title: string, replacing?: QeEntry): Fix | undefined {
  if (!nl.closed) return undefined;
  const indent = '  ';
  const fresh = assignments.filter(([name], i) => !(replacing && i === 0) && !r.has(nl.name, name));
  if (replacing) {
    const first = `${assignments[0][0]} = ${assignments[0][1]}`;
    const text = [first, ...fresh.map(([n, v]) => `${n} = ${v}`)].join(`\n${indent}`);
    return { title, edit: { start: replacing.span.start, end: replacing.span.end, text } };
  }
  if (!fresh.length) return undefined;
  // The namelist span ends right after the closing "/".
  const close = nl.span.end - 1;
  return { title, edit: { start: close, end: close, text: fresh.map(([n, v]) => `${indent}${n} = ${v}\n`).join('') } };
}
