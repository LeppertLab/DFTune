// Generates src/core/abinit/variables.generated.ts from the variable database of ABINIT:
// abimkdocs/variables_abinit.py in https://github.com/abinit/abinit (the source of
// https://docs.abinit.org/variables/). Run:
//
//   node scripts/fetch-abinit-variables.mjs [path to variables_abinit.py] [revision label] [path to src/57_iovars]
//
// Without a path the files are downloaded from the master branch. The Python file is read as DATA with
// a tolerant text scanner (strings, brackets and commas are tracked); it is never executed.
//
// Every entry is `Variable(abivarname=..., vartype=..., dimensions=..., defaultval=..., mnemonics=...,
// characteristics=..., requires=..., excludes=..., text=r"""...""")`. The allowed values are taken
// from the bullet lists of the description: `* 0 --> text`, `* "bfgs" --> text`, `* **ixc** = 0: text`.
//
// The Fortran sources of src/57_iovars (readers m_invars*.F90, m_ingeo.F90, m_inkpts.F90 and the echo routines
// m_outvar_*.F90) are scanned too: ABINIT accepts every name it reads with `intagm` or echoes with `prttagm`, and
// some (use_rcpaw, SpinPolarized, mkmem, ...) are not in the documentation. Those are recorded as undocumented,
// with the type they are read with.
//
// ABINIT is distributed under the GNU General Public License, version 3 (LICENSES/ABINIT-GPL-3.0.txt);
// the descriptions are excerpts from its documentation and keep that notice.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_VARS = 'https://raw.githubusercontent.com/abinit/abinit/master/abimkdocs/variables_abinit.py';
const src = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(URL_VARS)).text();
const REVISION = process.argv[3] ?? 'master';
const SRC_FILES = ['m_invars1.F90', 'm_invars2.F90', 'm_ingeo.F90', 'm_inkpts.F90', 'm_mpi_setup.F90', 'm_chkinp.F90', 'm_outvar_a_h.F90', 'm_outvar_i_n.F90', 'm_outvar_o_z.F90'];
const URL_SRC = 'https://raw.githubusercontent.com/abinit/abinit/master/src/57_iovars/';
const readers = [];
for (const f of SRC_FILES) {
  readers.push(process.argv[4] ? readFileSync(join(process.argv[4], f), 'utf8') : await (await fetch(URL_SRC + f)).text());
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'abinit', 'variables.generated.ts');

// ---------------------------------------------------------------- scanning

/** Index just past the Python expression that starts at `i`: up to a comma or closing bracket at depth 0. */
function exprEnd(s, i) {
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const triple = s.startsWith(c.repeat(3), i);
      const raw = /[rR]/.test(s[i - 1] ?? '');
      const q = triple ? c.repeat(3) : c;
      i += q.length;
      while (i < s.length && !s.startsWith(q, i)) i += !raw && s[i] === '\\' ? 2 : 1;
      i += q.length;
      continue;
    }
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return i;
      depth--;
    } else if (c === ',' && depth === 0) return i;
    i++;
  }
  return i;
}

/** The fields of the `Variable(` call that starts at `at`, as raw expression text. */
function fieldsOf(s, at) {
  const fields = {};
  let i = at + 'Variable('.length;
  for (;;) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (s[i] === ')' || i >= s.length) break;
    const m = /^(\w+)\s*=\s*/.exec(s.slice(i, i + 80));
    if (!m) break;
    i += m[0].length;
    const end = exprEnd(s, i);
    fields[m[1]] = s.slice(i, end).trim();
    i = end;
  }
  return { fields, end: i };
}

/** A Python string literal (or several adjacent ones), or undefined. */
function pyString(raw) {
  if (raw === undefined) return undefined;
  let rest = raw.trim();
  let res = '';
  let any = false;
  for (;;) {
    const m = /^([rRuUbB]*)("""|'''|"|')/.exec(rest);
    if (!m) break;
    const isRaw = /[rR]/.test(m[1]);
    let i = m[0].length;
    let body = '';
    while (i < rest.length && !rest.startsWith(m[2], i)) {
      if (!isRaw && rest[i] === '\\' && i + 1 < rest.length) {
        const n = rest[i + 1];
        body += n === 'n' ? '\n' : n === 't' ? '\t' : n === '\n' ? '' : n;
        i += 2;
      } else body += rest[i++];
    }
    res += body;
    any = true;
    rest = rest.slice(i + m[2].length).trimStart();
  }
  return any ? res : undefined;
}

/** Items of a Python list literal (raw text of each item). */
function listItems(raw) {
  const t = raw.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return undefined;
  const body = t.slice(1, -1);
  const items = [];
  let i = 0;
  while (i < body.length) {
    const end = exprEnd(body + ')', i);
    const item = body.slice(i, end).trim();
    if (item) items.push(item);
    i = end + 1;
  }
  return items;
}

/** The [key, raw value] pairs of a Python dict literal body (the text between the braces). */
function dictPairs(body) {
  const pairs = [];
  let i = 0;
  while (i < body.length) {
    const km = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:\s*/.exec(body.slice(i));
    if (!km) break;
    i += km[0].length;
    const end = exprEnd(body + ')', i);
    pairs.push([pyString(km[1]), body.slice(i, end).trim()]);
    i = end + 1;
  }
  return pairs;
}

// ---------------------------------------------------------------- text helpers

/** `[[name]]` links and `[[cite:x]]` markers of the ABINIT documentation, as plain text. */
function cleanDoc(t) {
  return t
    .replace(/\[\[cite:[^\]]*\]\]/g, '')
    .replace(/\[\[(?:help|topic|tutorial|theory|faq|varset|pdf):[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[(?:help|topic|tutorial|theory|faq|varset|pdf):([^\]|]*)\]\]/g, '$1')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/^\s*!!!\s*\w+\s*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain expression text: `[[natom]]` → natom. */
const plain = (s) => cleanDoc(s).replace(/\s+/g, ' ');

const MAX_DOC = 1000;
function shorten(t) {
  if (t.length <= MAX_DOC) return t;
  const cut = t.slice(0, MAX_DOC);
  const para = cut.lastIndexOf('\n\n');
  return (para > MAX_DOC / 2 ? cut.slice(0, para) : cut.replace(/\s+\S*$/, '')).trimEnd() + ' …';
}

/** The allowed values listed as bullets in the description: [value, note][]. */
function optionsOf(text) {
  const re = /^(\s*)[*-]\s+(?:\*\*\w+\*\*\s*(?:=|==)\s*)?("[^"\n]+"|-?\d+)\s*(?:-->|:|=>)\s*(.*)$/;
  const found = [];
  for (const line of text.split('\n')) {
    const m = re.exec(line);
    if (m) found.push({ indent: m[1].length, value: m[2].replace(/^"(.*)"$/, '$1'), note: m[3] });
  }
  if (found.length < 2) return [];
  const indent = Math.min(...found.map((f) => f.indent));
  const seen = new Set();
  const res = [];
  for (const f of found) {
    if (f.indent !== indent || seen.has(f.value)) continue;
    seen.add(f.value);
    const note = plain(f.note).replace(/\s*\*\*[A-Z][^*]*:\*\*.*$/, '');
    res.push([f.value, note.length > 160 ? note.slice(0, 160).replace(/\s+\S*$/, '') + ' …' : note]);
  }
  return res;
}

// ---------------------------------------------------------------- field values

/** Splits `3, natom` at the commas outside brackets. */
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
}

/** A (possibly nested) Python list as space-separated text. */
function flat(raw) {
  const items = listItems(raw);
  return items ? items.map(flat).join(' ') : (pyString(raw) ?? raw.trim());
}

/** Dimensions as a list of plain strings ([] for a scalar). */
function dimsOf(raw) {
  if (raw === undefined) return [];
  const s = pyString(raw);
  if (s !== undefined) return s === 'scalar' ? [] : splitTop(plain(s));
  const items = listItems(raw);
  if (items) return items.flatMap((x) => splitTop(plain(pyString(x) ?? x)));
  const m = /ValueWithConditions\(\{([\s\S]*)\}\)/.exec(raw);
  if (m) {
    // "cond": dims, the unconditional entry ("defaultval") first, else the first one.
    const pairs = dictPairs(m[1]);
    const dflt = pairs.find((p) => p[0] === 'defaultval') ?? pairs[0];
    const items2 = dflt && (listItems(dflt[1]) ?? [dflt[1]]);
    return items2 ? items2.flatMap((x) => splitTop(plain(pyString(x) ?? x).replace(/^\[|\]$/g, '').trim())) : [];
  }
  return [plain(raw)];
}

/** The default value as readable text ('' when none is given). */
function defaultOf(raw, comment) {
  if (raw === undefined) return '';
  const s = pyString(raw);
  if (s !== undefined) return plain(s);
  const t = raw.trim();
  if (t === 'None') return '';
  let m = /^MultipleValue\(([\s\S]*)\)$/.exec(t);
  if (m) {
    const num = /number\s*=\s*(\w+)/.exec(m[1])?.[1];
    const val = /value\s*=\s*("[^"]*"|'[^']*'|[^,)\s]+)/.exec(m[1])?.[1] ?? '';
    const v = pyString(val) ?? val;
    return num && num !== 'None' && /^\d+$/.test(num) ? Array(Number(num)).fill(v).join(' ') : `${v} (every element)`;
  }
  m = /^Range\(\{([\s\S]*)\}\)$/.exec(t);
  if (m) {
    const start = /"start"\s*:\s*([^,}]+)/.exec(m[1])?.[1]?.trim();
    const stop = /"stop"\s*:\s*("[^"]*"|[^,}]+)/.exec(m[1])?.[1]?.trim();
    return `${plain(pyString(start) ?? start ?? '')}…${plain(pyString(stop) ?? stop ?? '')}`;
  }
  m = /^ValueWithConditions\(\{([\s\S]*)\}\)$/.exec(t);
  if (m) {
    const pairs = dictPairs(m[1]);
    const show = (v) => plain(flat(v));
    const dflt = pairs.find((p) => p[0] === 'defaultval');
    const rest = pairs.filter((p) => p !== dflt).map((p) => `${show(p[1])} if ${plain(p[0])}`);
    const base = dflt && dflt[1] !== 'None' ? show(dflt[1]) : '';
    return [base, ...rest].filter(Boolean).join('; ');
  }
  if (listItems(t)) return flat(t);
  if (/^[-+]?[\d.]+(?:[eEdD][-+]?\d+)?$/.test(t)) return t;
  return plain(t.replace(/\s+/g, ' ')) + (comment ? '' : '');
}

const charsOf = (raw) => (raw === undefined ? [] : (listItems(raw) ?? []).map((x) => (pyString(x) ?? x).replace(/\[\[|\]\]/g, '').toLowerCase()));

// ---------------------------------------------------------------- run

const rows = {};
let at = -1;
while ((at = src.indexOf('Variable(', at + 1)) !== -1) {
  // Only the entries of the list: `Variable(` at the start of a line.
  if (at > 0 && src[at - 1] !== '\n') continue;
  const { fields, end } = fieldsOf(src, at);
  const name = pyString(fields.abivarname);
  if (!name) continue;
  const type = pyString(fields.vartype) ?? 'real';
  const text = cleanDoc(pyString(fields.text) ?? '');
  const comment = pyString(fields.commentdefault);
  const reqs = pyString(fields.requires);
  const excl = pyString(fields.excludes);
  rows[name] = [
    type,
    dimsOf(fields.dimensions),
    defaultOf(fields.defaultval, comment),
    pyString(fields.mnemonics) ?? '',
    charsOf(fields.characteristics),
    pyString(fields.varset) ?? '',
    shorten(text),
    optionsOf(pyString(fields.text) ?? ''),
    reqs ? plain(reqs) : '',
    excl ? plain(excl).replace(/^'|'$/g, '') : '',
    comment ? plain(comment) : '',
    pyString(fields.added_in_version) ?? '',
  ];
  at = end - 1;
}

// Names the readers take with intagm: `intagm(dprarr,intarr,jdtset,marr,1,string(1:lenstr),'name',tread,'INT')`.
const readAs = {};
const echoed = {};
for (const code of readers) {
  const statements = code
    .replace(/&[ \t]*\n[ \t]*&?/g, ' ')
    .split('\n')
    .map((l) => l.replace(/!.*$/, ''))
    .filter((l) => /intagm/i.test(l));
  for (const st of statements) {
    const m = /string\s*(?:\([^)]*\))?\s*,\s*['"]([A-Za-z][A-Za-z_0-9]*)['"]\s*,\s*\w+\s*,\s*['"]([A-Z_]+)['"]/.exec(st);
    if (m) readAs[m[1].toLowerCase()] ??= m[2].toLowerCase();
  }
  // prttagm(dprarr,intarr,iout,jdtset_,1,marr,1,narrm,ncid,ndtset_alloc,'name','INT',...)
  for (const st of code.replace(/&[ \t]*\n[ \t]*&?/g, ' ').split('\n').map((l) => l.replace(/!.*$/, '')).filter((l) => /prttagm/i.test(l))) {
    const m = /ndtset_alloc\s*,\s*['"]([A-Za-z][A-Za-z_0-9]*)['"]\s*,\s*['"]([A-Z_]+)['"]/.exec(st);
    // The echo routines cut names at 16 characters (dmft_triqs_compu): those are not names.
    if (m && m[1].length !== 16) echoed[m[1].toLowerCase()] ??= m[2].toLowerCase();
  }
}
for (const [n, k] of Object.entries(echoed)) readAs[n] ??= k;
const undocumented = Object.fromEntries(Object.entries(readAs).filter(([n]) => !rows[n]));
// Where the documentation and the reader disagree on integer or real (recrcut, td_scthr, ...), the reader wins:
// it decides what ABINIT accepts.
const corrected = [];
for (const [n, k] of Object.entries(readAs)) {
  const row = rows[n];
  if (!row) continue;
  const code = k === 'int' ? 'integer' : ['dpr', 'len', 'ene', 'bfi', 'tim'].includes(k) ? 'real' : undefined;
  if (code && row[0] !== code && ['integer', 'real'].includes(row[0])) {
    corrected.push(`${n}: ${row[0]} -> ${code}`);
    row[0] = code;
  }
}
const undocumentedSorted = Object.fromEntries(Object.entries(undocumented).sort(([a], [b]) => a.localeCompare(b)));

const names = Object.keys(rows).sort();
if (names.length < 900) {
  console.error(`only ${names.length} variables found: the file format has probably changed`);
  process.exit(1);
}

const lines = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(rows[n])},`);
writeFileSync(
  out,
  `// Generated by scripts/fetch-abinit-variables.mjs from abimkdocs/variables_abinit.py of ABINIT (${REVISION}),
// the source of https://docs.abinit.org/variables/. Do not edit by hand: run the script again.
//
// The descriptions are excerpts from the ABINIT documentation. ABINIT is free software, distributed
// under the GNU General Public License, version 3 (LICENSES/ABINIT-GPL-3.0.txt), and these excerpts keep
// that licence. Copyright (C) ABINIT group: https://www.abinit.org/about

/**
 * [type, dimensions, default (only if the documentation states one), mnemonic, characteristics (lower case:
 * develop, energy, length, magnetic_field, evolving, no_multi, input_only, internal_only), variable set,
 * documentation, allowed values [value, note][], requires, excludes, comment on the default, added in version]
 */
export type AbinitVariableRow = [string, string[], string, string, string[], string, string, [string, string][], string, string, string, string];

export const ABINIT_REVISION = ${JSON.stringify(REVISION)};

/** Names ABINIT reads (intagm in src/57_iovars) that the documentation does not list, with the type they are read with (int, dpr, len, ene, log, key, ...). */
export const ABINIT_UNDOCUMENTED: Record<string, string> = ${JSON.stringify(undocumentedSorted)};

export const ABINIT_VARIABLES: Record<string, AbinitVariableRow> = {
${lines.join('\n')}
};
`,
);
if (corrected.length) console.log(`type taken from the reader instead of the documentation: ${corrected.join(', ')}`);
console.log(`${names.length} variables and ${Object.keys(undocumented).length} undocumented names written to ${out}`);
