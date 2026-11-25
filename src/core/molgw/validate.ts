// Checks on a MolGW input. Errors are only for what MolGW itself rejects: the namelist read of
// `read(inputfile, molgw)` (unknown name, unreadable value), the `call die(...)` checks of
// read_inputfile_namelist, init_calculation_type, init_dft_type and setup_nuclei (src/m_inputparam.f90).
// Everything the code only warns about, or that the manual states without the code enforcing it, is a warning.
// Each rule cites the place it comes from.

import type { Span } from '../incar/parse';
import type { Diagnostic, Fix } from '../validation/rules';
import type { AtomLine, MolgwDoc, MolgwEntry, MolgwValue } from './parse';
import { isFortranInteger, isFortranReal, MolgwReader, splitRepeat } from './reader';
import {
  closestOf,
  lookupMolgw,
  molgwKeywords,
  MOLGW_ELEMENTS,
  MOLGW_NO,
  MOLGW_POSTSCF,
  MOLGW_YES,
  postscfNames,
  scfNames,
  type MolgwKeyword,
} from './tags';
import { MOLGW_LISTED, MOLGW_STRICT } from './keywords.generated';

type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Fix) => void;

export interface MolgwContext {
  /** The number of atoms in the xyz_file next to the input (its first line), when it could be read. */
  xyzAtoms?: number;
}

const rename = (to: string, span: Span, title = `Change to ${to}`): Fix => ({ title, edit: { start: span.start, end: span.end, text: to } });
const quoted = (v: MolgwValue): Fix => ({ title: 'Put the value in quotes', edit: { start: v.start, end: v.end, text: `'${v.text.replace(/'/g, "''")}'` } });

/** Every name the namelist accepts, for did-you-mean. */
const NAMES = () => molgwKeywords().map((k) => k.name);

export function validateMolgw(doc: MolgwDoc, ctx: MolgwContext = {}): Diagnostic[] {
  const out: Diagnostic[] = [...doc.issues];
  const report: Report = (severity, code, message, span, fix) => out.push({ severity, code, message, span, ...(fix && { fix }) });
  if (!doc.group) return out;

  const seen = new Set<string>();
  for (const e of doc.entries) {
    const k = lookupMolgw(e.key);
    if (!k) {
      const close = closestOf(e.key, NAMES());
      // The namelist read fails: "Cannot match namelist object name <name>".
      report('error', 'molgw-unknown-keyword', `Unknown variable ${e.key}: MolGW's namelist read stops on a name it does not know${close ? `. Did you mean ${close}?` : '.'}`, e.keySpan, close ? rename(close, e.keySpan) : undefined);
      continue;
    }
    if (!e.subscript) {
      if (seen.has(k.name)) report('warning', 'molgw-duplicate', `${k.name} is set more than once; MolGW keeps the last value.`, e.keySpan);
      seen.add(k.name);
      checkValue(e, k, report);
    }
  }

  const r = new MolgwReader(doc);
  checkSettings(r, report);
  checkGeometry(r, doc, ctx, report);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Values

/** A value the namelist read could not make a variable of this type from. */
function checkValue(e: MolgwEntry, k: MolgwKeyword, report: Report) {
  if (!e.values.length) {
    report('warning', 'molgw-empty', `${k.name} has no value: the namelist leaves the variable unchanged (default ${k.default === '' ? 'empty' : k.default}).`, e.keySpan);
    return;
  }
  const first = e.values[0];
  const bad = (what: string, v: MolgwValue = first) => report('error', 'molgw-value', `${k.name} needs ${what}, found ${v.raw}: the namelist read stops ("Bad ${k.type === 'integer' ? 'integer' : k.type === 'real' || k.type === 'vector3' ? 'real number' : 'value'} for item … in list input").`, v);

  if (k.type === 'vector3') {
    // Up to three reals (`3*0.0` repeats one): more is "Too many values" for the array.
    let count = 0;
    for (const v of e.values) {
      const rep = v.quoted ? undefined : splitRepeat(v.text);
      const text = rep ? rep.value : v.text;
      if (v.quoted || (text !== '' && !isFortranReal(text))) {
        bad('three numbers', v);
        return;
      }
      count += rep ? rep.count : 1;
    }
    if (count > 3) report('error', 'molgw-value', `${k.name} is a vector of 3 numbers, found ${count} values.`, e.values[3] ?? e.valueSpan);
    return;
  }

  if (e.values.length > 1) {
    // A scalar takes one value: the next token is read as the next variable name.
    report('error', 'molgw-value', `${k.name} takes one value; "${e.values[1].raw}" after it is read as the next variable name and the namelist read stops ("Cannot match namelist object name").`, e.values[1]);
  }
  if (k.type === 'integer') {
    if (first.quoted || !isFortranInteger(splitRepeat(first.text)?.value ?? first.text)) bad('an integer');
  } else if (k.type === 'real') {
    if (first.quoted || !isFortranReal(splitRepeat(first.text)?.value ?? first.text)) bad('a number');
  } else {
    // Character variables (yes/no ones included, they are character(len=3)): standard Fortran wants quotes.
    if (!first.quoted && e.values.length === 1) {
      report('warning', 'molgw-unquoted', `${first.raw} should be in quotes: a Fortran namelist reads a string in '…' or "…" (every MolGW input and test writes ${k.name}='…'); a bare word is accepted only by some compilers.`, first, quoted(first));
    }
    if (k.type === 'yesno') checkYesNo(k, first, report);
    else checkWords(k, first, report);
  }
}

/** yesno_to_logical (src/m_string_tools.f90): the first three characters, in capitals, must be one of the accepted spellings. */
function checkYesNo(k: MolgwKeyword, v: MolgwValue, report: Report) {
  const word = v.text.toLowerCase().slice(0, 3).replace(/\s+$/, '');
  if (MOLGW_YES.includes(word) || MOLGW_NO.includes(word)) return;
  report('error', 'molgw-yesno', `${k.name} is a yes/no variable: MolGW cannot interpret ${v.raw} ("Yes or No, I cannot interpret this input"). Use 'yes' or 'no'.`, v);
}

/** The words a character variable may take: stopped on by MolGW (`strict`) or only listed by the manual or the source. */
function checkWords(k: MolgwKeyword, v: MolgwValue, report: Report) {
  const text = v.text.replace(/\s+$/, '');
  const up = text.toUpperCase();
  const lowerFix = (to: string, title?: string) => rename(v.quoted ? `'${to}'` : to, v, title);
  const suggest = (list: string[]) => {
    const c = closestOf(text, list);
    return c ? { hint: ` Did you mean ${c}?`, fix: lowerFix(c) } : { hint: '', fix: undefined };
  };

  switch (k.name) {
    case 'scf': {
      if (text === '') return; // reported as missing
      // init_calculation_type / init_dft_type: the built-in schemes, the functionals, or LIBXC:<id>[+<id>…].
      if (up.includes('LIBXC:') || scfNames().includes(text.toLowerCase())) return;
      const s = suggest(scfNames());
      report('error', 'molgw-option', `scf=${v.raw} is not a scheme or functional MolGW knows ("init_dft_type: Error reading keyword scf. DFT type not understood").${s.hint} (LIBXC:<id> also works.)`, v, s.fix);
      return;
    }
    case 'postscf': {
      if (text === '' || postscfNames().includes(text.toLowerCase())) return;
      const s = suggest(postscfNames());
      report('error', 'molgw-option', `postscf=${v.raw} is not a post-scf method MolGW knows ("init_calculation_type: Error reading keyword: postscf").${s.hint}`, v, s.fix);
      return;
    }
    case 'excit_name':
      if (text === '') return; // the check is skipped for an empty name
  }

  const strict = MOLGW_STRICT[k.name];
  if (strict) {
    const ok = strict.caseSensitive ? strict.values.includes(text) : strict.values.includes(text.toLowerCase());
    if (ok) return;
    const caseOnly = strict.caseSensitive && strict.values.includes(text.toLowerCase());
    const s = suggest(strict.values);
    report(
      'error',
      'molgw-option',
      `${k.name}=${v.raw} is not accepted: MolGW stops ("${DIES[k.name] ?? 'not recognized'}"). It takes ${strict.values.map((x) => `'${x}'`).join(', ')}${strict.caseSensitive ? ' (lower case: this one is case-sensitive)' : ''}.${caseOnly ? '' : s.hint}`,
      v,
      caseOnly ? lowerFix(text.toLowerCase(), 'Change to lower case') : s.fix,
    );
    return;
  }

  const listed = MOLGW_LISTED[k.name];
  if (listed && text !== '') {
    // gaussian_type is passed on as character(len=4): longer words are cut after four characters.
    const key = k.name === 'gaussian_type' ? text.toLowerCase().slice(0, 4) : text.toLowerCase();
    if (listed.values.includes(key)) return;
    const s = suggest(listed.values);
    report('warning', 'molgw-listed', `${k.name}=${v.raw} is not one of the values found in ${listed.source}: ${listed.values.join(', ')}. MolGW does not check it when it reads the input.${s.hint}`, v, s.fix);
  }
}

/** The message MolGW's `die` prints for each variable it checks (src/m_inputparam.f90). */
const DIES: Record<string, string> = {
  mixing_scheme: 'mixing scheme not recognized',
  pt3_a_diagrams: 'pt3_a_diagram input variable can only be yes, no, or only',
  move_nuclei: 'move_nuclei should be no, relax, or force',
  length_unit: 'units for lengths in input file not understood',
  excit_name: 'excit_name is unknown',
};

// ---------------------------------------------------------------------------------------------------------
// Settings that go together

const PROJECTILE = ['ION', 'ANTIION', 'NUCLEUS', 'ANTINUCLEUS'];

function checkSettings(r: MolgwReader, report: Report) {
  const nameSpan = r.doc.group!.nameSpan;
  const yes = (n: string) => r.yes(n, MOLGW_YES);
  const err = (code: string, msg: string, span: Span, fix?: Fix) => report('error', code, msg, span, fix);
  const num = (n: string) => r.num(n);

  // init_dft_type dies on an empty scf, and the manual marks scf and basis as mandatory.
  const scfEntry = r.entry('scf');
  if (!scfEntry || r.str('scf') === '') {
    err('molgw-required', 'scf is mandatory: it names the self-consistent scheme (try scf=\'pbe\', \'hf\', \'lda\' …). MolGW stops without it ("init_dft_type: Error reading keyword scf").', scfEntry ? r.at('scf') : nameSpan);
  }

  // read_inputfile_namelist: the `call die` consistency checks, in the order of the source.
  const range = (name: string, bad: (x: number) => boolean, msg: string) => {
    const x = num(name);
    if (r.has(name) && x !== undefined && bad(x)) err('molgw-range', msg, r.at(name));
  };
  range('alpha_mixing', (x) => x < 0 || x > 1, 'alpha_mixing should be inside [0, 1] (MolGW: "alpha_mixing should be inside [0,1]").');
  for (const n of ['ncoreg', 'ncorew', 'ncore_tddft', 'nvirtualg', 'nvirtualw']) range(n, (x) => x < 0, `A negative ${n} is meaningless (MolGW stops: "negative ${n} is meaningless").`);
  for (const [v, c] of [['nvirtualg', 'ncoreg'], ['nvirtualw', 'ncorew']]) {
    if ((r.has(v) || r.has(c)) && num(v)! < num(c)!) err('molgw-range', `${v} is smaller than ${c}: MolGW stops ("too small ${v} is meaningless").`, r.has(v) ? r.at(v) : r.at(c));
  }
  const nspin = num('nspin');
  if (r.has('nspin') && nspin !== undefined && nspin !== 1 && nspin !== 2) err('molgw-spin', 'nspin must be 1 (spin-restricted) or 2 (spin-unrestricted): MolGW stops ("nspin in incorrect").', r.at('nspin'));
  const mag = num('magnetization');
  if (r.has('magnetization') && mag !== undefined) {
    if (mag < -1e-5) err('molgw-spin', 'magnetization cannot be negative: MolGW stops ("magnetization is negative").', r.at('magnetization'));
    else if (mag > 1e-5 && nspin === 1) err('molgw-spin', 'magnetization is non-zero but nspin is 1: MolGW stops. Set nspin=2 for a spin-polarized calculation.', r.at('magnetization'), r.has('nspin') ? rename('2', r.at('nspin'), 'Set nspin=2') : undefined);
  }
  range('nomega_sigma', (x) => x < 0, 'nomega_sigma < 0: MolGW stops.');
  range('step_sigma', (x) => x < 0, 'step_sigma < 0.0: MolGW stops.');
  range('auto_auxil_fsam', (x) => x < 1.00001, 'auto_auxil_fsam should be strictly greater than 1: MolGW stops ("Increase it a bit please").');

  // x2c (experimental) has its own requirements.
  if (yes('x2c') && r.has('x2c')) {
    if (nspin !== 2) err('molgw-x2c', 'X2C calculations require nspin=2: MolGW stops.', r.has('nspin') ? r.at('nspin') : r.at('x2c'));
    if (Math.abs(mag ?? 0) > 1e-8) err('molgw-x2c', 'X2C calculations are only implemented for magnetization=0: MolGW stops.', r.at('magnetization'));
    if (r.str('move_nuclei') !== 'no') err('molgw-x2c', "X2C calculations are only implemented for move_nuclei='no': MolGW stops.", r.at('move_nuclei'));
    if (!hasAuxil(r)) err('molgw-x2c', 'X2C calculations require an auxiliary basis (auxil_basis): MolGW stops.', r.at('x2c'));
    if (r.upper('gaussian_type').slice(0, 4) !== 'PURE') report('warning', 'molgw-x2c', "X2C calculations are always done with spherical (pure) Gaussians: MolGW sets gaussian_type='pure' (it warns).", r.has('gaussian_type') ? r.at('gaussian_type') : r.at('x2c'));
  }

  // print_w with an auxiliary basis.
  if (yes('print_w') && r.has('print_w') && hasAuxil(r)) {
    err('molgw-print-w', 'print_w is not numerically stable with an auxiliary basis: MolGW stops ("input check: print_w is not numerically stable when using an auxiliary basis").', r.at('print_w'));
  }

  // The post-scf method and the options that must go with it (init_calculation_type and the checks after it).
  const post = r.str('postscf').toLowerCase();
  const scf = r.str('scf').toLowerCase();
  const known = post === '' || post in MOLGW_POSTSCF;
  if (known) {
    const flags = post === '' ? [] : MOLGW_POSTSCF[post];
    // `case('GW','QSGW')`, `case('COHSEX')`, `case('MP2','PT2')` of scf set the technique to QS, after postscf.
    const qs = ['gw', 'qsgw', 'cohsex', 'mp2', 'pt2'].includes(scf);
    const technique = qs ? 'QS' : (flags.find((f) => f.startsWith('technique:'))?.slice(10) ?? 'one_shot');
    const isGw = flags.includes('gw') || ['gw', 'qsgw', 'cohsex'].includes(scf);
    if (technique.toLowerCase() === 'imaginary_axis_pade') {
      if ((num('nomega_chi_imag') ?? 0) < 1) err('molgw-pade', `postscf='${r.str('postscf')}' evaluates the self-energy numerically on the imaginary axis and needs nomega_chi_imag > 0 (default 0): MolGW stops.`, r.has('postscf') ? r.at('postscf') : nameSpan);
      if (num('nomega_sigma_calc') === 1) report('warning', 'molgw-pade', `With postscf='${r.str('postscf')}' MolGW advises more than one frequency: set nomega_sigma_calc > 1 (it warns "nomega_sigma_calc > 1 advised").`, r.has('nomega_sigma_calc') ? r.at('nomega_sigma_calc') : r.at('postscf'));
    }
    if ((num('nexcitation') ?? 0) !== 0 && isGw) err('molgw-gw-davidson', 'The Davidson diagonalization (nexcitation ≠ 0) is not compatible with GW: set nexcitation to 0. MolGW stops.', r.at('nexcitation'));
    if ((num('nstep_gw') ?? 1) > 1 && technique.toLowerCase() !== 'evsc') {
      err('molgw-nstep-gw', 'nstep_gw > 1 is only valid for eigenvalue self-consistent GW (postscf=\'evgw\', \'gnw0\', \'gnwn\'): MolGW stops. Change postscf or nstep_gw.', r.at('nstep_gw'));
    }
  }

  // A projectile that carries its basis (excit_name='ion').
  const excit = r.upper('excit_name');
  if (excit === 'ION' || excit === 'ANTIION') {
    if (!yes('eri3_genuine')) err('molgw-ion', "eri3_genuine is required for a moving basis (excit_name='ion'): set eri3_genuine='yes'. MolGW stops.", r.has('excit_name') ? r.at('excit_name') : nameSpan);
    if (r.upper('tddft_predictor_corrector').slice(0, 2) !== 'MB') err('molgw-ion', "The predictor-corrector scheme is not valid for a moving basis: use for instance tddft_predictor_corrector='MB_PC2B'. MolGW stops.", r.has('tddft_predictor_corrector') ? r.at('tddft_predictor_corrector') : r.at('excit_name'));
  }

  // The geometry cannot move when the nuclei have an effective core potential (setup_nuclei).
  if (r.str('move_nuclei') !== 'no' && r.str('ecp_elements').trim() !== '' && r.has('ecp_elements')) {
    report('warning', 'molgw-ecp-forces', "Forces are not implemented with an effective core potential: when an element of ecp_elements is in the molecule MolGW stops (\"forces are not implemented with ECP. Set move_nuclei to no\").", r.at('move_nuclei'));
  }

  // nstep only counts for relaxations: read_inputfile_namelist resets it to 1 otherwise.
  if (r.has('nstep') && r.str('move_nuclei') !== 'relax') {
    report('warning', 'molgw-nstep', "nstep is ignored unless move_nuclei='relax': MolGW resets it to 1 (\"If no nuclei motion is requested, then override nstep\").", r.at('nstep'));
  }
}

/** has_auxil_basis of read_inputfile_namelist: an auxiliary basis for the molecule, or one per atom line. */
function hasAuxil(r: MolgwReader): boolean {
  if (r.str('auxil_basis').trim() !== '' || r.str('ecp_auxil_basis').trim() !== '') return true;
  const n = expectedAtoms(r);
  return r.doc.atoms.slice(0, n).some((a) => a.fields.length >= 6 && stripQuotes(a.fields[4].text).toLowerCase() !== 'none');
}

/** Neither basis nor ecp_basis names a basis set (elements of ecp_elements take ecp_basis, the others basis). */
const noBasis = (r: MolgwReader) => r.str('basis').trim() === '' && r.str('ecp_basis').trim() === '';

const stripQuotes = (s: string) => (/^(['"]).*\1$/.test(s) ? s.slice(1, -1) : s);

// ---------------------------------------------------------------------------------------------------------
// Geometry

/** Whether the geometry comes from a file: setup_nuclei reads no atom lines then. */
const fromFile = (r: MolgwReader) => r.str('xyz_file').trim() !== '' || r.str('poscar_file').trim() !== '';

/** natom + nghost, plus the projectile (setup_nuclei: natom_read). */
function expectedAtoms(r: MolgwReader): number {
  const projectile = PROJECTILE.includes(r.upper('excit_name')) ? 1 : 0;
  return (r.num('natom') ?? 0) + (r.num('nghost') ?? 0) + projectile;
}

function checkGeometry(r: MolgwReader, doc: MolgwDoc, ctx: MolgwContext, report: Report) {
  const nameSpan = doc.group!.nameSpan;
  const expected = expectedAtoms(r);
  const natom = r.num('natom') ?? 0;
  const projectile = expected - natom - (r.num('nghost') ?? 0);

  // length_unit: files are in angstrom (setup_nuclei).
  const unit = r.upper('length_unit');
  if (fromFile(r) && ['BOHR', 'AU', 'A.U', 'A.U.'].includes(unit)) {
    report('error', 'molgw-length-unit', "An xyz or POSCAR file is always in angstrom: MolGW stops (\"please set length_unit to Angstrom\") when length_unit is bohr.", r.has('length_unit') ? r.at('length_unit') : nameSpan);
  }

  if (fromFile(r)) {
    if (natom !== 0 && ctx.xyzAtoms !== undefined && natom + (r.num('nghost') ?? 0) + projectile !== ctx.xyzAtoms) {
      report('error', 'molgw-natom', `natom + nghost${projectile ? ' + the projectile' : ''} is ${natom + (r.num('nghost') ?? 0) + projectile}, but the xyz file has ${ctx.xyzAtoms} atoms: MolGW stops ("the number of atoms in the input file does not correspond to the number of atoms in the xyz file"). Drop natom to take the number from the file.`, r.at('natom'));
    }
    // Atom lines after the namelist are not read.
    const stray = doc.atoms.find((a) => isAtomLike(a));
    if (stray) report('warning', 'molgw-atoms-ignored', 'The atoms come from xyz_file/poscar_file: MolGW does not read the atom lines after the namelist.', { start: stray.line.start, end: stray.line.end });
  } else {
    if (expected < 1) {
      // setup_nuclei: "ncenter_basis < 1 which should be happening. Maybe natom is not set?"
      report('error', 'molgw-natom', 'natom is 0 (the default) and there is no xyz_file: MolGW has no atoms to read and stops ("ncenter_basis < 1 … Maybe natom is not set?"). Set natom to the number of atom lines after the namelist.', r.has('natom') ? r.at('natom') : nameSpan);
    }
    const atoms = doc.atoms;
    for (let i = 0; i < expected; i++) {
      const a = atoms[i];
      if (!a) {
        const last = doc.lines[doc.lines.length - 1];
        report('error', 'molgw-natom', `natom + nghost${projectile ? ' + the projectile' : ''} is ${expected}, so MolGW reads ${expected} atom lines after the \`/\`, but only ${atoms.length} follow: it stops at the end of the file.`, r.has('natom') ? r.at('natom') : { start: last.start, end: last.end });
        break;
      }
      checkAtom(a, report);
    }
    // More atom lines than natom + nghost: the rest is ignored.
    const extra = atoms.slice(expected).find((a) => isAtomLike(a));
    if (expected >= 1 && extra) {
      const more = atoms.slice(expected).filter((a) => isAtomLike(a)).length;
      report('warning', 'molgw-natom', `${more} more atom line${more > 1 ? 's' : ''} follow the ${expected} that natom + nghost asks for: MolGW does not read them. Is natom too small?`, { start: extra.line.start, end: extra.line.end });
    }
    // Per-atom basis sets stand in for `basis`.
    const missingBasis = noBasis(r);
    if (missingBasis && expected >= 1 && atoms.slice(0, expected).some((a) => a.fields.length < 5)) {
      report('error', 'molgw-required', "basis is mandatory (the manual marks it so): name the basis set (basis='cc-pVDZ'), or ecp_basis for effective core potentials, or give one on every atom line. MolGW cannot find the basis functions without it.", nameSpan);
    }
  }
  if (fromFile(r) && noBasis(r)) {
    report('error', 'molgw-required', "basis is mandatory when the atoms come from a file: name the basis set (basis='cc-pVDZ').", nameSpan);
  }
}

/** A line with an element and three numbers: it looks like an atom. */
const isAtomLike = (a: AtomLine) => a.fields.length >= 4 && !a.fields[0].text.startsWith('!') && a.fields.slice(1, 4).every((f) => isFortranReal(f.text));

/** setup_nuclei: `read(line_char, *) element_symbol, x_read(:, iatom)` and the element lookup. */
function checkAtom(a: AtomLine, report: Report) {
  const { line, fields } = a;
  const span = { start: line.start, end: line.end };
  if (fields.length === 0) {
    report('error', 'molgw-atom', 'A blank line where an atom is expected: MolGW reads exactly natom + nghost lines after the `/`, and a blank one fails the read (end of record). Remove it, or set natom correctly.', { start: line.start, end: line.start });
    return;
  }
  if (fields[0].text.startsWith('!')) {
    report('error', 'molgw-atom', "A comment line where an atom is expected: `!` is not a comment in the atom lines (they are read by list-directed input), so MolGW fails to read this line. Remove it or move it below the atoms.", span);
    return;
  }
  if (fields.length < 4) {
    report('error', 'molgw-atom', `An atom line is \`element x y z\`, found ${fields.length} field${fields.length === 1 ? '' : 's'}: MolGW stops reading it.`, span);
    return;
  }
  for (const f of fields.slice(1, 4)) {
    if (!isFortranReal(f.text)) {
      report('error', 'molgw-atom', `"${f.text}" is not a number: an atom line is \`element x y z [basis [auxiliary basis]]\`, and MolGW fails to read the coordinates.`, f);
      return;
    }
  }
  // The element: an atomic number, or one of the symbols of element_list (case-sensitive).
  const el = fields[0];
  const sym = stripQuotes(el.text);
  if (!isFortranReal(sym) && !MOLGW_ELEMENTS.includes(sym)) {
    const near = MOLGW_ELEMENTS.find((s) => s.toLowerCase() === sym.toLowerCase()) ?? closestOf(sym, MOLGW_ELEMENTS);
    report('error', 'molgw-element', `"${sym}" is not an element symbol MolGW knows (H … Lr, capital first letter, e.g. Cl): it stops with "element symbol not understood".${near ? ` Did you mean ${near}?` : ''}`, el, near ? rename(near, el) : undefined);
  }
  // Fields after the coordinates are basis names: `!` here is not a comment.
  for (const f of fields.slice(4)) {
    if (f.text.startsWith('!')) {
      report('warning', 'molgw-atom', '`!` is not a comment on an atom line: MolGW reads what follows as the basis set name of this atom and will not find it. Move the comment to its own line below the atoms.', { start: f.start, end: line.end });
      break;
    }
  }
}
