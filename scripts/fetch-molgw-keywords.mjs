// Generates src/core/molgw/keywords.generated.ts from the source of MolGW (https://github.com/molgw/molgw).
// Run:
//
//   node scripts/fetch-molgw-keywords.mjs <path to a clone of the MolGW repository>
//
// The clone is read as data only (nothing in it is built or executed). Sources used:
//
//   src/input_variables.yaml        every input variable: family, datatype, mandatory, experimental, default,
//                                   description. The MolGW build turns it into src/input_variables.f90 (the
//                                   namelist /molgw/), input_variable_declaration.f90 and docs/input_variables.md
//                                   with utils/input_variables.py; the namelist is cross-checked here.
//   docs/input_variables.md         the section each variable is documented in
//   src/m_inputparam.f90            read_inputfile_namelist (the checks that die), init_calculation_type
//                                   (postscf and scf names), init_dft_type (functional names), setup_nuclei
//                                   (geometry lines)
//   src/m_string_tools.f90          yesno_to_logical: what 'yes'/'no' variables accept
//   src/m_elements.f90              element_list
//   other src/*.f90                 the values the code compares a few more character variables with
//
// MolGW reads its input with a Fortran namelist (`read(inputfile, molgw)`), so unknown names and unreadable
// values stop it at once; the values of the character variables are checked where they are used.
//
// MolGW is distributed under the GNU GPL v3 (LICENSES/GPL-3.0.txt); the table and the descriptions in the
// generated file are derived from its source and keep that notice.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/fetch-molgw-keywords.mjs <path to a clone of the MolGW repository>');
  process.exit(1);
}
const read = (f) => readFileSync(join(root, f.includes('/') ? f : `src/${f}`), 'utf8');
let VERSION = process.argv[3];
if (!VERSION) {
  const m = read('docs/input_variables.md').match(/\*Version ([\d.]+)\*/);
  VERSION = m ? m[1] : 'unknown';
}
let COMMIT = '';
try {
  COMMIT = execFileSync('git', ['-C', root, 'rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}

// ---------------------------------------------------------------------------------------------------------
// input_variables.yaml: a regular subset of YAML (top-level names, two-space fields, folded plain scalars,
// '..' and ".." strings, !!python/tuple lists), so it is read without a YAML library.

function unquote(s) {
  s = s.trim();
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
}

function parseYaml(text) {
  const vars = {};
  let cur = null;
  let field = null;
  let raw = {};
  const flush = () => {
    if (!cur) return;
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v.tuple) out[k] = v.items.join(' ');
      else out[k] = unquote(v.parts.join(' ').replace(/\s+/g, ' '));
    }
    Object.assign(cur, out);
  };
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '' || line === '---') continue;
    let m;
    if ((m = line.match(/^([A-Za-z0-9_]+):\s*$/))) {
      flush();
      cur = vars[m[1]] = {};
      raw = {};
      field = null;
    } else if ((m = line.match(/^  ([a-z_]+):\s*(.*)$/))) {
      field = m[1];
      raw[field] = m[2].startsWith('!!python/tuple') ? { tuple: true, items: [] } : { parts: [m[2]] };
    } else if (field && (m = line.match(/^  - (.*)$/)) && raw[field].tuple) {
      raw[field].items.push(m[1].trim());
    } else if (field && raw[field].parts) {
      raw[field].parts.push(line.trim());
    }
  }
  flush();
  return vars;
}

/** Descriptions are HTML-ish ("&lt;r&gt;", "<sup>"): plain Markdown text instead. */
const cleanDoc = (s) =>
  s
    .replace(/<\/?(sup|sub|i|b)>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\\*/g, '*')
    .replace(/\s+/g, ' ')
    .trim();

const yaml = parseYaml(read('src/input_variables.yaml'));
const names = Object.keys(yaml);

// The namelist /molgw/ of the generated Fortran: the names the reader accepts.
const nmlText = read('src/input_variables.f90');
const nml = nmlText.match(/namelist \/molgw\/([\s\S]*?)\n\n/)?.[1]?.split(/[,&\s]+/).filter(Boolean) ?? [];
const missingInNml = names.filter((n) => !nml.some((x) => x.toLowerCase() === n.toLowerCase()));
const missingInYaml = nml.filter((x) => !names.some((n) => n.toLowerCase() === x.toLowerCase()));
if (missingInNml.length || missingInYaml.length) {
  console.error('yaml / namelist mismatch', { missingInNml, missingInYaml });
  process.exit(1);
}

// Sections of the manual (docs/input_variables.md): "## Title" followed by [name](#name) links.
const sectionOf = {};
{
  let title = '';
  for (const line of read('docs/input_variables.md').split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) title = h[1].trim();
    const l = line.match(/^\[([A-Za-z0-9_]+)\]\(#/);
    if (l && !/^(Mandatory|Complete list)/.test(title)) sectionOf[l[1].toLowerCase()] = title;
  }
}

const familySection = {};
for (const n of names) if (sectionOf[n.toLowerCase()]) familySection[yaml[n].family] ??= sectionOf[n.toLowerCase()];

// ---------------------------------------------------------------------------------------------------------
// Fortran: the labels of a `select case` block.

/** Case labels (upper case) of the select block that starts at the first line matching `anchor` after `from`. */
function caseBlocks(file, anchor, from = 0) {
  const lines = read(file).split('\n');
  let i = lines.findIndex((l, n) => n >= from && anchor.test(l));
  if (i < 0) throw new Error(`${file}: ${anchor} not found`);
  const start = i;
  let depth = 0;
  const blocks = []; // [labels[], body lines[]]
  for (; i < lines.length; i++) {
    const code = lines[i].replace(/!.*$/, '');
    if (/^\s*select\s*case/i.test(code)) depth++;
    else if (/^\s*end\s*select/i.test(code)) {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1 && /^\s*case\s*\(/i.test(code)) {
      const labels = [...code.matchAll(/(['"])([^'"]*)\1/g)].map((m) => m[2].toUpperCase());
      blocks.push({ labels, isDefault: false, body: [] });
      continue;
    } else if (depth === 1 && /^\s*case\s+default/i.test(code)) {
      blocks.push({ labels: [], isDefault: true, body: [] });
      continue;
    }
    if (blocks.length) blocks[blocks.length - 1].body.push(code);
  }
  return { blocks, start, end: i };
}
const labelsOf = (file, anchor, from) => caseBlocks(file, anchor, from).blocks.flatMap((b) => b.labels);

const inputparam = read('src/m_inputparam.f90').split('\n');
const lineOf = (re, from = 0) => inputparam.findIndex((l, n) => n >= from && re.test(l));

// postscf: the select block of init_calculation_type. Each label with what it switches on.
const initCalc = lineOf(/subroutine init_calculation_type/);
const post = caseBlocks('src/m_inputparam.f90', /select case\(TRIM\(postscf\)\)/, initCalc);
const POSTSCF = {};
for (const b of post.blocks) {
  if (b.isDefault) continue;
  const body = b.body.join('\n');
  const flags = [];
  if (/is_gw\s*=\s*\.TRUE\./i.test(body)) flags.push('gw');
  if (/is_bse\s*=\s*\.TRUE\./i.test(body)) flags.push('bse');
  if (/include_tddft_kernel\s*=\s*\.TRUE\./i.test(body)) flags.push('td');
  if (/is_mp2\s*=\s*\.TRUE\./i.test(body)) flags.push('mp2');
  if (/is_real_time\s*=\s*\.TRUE\./i.test(body)) flags.push('realtime');
  if (/is_ci\s*=\s*\.TRUE\./i.test(body)) flags.push('ci');
  const tech = body.match(/selfenergy_technique\s*=\s*(\w+)/i)?.[1];
  if (tech) flags.push(`technique:${tech}`);
  for (const l of b.labels) POSTSCF[l] = flags;
}

// scf: the select block after it (non-DFT names), then init_dft_type (functionals).
const scfBlock = caseBlocks('src/m_inputparam.f90', /select case\(TRIM\(scf\)\)/, initCalc);
const SCF_BUILTIN = scfBlock.blocks.flatMap((b) => b.labels);
const dftStart = lineOf(/subroutine init_dft_type/);
const SCF_DFT = caseBlocks('src/m_inputparam.f90', /select case\(TRIM\(key\)\)/, dftStart).blocks.flatMap((b) => b.labels);
// Both blocks must end in a `case default` that dies (or tries LIBXC:), or the lists are not exhaustive.
if (!/LIBXC:/.test(inputparam.slice(dftStart, dftStart + 400).join('\n'))) throw new Error('init_dft_type changed: check the LIBXC: syntax');

// Values the code compares a variable with right in read_inputfile_namelist (it dies on any other).
function direct(re) {
  const i = lineOf(re, lineOf(/subroutine read_inputfile_namelist/));
  const labels = labelsOf('src/m_inputparam.f90', re, i);
  return labels;
}
const strictFromReader = {
  mixing_scheme: { values: direct(/select case\(TRIM\(mixing_scheme\)\)/), ci: true },
  pt3_a_diagrams: { values: direct(/select case\(TRIM\(pt3_a_diagrams\)\)/), ci: true },
  // `select case(move_nuclei)`: move_nuclei is not capitalized before, so it is case-sensitive; values are lower case.
  move_nuclei: { values: [...inputparam.join('\n').match(/select case\(move_nuclei\)\s*\n\s*case\(([^)]*)\)/)[1].matchAll(/'([^']*)'/g)].map((m) => m[1]), ci: false },
};
const lengthUnit = labelsOf('src/m_inputparam.f90', /select case\(TRIM\(length_unit\)\)/, lineOf(/subroutine setup_nuclei/));
strictFromReader.length_unit = { values: lengthUnit, ci: true };
const excit = caseBlocks('src/m_inputparam.f90', /select case \(excit_type%name\)/, lineOf(/subroutine init_excitation_type/)).blocks.flatMap((b) => b.labels);
strictFromReader.excit_name = { values: excit, ci: true };

// yes/no variables: yesno_to_logical, on a character(len=3).
const yn = caseBlocks('src/m_string_tools.f90', /select case\(TRIM\(capitalize\(char_in\)\)\)/, read('src/m_string_tools.f90').split('\n').findIndex((l) => /function yesno_to_logical/.test(l)));
const YESNO = { yes: yn.blocks[0].labels, no: yn.blocks[1].labels };
if (!YESNO.yes.includes('YES') || !YESNO.no.includes('NO')) throw new Error('yesno_to_logical changed');

// element_list of m_elements.f90.
const elementSrc = read('src/m_elements.f90');
const ELEMENTS = [...elementSrc.match(/element_list\(nelement_max\)\s*=([\s\S]*?)\/\)/)[1].matchAll(/'\s*([A-Za-z]{1,2})'/g)].map((m) => m[1]);
if (ELEMENTS.length !== 103 || ELEMENTS[0] !== 'H' || ELEMENTS[102] !== 'Lr') throw new Error(`element_list: ${ELEMENTS.length} symbols`);

// ---------------------------------------------------------------------------------------------------------
// Character variables whose values the manual (or the place that uses them) lists, but that the reader
// does not check: the DFTune check is a warning. Each entry names where the values come from.

const nth = (file, re) => caseBlocks(file, re).blocks.flatMap((b) => b.labels);
const QUALITY = labelsOf('src/m_inputparam.f90', /select case\(TRIM\(quality\)\)/, lineOf(/function interpret_quality/));
const LISTED = {
  gaussian_type: { values: labelsOf('src/m_cart_to_pure.f90', /select case\(gaussian_type\)/), source: 'm_cart_to_pure.f90 get_gaussian_type_tag' },
  grid_quality: { values: QUALITY, source: 'm_inputparam.f90 interpret_quality' },
  tddft_grid_quality: { values: QUALITY, source: 'm_inputparam.f90 interpret_quality' },
  ecp_quality: { values: QUALITY, source: 'm_inputparam.f90 interpret_quality' },
  integral_quality: { values: QUALITY, source: 'm_inputparam.f90 interpret_quality' },
  init_hamiltonian: { values: [...new Set([...nth('m_hamiltonian_twobodies.f90', /select case\(TRIM\(init_hamiltonian\)\)/)])], source: 'm_hamiltonian_twobodies.f90' },
  pt_density_matrix: { values: ['NO', ...nth('m_mbpt_density_matrix_driver.f90', /select case\(TRIM\(pt_density_matrix\)\)/)], source: 'm_mbpt_density_matrix_driver.f90' },
  ci_type: { values: nth('m_ci.f90', /select case\(ci_type_in\)/), source: 'm_ci.f90 setup_configurations_ci' },
  ci_greens_function: { values: ['HOLES', 'ELECTRONS', 'BOTH'], source: 'molgw.f90 and the manual' },
  tddft_wfn_t0: { values: nth('m_realtime_tddft.f90', /select case\(capitalize\(tddft_wfn_t0\)\)/), source: 'm_realtime_tddft.f90' },
  tddft_propagator: { values: ['CN', 'MAG2', 'ETRS'], source: 'm_realtime_tddft.f90' },
  noft_functional: { values: nth('m_noft.f90', /select case\(capitalize\(noft_functional\)\)/), source: 'm_noft.f90' },
  read_fchk: { values: ['NO', ...nth('m_io.f90', /select case\(TRIM\(read_fchk_in\)\)/)], source: 'm_io.f90 read_gaussian_fchk' },
  frozencore: { values: ['NO', 'YES', 'MOLGW', 'GAUSSIAN'], source: 'm_selfenergy_tools.f90 and the manual' },
  partition_scheme: { values: ['BECKE', 'SSF'], source: 'm_dft_grid.f90 and the manual' },
  stopping: { values: ['NO', 'SPHERICAL', '3D'], source: 'm_linear_response.f90 and the manual' },
  fft_coulomb_exchange: { values: ['BARE', 'SPHERICAL'], source: 'm_hamiltonian_periodic.f90 and the manual' },
  fft_coulomb_hartree: { values: ['BARE', 'SPHERICAL'], source: 'm_hamiltonian_periodic.f90 and the manual' },
};
// tddft_predictor_corrector: the PC schemes of m_realtime_tddft.f90.
LISTED.tddft_predictor_corrector = { values: nth('m_realtime_tddft.f90', /select case \(tddft_predictor_corrector\)/).concat(['PC0', 'PC1', 'PC2B', 'PC3', 'PC4', 'PC5', 'PC6', 'PC7']), source: 'm_realtime_tddft.f90' };
LISTED.tddft_predictor_corrector.values = [...new Set(LISTED.tddft_predictor_corrector.values)];

// ---------------------------------------------------------------------------------------------------------

const typeOf = (d) => ({ 'yes/no': 'yesno', characters: 'string', integer: 'integer', real: 'real', vector_1d_3: 'vector3' })[d];
const lower = (a) => [...new Set(a.map((s) => s.toLowerCase()))];

/** [type, section, mandatory, experimental, default, description] */
const rows = names
  .map((n) => {
    const v = yaml[n];
    const type = typeOf(v.datatype);
    if (!type) throw new Error(`${n}: unknown datatype ${v.datatype}`);
    // A few variables (family 'postscf') are missing from the manual's lists: they go with their family's section.
    const section = sectionOf[n.toLowerCase()] ?? familySection[v.family === 'postscf' ? 'post' : v.family] ?? '';
    if (!section) throw new Error(`${n}: not in a section of docs/input_variables.md`);
    return [n.toLowerCase(), [type, section, v.mandatory === 'yes', v.experimental === 'yes', v.default ?? '', cleanDoc(v.comment ?? '')]];
  })
  .sort((a, b) => a[0].localeCompare(b[0]));

const counts = { keywords: rows.length, yesno: rows.filter((r) => r[1][0] === 'yesno').length, mandatory: rows.filter((r) => r[1][2]).map((r) => r[0]) };
console.log(`${counts.keywords} keywords (${counts.yesno} yes/no), mandatory: ${counts.mandatory.join(', ')}`);
console.log(`postscf: ${Object.keys(POSTSCF).length} names, scf: ${SCF_BUILTIN.length} + ${SCF_DFT.length} functionals, elements: ${ELEMENTS.length}`);
for (const [k, v] of Object.entries(strictFromReader)) console.log(`${k}: ${v.values.join(' ')}`);
for (const [k, v] of Object.entries(LISTED)) {
  if (!v.values.length) throw new Error(`${k}: no values found`);
  console.log(`${k} (listed): ${v.values.join(' ')}`);
}

const ts = (x) => JSON.stringify(x);
let out = `// Generated by scripts/fetch-molgw-keywords.mjs from the MolGW ${VERSION} source${COMMIT ? ` (commit ${COMMIT})` : ''}:
// src/input_variables.yaml, docs/input_variables.md, src/m_inputparam.f90 and the other Fortran files named below.
// Do not edit by hand: run the script again.
//
// MOLGW, Copyright (C) 2010-2026 Fabien Bruneval, is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free Software Foundation, either
// version 3 of the License, or (at your option) any later version (LICENSES/GPL-3.0.txt,
// https://github.com/molgw/molgw). The names, defaults and descriptions below are derived from its source
// and are distributed under the same terms, WITHOUT ANY WARRANTY.

export const MOLGW_VERSION = ${ts(VERSION)};
export const MOLGW_COMMIT = ${ts(COMMIT)};

/** [type integer|real|yesno|string|vector3, section of the manual, mandatory, experimental, default ('' = none), description] */
export type MolgwKeywordRow = ['integer' | 'real' | 'yesno' | 'string' | 'vector3', string, boolean, boolean, string, string];

/** Every variable of the namelist /molgw/ (lower case: names are not case-sensitive). */
export const MOLGW_DEFS: Record<string, MolgwKeywordRow> = {\n`;
for (const [n, r] of rows) out += `  ${ts(n)}: ${ts(r)},\n`;
out += `};

/**
 * Character variables that read_inputfile_namelist (src/m_inputparam.f90) checks right after reading, and dies on any
 * other value. [values (lower case), compared case-insensitively]. move_nuclei is the exception: not capitalized in
 * the source, so it is case-sensitive.
 */
export const MOLGW_STRICT: Record<string, { values: string[]; caseSensitive: boolean }> = {\n`;
for (const [k, v] of Object.entries(strictFromReader)) out += `  ${ts(k)}: { values: ${ts(v.ci ? lower(v.values) : v.values)}, caseSensitive: ${!v.ci} },\n`;
out += `};

/** postscf names init_calculation_type accepts (upper case in the source, any case in the input), with what each switches on. */
export const MOLGW_POSTSCF: Record<string, string[]> = {\n`;
for (const [k, v] of Object.entries(POSTSCF)) out += `  ${ts(k.toLowerCase())}: ${ts(v)},\n`;
out += `};

/** scf names: the built-in schemes and the functionals of init_dft_type. scf also accepts LIBXC:<id>[+<id>...]. */
export const MOLGW_SCF_BUILTIN: string[] = ${ts(lower(SCF_BUILTIN))};
export const MOLGW_SCF_FUNCTIONALS: string[] = ${ts(lower(SCF_DFT))};

/** What a yes/no variable accepts (yesno_to_logical, on the first three characters, any case). */
export const MOLGW_YES: string[] = ${ts(YESNO.yes.map((s) => s.toLowerCase()))};
export const MOLGW_NO: string[] = ${ts(YESNO.no.map((s) => s.toLowerCase()))};

/** Values the manual or the code that uses the variable names, but that the reader does not check. */
export const MOLGW_LISTED: Record<string, { values: string[]; source: string }> = {\n`;
for (const [k, v] of Object.entries(LISTED)) out += `  ${ts(k)}: { values: ${ts(lower(v.values))}, source: ${ts(v.source)} },\n`;
out += `};

/** element_list of src/m_elements.f90, by atomic number 1..103. The symbols are matched case-sensitively. */
export const MOLGW_ELEMENTS: string[] = ${ts(ELEMENTS)};\n`;

writeFileSync(new URL('../src/core/molgw/keywords.generated.ts', import.meta.url), out);
console.log(`wrote src/core/molgw/keywords.generated.ts (${(out.length / 1024).toFixed(0)} kB)`);
