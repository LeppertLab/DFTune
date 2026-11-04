// Checks on a Quantum ESPRESSO input: what QE itself would stop on (unknown or misplaced
// variables, unreadable values, missing namelists), plus softer notes.
//
// Unlike VASP, QE rejects a variable it does not know ("bad line in namelist"), so those are errors.

import type { Span } from '../incar/parse';
import type { Diagnostic, Fix } from '../validation/rules';
import { editDistance } from '../validation/rules';
import type { QeDoc, QeEntry } from './parse';
import { allVarNames, cardsOf, lookupVar, namelistsDefining, namelistsOf, type QeProgram, type QeVar } from './tags';
import { automaticGrid, kpointsCard, setKpointsCard } from './kpoints';
import { checkPh, checkPhAgainstPw } from './phRules';
import { checkPseudos, type QeContext } from './pseudos';
import { qeCell } from './structure';
import { checkPw } from './rules';
import { checkItem, isInteger, isQuoted, unquote, valueItems } from './values';

const REQUIRED_CARDS: Partial<Record<QeProgram, string[]>> = { pw: ['ATOMIC_SPECIES', 'ATOMIC_POSITIONS', 'K_POINTS'] };
const START: Span = { start: 0, end: 0 };

/** The nearest variable name to `name`, for typos; edit distance 1 (2 for longer names). */
export function closestVar(program: QeProgram, name: string): string | undefined {
  let best: string | undefined;
  let bestDist = name.length > 5 ? 2 : 1;
  for (const candidate of allVarNames(program)) {
    if (Math.abs(candidate.length - name.length) > bestDist) continue;
    const d = editDistance(name, candidate);
    if (d > 0 && (best ? d < bestDist : d <= bestDist)) {
      best = candidate;
      bestDist = d;
    }
  }
  return best;
}

const rename = (to: string, span: Span): Fix => ({ title: `Change to ${to}`, edit: { start: span.start, end: span.end, text: to } });

export function validateQe(doc: QeDoc, program: QeProgram, ctx: QeContext = {}): Diagnostic[] {
  const out: Diagnostic[] = [...doc.issues];
  const report = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Fix) => out.push({ severity, code, message, span, ...(fix && { fix }) });

  // The QE input documentation: "TABS, CRLF, ANY OTHER STRANGE CHARACTER, ARE A SOURCE OF TROUBLE".
  const crlf = doc.text.indexOf('\r\n');
  if (crlf >= 0) {
    report('warning', 'qe-crlf', 'The file has Windows line endings (CRLF). QE can fail on them, e.g. a pseudopotential file name then ends in a carriage return. Convert them to LF.', { start: crlf, end: crlf + 2 }, {
      title: 'Convert line endings to LF',
      edit: { start: 0, end: doc.text.length, text: doc.text.replace(/\r\n/g, '\n') },
    });
  }
  const tab = doc.text.indexOf('\t');
  if (tab >= 0) {
    report('warning', 'qe-tab', 'The file contains tab characters. The QE input documentation lists tabs among the sources of trouble: use spaces.', { start: tab, end: tab + 1 }, {
      title: 'Replace tabs by spaces',
      edit: { start: 0, end: doc.text.length, text: doc.text.replace(/\t/g, '  ') },
    });
  }
  checkNamelists(doc, program, report);
  for (const nl of doc.namelists) {
    const seen = new Set<string>();
    for (const e of nl.entries) {
      const v = lookupVar(program, nl.name, e.name);
      if (!v) {
        reportUnknown(program, e, nl.name, report);
        continue;
      }
      if (v.status === 'obsolete') report('warning', 'qe-obsolete', `${v.name} is obsolete: pw.x still reads it but prints a warning. ${v.summary.replace(/^Obsolete: [^.]*\.\s*/, '')}`.trim(), e.keySpan);
      const id = `${e.name}(${e.index ?? ''})`;
      if (seen.has(id)) report('warning', 'qe-duplicate', `${v.name}${e.index ? `(${e.index})` : ''} is set more than once; QE uses the last value.`, e.span);
      seen.add(id);
      checkEntry(e, v, report);
    }
    // Required variables of the namelists that are present.
    const names = new Set(nl.entries.map((e) => e.name));
    for (const v of Object.values(requiredOf(program, nl.name))) {
      if (names.has(v.name.toLowerCase()) || (v.name === 'ibrav' && names.has('space_group'))) continue;
      report('error', 'qe-required', `${v.name} is required in &${nl.name}${v.summary ? `: ${v.summary.replace(/\.$/, '')}` : ''}.`, nl.nameSpan);
    }
  }
  checkCards(doc, program, report);
  if (program === 'pw') {
    checkPw(doc, report);
    if (ctx.pseudos) checkPseudos(doc, ctx.pseudos, report);
  }
  if (program === 'ph') {
    checkPh(doc, report);
    if (ctx.pw) checkPhAgainstPw(doc, ctx.pw, report);
  }
  return out;
}

type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Fix) => void;

const requiredCache = new Map<string, Record<string, QeVar>>();
function requiredOf(program: QeProgram, namelist: string): Record<string, QeVar> {
  const key = `${program}/${namelist}`;
  let r = requiredCache.get(key);
  if (!r) {
    r = {};
    const names = allVarNames(program);
    for (const n of names) {
      const v = lookupVar(program, namelist, n);
      if (v?.required) r[n] = v;
    }
    requiredCache.set(key, r);
  }
  return r;
}

function checkNamelists(doc: QeDoc, program: QeProgram, report: Report) {
  const order = namelistsOf(program);
  const seen = new Set<string>();
  let last = -1;
  for (const nl of doc.namelists) {
    const at = order.indexOf(nl.name);
    if (at < 0) {
      const close = order.find((n) => editDistance(n, nl.name) <= 2);
      report('error', 'qe-namelist', `&${nl.name} is not a namelist of ${program}.x${order.length ? ` (it reads ${order.map((n) => '&' + n).join(', ')})` : ''}.`, nl.nameSpan, close ? rename('&' + close, nl.nameSpan) : undefined);
      continue;
    }
    if (seen.has(nl.name)) report('error', 'qe-namelist-twice', `&${nl.name} appears more than once.`, nl.nameSpan);
    else if (at < last) report('error', 'qe-namelist-order', `&${nl.name} must come before &${order[last]}: ${program}.x reads the namelists in the order ${order.map((n) => '&' + n).join(', ')}.`, nl.nameSpan);
    seen.add(nl.name);
    last = Math.max(last, at);
  }
  // pw.x always reads these three; the others only when the calculation needs them.
  if (program === 'pw') {
    for (const required of ['CONTROL', 'SYSTEM', 'ELECTRONS']) {
      if (!seen.has(required)) report('error', 'qe-namelist-missing', `&${required} is missing: pw.x always reads it.`, START);
    }
  }
}

function reportUnknown(program: QeProgram, e: QeEntry, namelist: string, report: Report) {
  const text = e.name;
  const elsewhere = namelistsDefining(program, text).filter((n) => n !== namelist);
  if (elsewhere.length) {
    report('error', 'qe-misplaced', `${shown(program, elsewhere[0], text)} belongs in &${elsewhere.join(' or &')}, not &${namelist}: QE stops on a variable in the wrong namelist.`, e.keySpan);
    return;
  }
  const close = closestVar(program, text);
  if (close) {
    const target = namelistsDefining(program, close)[0];
    const name = shown(program, target, close);
    const sameList = target === namelist;
    report('error', 'qe-unknown-variable', `Unknown variable ${text} in &${namelist}. Did you mean ${name}${sameList ? '' : ` (in &${target})`}?`, e.keySpan, sameList ? rename(name, e.keySpan) : undefined);
  } else {
    report('error', 'qe-unknown-variable', `${text} is not a variable of &${namelist}: QE stops on unknown variables.`, e.keySpan);
  }
}

/** A variable name with its documented capitalization (Hubbard_U, not hubbard_u). */
function shown(program: QeProgram, namelist: string, name: string): string {
  return lookupVar(program, namelist, name)?.name ?? name;
}

function checkEntry(e: QeEntry, v: QeVar, report: Report) {
  const label = `${v.name}${e.index ? `(${e.index})` : ''}`;
  // Index (only where the documentation gives the dimension).
  if (e.index !== undefined && !v.status) {
    if (!v.dim) {
      report('error', 'qe-index', `${v.name} is not an array: remove (${e.index}).`, e.keySpan);
    } else {
      const [lo, hi] = v.dim.split(':');
      const first = e.index.split(',')[0].trim();
      if (isInteger(first) && isInteger(lo) && (Number(first) < Number(lo) || (isInteger(hi) && Number(first) > Number(hi)))) {
        report('error', 'qe-index', `${label}: the index must be between ${lo} and ${hi}.`, e.keySpan);
      }
    }
  }
  if (e.valueSpan.start === e.valueSpan.end) {
    report('error', 'qe-value', `${label}: missing value.`, e.span);
    return;
  }
  const items = valueItems(e.value);
  if (!v.type) return;
  // Scalars take one value; arrays any number (each goes to the next element).
  if (!v.dim && !e.index && items.length > 1) {
    report('error', 'qe-value', `${label} takes a single value, got ${items.length}.`, e.valueSpan);
    return;
  }
  if (v.type === 'character') {
    checkString(e, v, label, items, report);
    return;
  }
  for (const item of items) {
    const problem = checkItem(v.type, item);
    if (problem) {
      report('error', 'qe-value', `${label}: ${problem}.`, e.valueSpan);
      return;
    }
  }
}

function checkString(e: QeEntry, v: QeVar, label: string, items: string[], report: Report) {
  for (const item of items) {
    if (!isQuoted(item)) {
      // gfortran reads bare words, other compilers do not; QE's own examples always quote.
      report('warning', 'qe-unquoted', `${label}: write the string in quotes: '${item}'.`, e.valueSpan, {
        title: `Quote the value: '${item}'`,
        edit: { start: e.valueSpan.start, end: e.valueSpan.end, text: items.map((x) => (isQuoted(x) ? x : `'${x}'`)).join(', ') },
      });
      break;
    }
  }
  if (!v.options.length || items.length !== 1) return;
  const given = unquote(items[0]).trim().toLowerCase();
  if (given === '' || v.options.some((o) => o.value.toLowerCase() === given)) return;
  const choices = [...new Set(v.options.map((o) => o.value))];
  const near = choices.find((c) => editDistance(c.toLowerCase(), given) <= 1);
  report('warning', 'qe-option', `${label}: '${unquote(items[0])}' is not one of ${choices.map((c) => `'${c}'`).join(', ')}.`, e.valueSpan, near ? { title: `Change to '${near}'`, edit: { start: e.valueSpan.start, end: e.valueSpan.end, text: `'${near}'` } } : undefined);
}

/** A K_POINTS card for a spacing of 0.3 Å⁻¹ when the cell is known, else 4 × 4 × 4. */
function missingKpointsFix(doc: QeDoc): Fix {
  const cell = qeCell(doc);
  const known = cell && !('error' in cell);
  const grid = known ? automaticGrid(cell, 0.3) : ([4, 4, 4] as [number, number, number]);
  return { title: `Add K_POINTS {automatic} ${grid.join(' ')}${known ? ' (spacing 0.3 Å⁻¹)' : ''}`, edit: setKpointsCard(doc, kpointsCard(grid)) };
}

function checkCards(doc: QeDoc, program: QeProgram, report: Report) {
  const known = new Set(cardsOf(program));
  const seen = new Set<string>();
  for (const card of doc.cards) {
    if (!known.has(card.name)) continue;
    if (seen.has(card.name)) report('error', 'qe-card-twice', `Card ${card.name} appears more than once.`, card.nameSpan);
    seen.add(card.name);
  }
  for (const required of REQUIRED_CARDS[program] ?? []) {
    if (!seen.has(required) && doc.namelists.length) {
      report('error', 'qe-card-missing', `Card ${required} is missing.`, START, required === 'K_POINTS' ? missingKpointsFix(doc) : undefined);
    }
  }
}

