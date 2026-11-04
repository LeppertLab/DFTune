// Checks of a pw.x input against the pseudopotential files it names (ATOMIC_SPECIES).
//
// The files are looked up by the extension (it has the file system); this module only judges the
// result: wrong element, mixed functionals, cutoffs below what the generator suggests, and the
// number of valence electrons against nbnd and the occupations.

import type { Span } from '../incar/parse';
import { elementOf } from '../poscar/elements';
import type { Fix } from '../validation/rules';
import type { QeDoc } from './parse';
import { Reader } from './reader';
import type { Report } from './rules';
import { functionalKey, type UpfInfo } from './upf';

export interface PseudoFile {
  /** `missing`: not in the directory; `unreadable`: there, but not a UPF file. */
  status: 'ok' | 'missing' | 'unreadable';
  /** Directory the file was looked for in. */
  dir: string;
  info?: UpfInfo;
}

/** Pseudopotential files by the name given in ATOMIC_SPECIES. */
export type PseudoLookup = Map<string, PseudoFile>;

export interface QeContext {
  pseudos?: PseudoLookup;
  /** For a ph.x input: the pw.x input it continues. */
  pw?: QeDoc;
}

interface SpeciesRow {
  label: string;
  file: string;
  labelSpan: Span;
  fileSpan: Span;
  lineSpan: Span;
}

/** The label and file of each ATOMIC_SPECIES line. */
export function speciesRows(doc: QeDoc): SpeciesRow[] {
  const card = doc.cards.find((c) => c.name === 'ATOMIC_SPECIES');
  return (card?.lines ?? [])
    .filter((l) => l.tokens.length >= 3)
    .map((l) => ({ label: l.tokens[0].text, file: l.tokens[2].text, labelSpan: l.tokens[0], fileSpan: l.tokens[2], lineSpan: { start: l.start, end: l.end } }));
}

export function checkPseudos(doc: QeDoc, lookup: PseudoLookup, report: Report) {
  const r = new Reader(doc);
  const rows = speciesRows(doc);
  const found = rows.map((row) => ({ row, file: lookup.get(row.file) }));

  for (const { row, file } of found) {
    if (!file) continue;
    if (file.status === 'missing') {
      report('warning', 'qe-pseudo-missing', `Pseudopotential file ${row.file} not found in ${file.dir}. pw.x stops without it (check pseudo_dir; the directory is relative to where pw.x runs).`, row.fileSpan);
      continue;
    }
    const info = file.info;
    if (!info) continue;
    // The label is only a name, QE takes the element from the file: a mismatch is silent wrong physics.
    const labelElement = elementOf(row.label);
    if (labelElement && info.element && labelElement.toLowerCase() !== info.element.toLowerCase()) {
      report('warning', 'qe-pseudo-element', `Species ${row.label} uses ${row.file}, a pseudopotential for ${info.element}, not ${labelElement}.`, row.labelSpan);
    }
  }

  const infos = found.filter((f) => f.file?.status === 'ok' && f.file.info).map((f) => ({ row: f.row, info: f.file!.info! }));
  checkFunctionals(r, doc, infos, report);
  checkCutoffs(r, infos, report);
  checkElectrons(r, doc, rows, found, report);
  if (r.bool('SYSTEM', 'lspinorb') && infos.length && !infos.some((x) => x.info.spinOrbit)) {
    report('warning', 'qe-pseudo-so', 'lspinorb = .true. but none of the pseudopotentials contains spin–orbit coupling (fully relativistic): the spin–orbit terms will be missing.', r.entry('SYSTEM', 'lspinorb')!.keySpan);
  }
}

function checkFunctionals(r: Reader, doc: QeDoc, infos: { row: SpeciesRow; info: UpfInfo }[], report: Report) {
  if (r.has('SYSTEM', 'input_dft')) return;
  const keys = new Map<string, string[]>();
  for (const { row, info } of infos) {
    const key = functionalKey(info.functional);
    if (key) keys.set(key, [...(keys.get(key) ?? []), row.file]);
  }
  if (keys.size < 2) return;
  const summary = [...keys].map(([k, files]) => `${k} (${files.join(', ')})`).join(' vs. ');
  const at = doc.cards.find((c) => c.name === 'ATOMIC_SPECIES')?.nameSpan ?? { start: 0, end: 0 };
  report('warning', 'qe-pseudo-functional', `The pseudopotentials were generated with different functionals: ${summary}. pw.x can stop with "inconsistent DFT read from PP files"; set input_dft to choose one, or use matching pseudopotentials.`, at);
}

function checkCutoffs(r: Reader, infos: { row: SpeciesRow; info: UpfInfo }[], report: Report) {
  const wfc = r.num('SYSTEM', 'ecutwfc');
  if (wfc === undefined) return;
  const rho = r.num('SYSTEM', 'ecutrho');
  const wfcEntry = r.entry('SYSTEM', 'ecutwfc')!;
  for (const { row, info } of infos) {
    if (info.suggestedEcutwfc && wfc < info.suggestedEcutwfc) {
      report('warning', 'qe-cutoff-low', `ecutwfc = ${wfc} Ry is below the ${info.suggestedEcutwfc} Ry that the generator of ${row.file} suggests as a minimum.`, wfcEntry.valueSpan);
    }
    const effectiveRho = rho ?? 4 * wfc;
    if (info.suggestedEcutrho && effectiveRho < info.suggestedEcutrho) {
      const entry = r.entry('SYSTEM', 'ecutrho');
      report('warning', 'qe-cutoff-low', `${rho === undefined ? `The default ecutrho (4 × ecutwfc = ${effectiveRho} Ry)` : `ecutrho = ${rho} Ry`} is below the ${info.suggestedEcutrho} Ry that the generator of ${row.file} suggests as a minimum for the charge density.`, entry?.valueSpan ?? wfcEntry.valueSpan);
    }
  }
  const augmented = infos.find((x) => x.info.type === 'US' || x.info.type === 'PAW');
  if (augmented && rho === undefined && !infos.some((x) => x.info.suggestedEcutrho)) {
    report('info', 'qe-ecutrho-default', `${augmented.row.file} is ${augmented.info.type === 'PAW' ? 'a PAW' : 'an ultrasoft'} pseudopotential: the default ecutrho = 4 × ecutwfc is usually too low; 8–12 × ecutwfc is typical.`, wfcEntry.valueSpan);
  }
}

function checkElectrons(r: Reader, doc: QeDoc, rows: SpeciesRow[], found: { row: SpeciesRow; file: PseudoFile | undefined }[], report: Report) {
  // The number of electrons needs every species resolved, and the atoms of each.
  const positions = doc.cards.find((c) => c.name === 'ATOMIC_POSITIONS')?.lines.filter((l) => l.text.trim()) ?? [];
  if (!rows.length || !positions.length || found.some((f) => f.file?.info?.zValence === undefined)) return;
  const valence = new Map(found.map((f) => [f.row.label, f.file!.info!.zValence!]));
  let nelec = 0;
  for (const p of positions) {
    const z = valence.get(p.tokens[0]?.text ?? '');
    if (z === undefined) return;
    nelec += z;
  }
  nelec -= r.num('SYSTEM', 'tot_charge') ?? 0;

  const calc = r.str('CONTROL', 'calculation') ?? 'scf';
  const lscf = calc !== 'nscf' && calc !== 'bands';
  const noncolin = r.bool('SYSTEM', 'noncolin') === true;
  const nbnd = r.num('SYSTEM', 'nbnd');
  const needed = noncolin ? Math.round(nelec) : Math.round(nelec / 2);
  if (nbnd !== undefined && lscf && nbnd < needed) {
    report('error', 'qe-nbnd', `nbnd = ${nbnd} is too few for ${nelec} valence electrons: at least ${needed} bands are needed (pw.x stops with "too few bands").`, r.entry('SYSTEM', 'nbnd')!.valueSpan);
  }
  // setup.f90: an odd number of electrons with fixed occupations is a metal.
  const occ = r.str('SYSTEM', 'occupations') ?? 'fixed';
  const odd = Math.abs(Math.round(nelec / 2) - nelec / 2) > 1e-8;
  if (odd && lscf && !noncolin && occ === 'fixed' && !r.has('SYSTEM', 'tot_magnetization') && r.num('SYSTEM', 'nspin') !== 2) {
    report('warning', 'qe-odd-electrons', `${nelec} valence electrons (an odd number): the system must be a metal, but occupations are fixed. Use occupations = 'smearing' with degauss.`, (r.entry('SYSTEM', 'occupations') ?? r.entry('SYSTEM', 'nat'))?.valueSpan ?? { start: 0, end: 0 });
  }
}

export type { Fix };
