// Checks on a BerkeleyGW input. Every error mirrors what the Fortran reader does: unknown keywords and
// blocks, unreadable values and block rows all stop the code (die(), or a failed list-directed read).

import type { Span } from '../incar/parse';
import { isInteger, isNumber } from '../lines';
import type { Diagnostic, Fix } from '../validation/rules';
import { editDistance } from '../validation/rules';
import { checkEpsilon } from './epsilon';
import { checkBse } from './bse';
import { checkSigma } from './sigma';
import { checkWorkflow, type BgwNeighbor } from './workflow';
import type { BgwBlock, BgwDoc, BgwEntry } from './parse';
import { allKeywordNames, isAcceptedUndocumented, lookupKeyword, type BgwProgram } from './tags';

type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Fix) => void;

/**
 * The blocks each program reads, with the columns of a row: how many values, and which must be integers.
 * Epsilon.inp, Sigma/inread.f90: the other programs have none ("Unexpected blockword").
 */
const BLOCKS: Partial<Record<BgwProgram, Record<string, { values: number; integers: number[]; what: string }>>> = {
  epsilon: { qpoints: { values: 5, integers: [4], what: 'qx qy qz 1/scale_factor is_q0' } },
  sigma: {
    kpoints: { values: 4, integers: [], what: 'kx ky kz 1/scale_factor' },
    qpoints: { values: 5, integers: [4], what: 'qx qy qz 1/scale_factor is_q0' },
    diag: { values: 1, integers: [0], what: 'one band index' },
    offdiag: { values: 3, integers: [0, 1, 2], what: 'three band indices n m l' },
  },
};

/** The nearest accepted keyword: the same name in other case first (they are case-sensitive), then by edit distance. */
export function closestKeyword(program: BgwProgram, name: string): string | undefined {
  const names = allKeywordNames(program);
  const sameLetters = names.find((n) => n.toLowerCase() === name.toLowerCase());
  if (sameLetters) return sameLetters;
  let best: string | undefined;
  let bestDist = name.length > 6 ? 2 : 1;
  for (const n of names) {
    if (Math.abs(n.length - name.length) > bestDist) continue;
    const d = editDistance(name, n);
    if (d > 0 && (best ? d < bestDist : d <= bestDist)) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

const rename = (to: string, span: Span): Fix => ({ title: `Change to ${to}`, edit: { start: span.start, end: span.end, text: to } });

export interface BgwContext {
  /** The neighbouring inputs of the same workflow (epsilon ↔ sigma, kernel ↔ absorption), when found. */
  neighbors?: BgwNeighbor[];
}

export function validateBgw(doc: BgwDoc, program: BgwProgram, ctx: BgwContext = {}): Diagnostic[] {
  const out: Diagnostic[] = [...doc.issues];
  const report: Report = (severity, code, message, span, fix) => out.push({ severity, code, message, span, ...(fix && { fix }) });
  const file = `${program}.inp`;

  const seen = new Map<string, BgwEntry>();
  for (const e of doc.entries) {
    const k = lookupKeyword(program, e.keyword);
    if (!k) {
      if (isAcceptedUndocumented(program, e.keyword)) {
        if (seen.has(e.keyword)) report('warning', 'bgw-duplicate', `${e.keyword} is set more than once; BerkeleyGW uses the last value.`, e.keySpan);
        seen.set(e.keyword, e);
        continue;
      }
      const close = closestKeyword(program, e.keyword);
      report('error', 'bgw-unknown-keyword', `Unexpected keyword ${e.keyword}: BerkeleyGW stops on keywords it does not know${close ? `. Did you mean ${close}?` : ' (keywords are case-sensitive).'}`, e.keySpan, close ? rename(close, e.keySpan) : undefined);
      continue;
    }
    if (k.kind === 'block') {
      report('error', 'bgw-block-keyword', `${e.keyword} is a block: write "begin ${e.keyword}", its rows, and "end".`, e.keySpan);
      continue;
    }
    if (seen.has(e.keyword)) report('warning', 'bgw-duplicate', `${e.keyword} is set more than once; BerkeleyGW uses the last value.`, e.keySpan);
    seen.set(e.keyword, e);
    checkValue(e, k.type, k.example, k.options.map((o) => o.value), report);
  }

  // do_rpa changes the q-point rows, so it has to come first.
  const rpa = doc.entries.find((e) => e.keyword === 'do_rpa');
  for (const b of doc.blocks) {
    checkBlock(b, program, file, !!rpa, report, doc.text);
    if (rpa && b.name === 'qpoints' && rpa.span.start > b.span.start) {
      report('error', 'bgw-rpa-order', 'do_rpa must be set before `begin qpoints`: it adds a weight to every q-point row.', rpa.keySpan);
    }
  }

  if (program === 'epsilon') checkEpsilon(doc, report);
  if (program === 'sigma') checkSigma(doc, report);
  if (program === 'absorption' || program === 'inteqp') checkBse(doc, program, report);
  if (ctx.neighbors?.length) checkWorkflow(program, doc, ctx.neighbors, report);

  // The keywords and blocks the documentation marks as required.
  const blocks = new Set(doc.blocks.map((b) => b.name));
  // sigma.inp: the bands may come from a `begin diag` block instead of band_index_min/max.
  const diagBands = program === 'sigma' && doc.blocks.some((b) => b.name === 'diag' && b.rows.length);
  for (const k of requiredOf(program)) {
    if (diagBands && (k.name === 'band_index_min' || k.name === 'band_index_max')) continue;
    const present = k.kind === 'block' ? blocks.has(k.name) : seen.has(k.name);
    if (!present) report('error', 'bgw-required', `${k.kind === 'block' ? `begin ${k.name} … end` : k.name} is required in ${file}.`, { start: 0, end: 0 });
  }
  // The generic "not a documented value" note is dropped where a specific rule explains the same value.
  return out.filter((d) => !(d.code === 'bgw-option' && out.some((o) => o !== d && o.code !== 'bgw-option' && o.span?.start === d.span?.start)));
}

function requiredOf(program: BgwProgram) {
  return allKeywordNames(program)
    .map((n) => lookupKeyword(program, n))
    .filter((k): k is NonNullable<typeof k> => !!k && k.required);
}

/** Reads the value as the Fortran `read(line,*)` would: the first token(s) must be of the type. */
function checkValue(e: BgwEntry, type: string, example: string, options: string[], report: Report) {
  const first = e.args[0];
  if (type === 'toggle') return; // a flag: anything after it is not read
  if (!first) {
    report('error', 'bgw-value', `${e.keyword} needs a value: BerkeleyGW stops with "Unexpected characters were found while reading the value".`, e.keySpan);
    return;
  }
  if (type === 'integer' && !isInteger(first.text)) {
    report('error', 'bgw-value', `${e.keyword} needs an integer, found "${first.text}".`, first);
  } else if (type === 'float' && !isNumber(first.text)) {
    report('error', 'bgw-value', `${e.keyword} needs a number, found "${first.text}".`, first);
  } else if (type === 'array') {
    const need = example.split(/\s+/).filter(Boolean);
    // Numeric arrays: every value is read, so too few is an error (the end of the line).
    if (need.length && need.every(isNumber)) {
      const bad = e.args.slice(0, need.length).find((t) => !isNumber(t.text));
      if (bad) report('error', 'bgw-value', `${e.keyword}: "${bad.text}" is not a number.`, bad);
      else if (e.args.length < need.length) report('error', 'bgw-value', `${e.keyword} needs ${need.length} values (like "${example}"), found ${e.args.length}.`, e.valueSpan);
    }
  } else if (type === 'integer' && options.length >= 2 && !options.includes(String(Number(first.text)))) {
    report('warning', 'bgw-option', `${e.keyword} = ${first.text} is not one of the documented values (${options.join(', ')}).`, first);
  }
}

function checkBlock(b: BgwBlock, program: BgwProgram, file: string, rpa: boolean, report: Report, text: string) {
  const spec = BLOCKS[program]?.[b.name];
  if (!spec) {
    const known = Object.keys(BLOCKS[program] ?? {});
    report('error', 'bgw-block', `Unexpected blockword ${b.name} was found in ${file}${known.length ? ` (it reads ${known.map((n) => `begin ${n}`).join(', ')})` : ': this input has no blocks'}.`, b.nameSpan);
    return;
  }
  if (!b.closed) {
    report('error', 'bgw-unterminated', `begin ${b.name} is not closed: the block ends at a line that is exactly "end" (in the first column), and BerkeleyGW stops at the end of the file.`, b.nameSpan);
  }
  const values = spec.values + (rpa && b.name === 'qpoints' && program === 'epsilon' ? 1 : 0);
  for (const row of b.rows) {
    const t = row.text.trim();
    if (t === '' || row.text[0] === '#') {
      report('error', 'bgw-block-row', `${t === '' ? 'A blank line' : 'A comment'} inside a block is read as a row: BerkeleyGW stops ("Unexpected characters or missing value while reading elements of the ${b.name} block").`, row.start === row.end ? { start: row.start, end: row.start } : { start: row.start, end: row.end }, {
        title: t === '' ? 'Remove the blank line' : 'Remove the comment line',
        edit: { start: row.start, end: row.end + (text.startsWith('\r\n', row.end) ? 2 : 1), text: '' },
      });
      continue;
    }
    if (row.tokens.length < values || !row.tokens.slice(0, values).every((x) => isNumber(x.text))) {
      report('error', 'bgw-block-row', `A ${b.name} row needs ${values} numbers (${spec.what}${values > spec.values ? ' and the weight' : ''}), found "${t}".`, { start: row.start, end: row.end });
      continue;
    }
    for (const i of spec.integers) {
      if (!isInteger(row.tokens[i].text)) report('error', 'bgw-block-row', `Column ${i + 1} of a ${b.name} row must be an integer, found "${row.tokens[i].text}".`, row.tokens[i]);
    }
    if (spec.values >= 4 && Number(row.tokens[3].text) === 0) report('error', 'bgw-block-row', 'The 1/scale_factor column is a divisor: it cannot be 0.', row.tokens[3]);
    if (program === 'epsilon' && b.name === 'qpoints' && isInteger(row.tokens[4].text) && Number(row.tokens[4].text) > 2) {
      report('error', 'bgw-block-row', 'Illegal value for the last column of a qpoints row: it may only be -1, 0, 1 or 2.', row.tokens[4]);
    }
  }
}
