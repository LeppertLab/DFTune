// Generates src/core/castep/keywords.generated.ts from the CASTEP community documentation,
// https://castep-docs.github.io/castep-docs/ (source: https://github.com/castep-docs/castep-docs). Run:
//
//   git clone --depth 1 https://github.com/castep-docs/castep-docs.git <dir>
//   node scripts/fetch-castep-keywords.mjs <dir>
//
// The documentation is not a complete keyword reference (its own pages say that `castep -h all` is), so
// the table holds what the pages document:
//   - docs/documentation/Input_Files/cell_keywords.md: the table of cell keywords (type, default,
//     description) and its footnotes of mutually exclusive keywords
//   - docs/documentation/Phonons/Castep_Phonons/Keyword-Reference.md: phonon and related cell and param
//     keywords with type, allowed values and default
//   - the keyword lists of the geometry optimisation, molecular dynamics and spectral pages
//   - a few keywords whose type, default or values the prose of other pages states (CURATED below).
//     Every name, default and value there is checked against the page it cites: the script stops if the
//     page does not contain it.
//   - the names of keywords and blocks used in the tutorial inputs and code blocks of the docs
//     (name only: no type, so nothing is checked about their values)
//
// The castep-docs repository declares no licence; the pages carry the copyright of their authors
// (STFC for the phonon pages). Only names, types, defaults, allowed values and the short one-line
// descriptions are kept, with this attribution; see LICENSES/CASTEP-docs.txt.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/fetch-castep-keywords.mjs <castep-docs checkout>');
  process.exit(1);
}
// The castep-docs repository declares no licence, so the prose of its pages is left out unless asked for:
// CASTEP_KEEP_DOCS=1 node scripts/fetch-castep-keywords.mjs <checkout> keeps the one-line descriptions.
const KEEP_DOCS = process.env.CASTEP_KEEP_DOCS === '1';
const docs = join(root, 'docs');
const read = (p) => readFileSync(join(docs, p), 'utf8');
let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}

const TYPES = { B: 'block', P: 'physical', L: 'logical', D: 'defined', V: 'real-vector', W: 'integer-vector' };
const REF_TYPES = { Block: 'block', Integer: 'integer', Real: 'real', Physical: 'physical', Logical: 'logical', String: 'string', 'Integer Vector': 'integer-vector', 'Real Vector': 'real-vector', Defined: 'defined' };

/** Prefix synonyms: cell_file.md ("KPOINT_ and KPOINTS_ are synonymous"; BS_ and OPTICS_ for SPECTRAL_KPOINT_), Keyword-Reference.md (PHONON_KPOINTS_*). */
const PREFIX_ALIASES = [
  ['kpoints_', 'kpoint_'],
  ['spectral_kpoints_', 'spectral_kpoint_'],
  ['bs_kpoint_', 'spectral_kpoint_'],
  ['bs_kpoints_', 'spectral_kpoint_'],
  ['optics_kpoint_', 'spectral_kpoint_'],
  ['optics_kpoints_', 'spectral_kpoint_'],
  ['phonon_kpoints_', 'phonon_kpoint_'],
  ['phonon_fine_kpoints_', 'phonon_fine_kpoint_'],
  ['supercell_kpoint_', 'supercell_kpoints_'],
];
/** Whole-name synonyms that the docs use side by side (spelling variants). */
const NAME_ALIASES = [
  ['spin_polarized', 'spin_polarised', 'tutorials/Bands_and_DOS/magnetic.md'],
  ['cutoff_energy', 'cut_off_energy', 'tutorials/Bands_and_DOS/magnetic.md'],
];

const clean = (s) =>
  s
    .replace(/\$\^\{?-1\}?\$/g, '⁻¹')
    .replace(/\$([^$]*)\$/g, '$1')
    .replace(/\^\{-1\}/g, '⁻¹')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const canon = (name) => {
  let n = name.toLowerCase();
  for (const [from, to] of PREFIX_ALIASES) if (n.startsWith(from)) return to + n.slice(from.length);
  return n;
};


/**
 * The pages put prose and page fragments in their default and unit columns ("Generated from …", "See text",
 * "### PARAM file keywords {#sec:paramkw}"). Only a value CASTEP could read survives: a short literal, with a
 * trailing full stop removed and "(0, 0, 0)." written as "0 0 0".
 */
function cleanDefault(def, type = '') {
  let d = String(def ?? '').trim().replace(/\.$/, '');
  const group = d.match(/^\(([^()]*)\)$/);
  if (group) d = group[1].replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  d = d.replace(/\s+(?:A|Ang|Å)⁻¹$/, ' Å⁻¹'); // "0.1 A⁻¹. ### …" keeps the value and its unit only if clean
  if (!d || /[#{}<>]|generated|see |determined|none|no |depends|same as|default/i.test(d)) return '';
  if (d.split(/\s+/).length > 4 || d.length > 30) return '';
  // A number, a vector or a physical quantity has a numeric default ("INCLUDE_GAMMA" is the name of an option).
  if (/^(integer|real|physical|integer-vector|real-vector)$/.test(type) && !/^[-+\d.]/.test(d)) return '';
  return d;
}

/** A unit is a short word such as eV, Å⁻¹ or A/ps, not a stray fragment. */
function cleanUnit(unit) {
  const u = String(unit ?? '').trim();
  return /^[A-Za-zÅ⁻¹²³^/*·0-9 ]{1,16}$/.test(u) && /[A-Za-zÅ]/.test(u) ? u : '';
}

/** name (lower case) → { file, name, type, def, unit, doc, options, examples, source } */
const table = { cell: new Map(), param: new Map() };
function add(file, name, info, source, override = false) {
  const key = name.toLowerCase();
  const have = table[file].get(key);
  const row = { name, type: '', def: '', unit: '', doc: '', options: [], examples: [], source, ...info };
  if (!have) table[file].set(key, row);
  else if (override) table[file].set(key, { ...have, ...Object.fromEntries(Object.entries(row).filter(([, v]) => (Array.isArray(v) ? v.length : v))) });
  else for (const [k, v] of Object.entries(row)) if (!have[k] || (Array.isArray(have[k]) && !have[k].length)) have[k] = v;
}

// 1. cell_keywords.md
const cellPage = 'documentation/Input_Files/cell_keywords.md';
const cellText = read(cellPage);
const exclusive = [];
for (const line of cellText.split('\n')) {
  const m = line.match(/^`([A-Z_]+)`(?:\$\^\d\$)?\s*\|\s*([A-Z])\s*\|\s*([^|]*)\|\s*(.*)$/);
  if (m) {
    const def = clean(m[3]);
    const dm = def.match(/^([\d.eE+-]+)\s*(\S.*)?$/);
    add('cell', m[1], { type: TYPES[m[2]], def: def === '--' ? '' : dm ? dm[1] : def, unit: dm?.[2] ?? '', doc: clean(m[4]) }, cellPage);
  }
}
// "$^3$ Only one of `KPOINTS_LIST`, `KPOINTS_MP_GRID` and `KPOINTS_MP_SPACING` may be present in a cell file."
const foot = cellText.replace(/\n(?!\n)/g, ' ');
for (const m of foot.matchAll(/\$\^\d\$ Only one of ([^.]*?) may ?(?:be )?(?:present|occur)/g)) {
  const names = [...m[1].matchAll(/`([A-Z_]+)`/g)].map((x) => canon(x[1]));
  if (names.length > 1) exclusive.push(names);
}

// 2. Keyword-Reference.md
const refPage = 'documentation/Phonons/Castep_Phonons/Keyword-Reference.md';
{
  let section = 'cell';
  const entries = [];
  let cur;
  for (const raw of read(refPage).split('\n')) {
    const line = raw.trim();
    if (/PARAM file keywords/.test(line)) section = 'param';
    if (/^[A-Z][A-Z0-9_]+$/.test(line) && /^\s*$/.test('')) {
      cur = { name: line, section, text: [] };
      entries.push(cur);
    } else if (cur && line) cur.text.push(line.replace(/^:\s*/, ''));
  }
  for (const e of entries) {
    const text = e.text.join(' ').replace(/\s+/g, ' ');
    const m = text.match(/^\*([^*]*(?:\*[^*]*\*)?[^*]*)\*(?: `[A-Z_]+`)?\s*\(([A-Za-z ]+)\)\s*(.*)$/) ?? text.match(/^\*(.*?)\*\s*\(([A-Za-z ]+)\)\s*(.*)$/);
    const title = m ? clean(m[1]).replace(/^Alias for$/, 'Alias') : '';
    const type = m ? (REF_TYPES[m[2].trim()] ?? '') : '';
    const body = m ? m[3] : text;
    const allowed = body.match(/Allowed values: (.*?)(?: Default value ?:|$)/)?.[1]?.trim() ?? '';
    const def = body.match(/Default value ?: (.*)$/)?.[1]?.trim() ?? '';
    // A closed list: only plain words separated by commas ("DFPT, LINEARRESPONSE, FINITEDISPLACEMENT").
    const options = type === 'string' && /^[A-Za-z0-9_-]+(?:, [A-Za-z0-9_-]+)+$/.test(allowed) ? allowed.split(', ') : [];
    const alias = body.match(/^Alias for `([A-Z_]+)`/)?.[1] ?? text.match(/^\*Alias for\* `([A-Z_]+)`/)?.[1];
    add(e.section, e.name, { type, def: clean(def).replace(/^Determined from.*$/, ''), doc: alias ? `Alias for ${alias}.` : title, options, alias: alias?.toLowerCase() }, refPage);
  }
}

// 3. keyword lists of the geometry, MD and spectral pages: "* `md_num_iter` :  number of MD steps (default 100)" or "MD_NUM_BEADS   PIMD number of beads"
for (const page of ['documentation/Geometry_Optimisation/keywords.md', 'documentation/Molecular_Dynamics/keywords.md', 'documentation/Spectral/keywords.md']) {
  for (const raw of read(page).split('\n')) {
    const m = raw.match(/^\s*(?:[*-]\s*)?`?([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)`?\s*(?::|\s{2,})\s*(.*)$/);
    if (!m || /^(write_|geom_method|geom_preconditioner)/i.test(m[1]) || /!\s*default/.test(m[2])) continue;
    const doc = clean(m[2].replace(/\s*!.*$/, ''));
    const def = doc.match(/\(default:? ?([^)]*)\)/i)?.[1] ?? '';
    add('param', m[1], { doc: doc.replace(/\s*\(default:?[^)]*\)/i, ''), def }, page);
  }
}

// 4. curated: type, default or allowed values that the prose of a page states. { name, file, page, type, def, unit, options, examples, doc, quotes }
// Every string in `quotes` (and the name) must occur in the page, case-insensitively.
const CURATED = [
  { name: 'task', page: 'documentation/Input_Files/param_file.md', type: 'string', def: 'energy', doc: 'The simulation task CASTEP performs.', quotes: ['task : energy'], examples: ['SinglePoint', 'GeomOpt', 'MD', 'Phonon', 'Spectral', 'MagRes', 'Efield', 'TransitionStateSearch', 'Thermodynamics'] },
  { name: 'cut_off_energy', page: 'documentation/Input_Files/param_file.md', type: 'physical', unit: 'eV', doc: 'Plane-wave cut-off energy; typical values are 300 to 1500 eV.', quotes: ['cut_off_energy : 500 eV', '300 to 1500 eV'] },
  { name: 'basis_precision', page: 'documentation/Input_Files/param_file.md', type: 'string', options: ['coarse', 'medium', 'fine', 'precise'], doc: 'Preset plane-wave cut-off energy; coarse and medium are for quick preliminary investigations.', quotes: ['basis_precision : coarse|medium|fine|precise', 'coarse', 'medium', 'fine', 'precise'] },
  { name: 'xc_functional', page: 'documentation/Input_Files/param_file.md', type: 'string', examples: ['PBE', 'LDA'], doc: 'The exchange-correlation functional.', quotes: ['xc_functional : pbe'] },
  { name: 'opt_strategy', page: 'tutorials/Bands_and_DOS/magnetic.md', type: 'string', examples: ['speed'], doc: 'Choice of algorithms: speed for the best speed.', quotes: ['opt_strategy    speed'] },
  { name: 'spin_polarised', page: 'tutorials/Bands_and_DOS/magnetic.md', type: 'logical', doc: 'Allow the up and down spin electrons to take different configurations.', quotes: ['spin_polarised  true'] },
  { name: 'spin', page: 'tutorials/Bands_and_DOS/magnetic.md', type: 'real', doc: 'Initial spin of the original cell for a spin-polarised calculation.', quotes: ['spin            1'] },
  { name: 'geom_method', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'string', def: 'LBFGS', options: ['LBFGS', 'BFGS', 'TPSD', 'DAMPEDMD', 'FIRE'], doc: 'Geometry optimisation method.', quotes: ['LBFGS (default), BFGS, TPSD, DAMPEDMD, FIRE'] },
  { name: 'geom_preconditioner', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'string', def: 'ID', options: ['EXP', 'FF', 'ID'], doc: 'Preconditioner: EXPonential, Force Field, Identity.', quotes: ['EXP / FF / ID', 'Identity (default)'] },
  { name: 'geom_energy_tol', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'physical', def: '2.0e-5', unit: 'eV', doc: 'Tolerance on the energy change between iterations.', quotes: ['2.0e-5 eV'] },
  { name: 'geom_force_tol', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'physical', def: '0.05', unit: 'eV/Ang', doc: 'Tolerance on the maximum force on each atom.', quotes: ['0.05 eV/ANG'] },
  { name: 'geom_stress_tol', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'physical', def: '0.1', unit: 'GPa', doc: 'Tolerance on the maximum stress on the cell.', quotes: ['0.1 GPa'] },
  { name: 'geom_disp_tol', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'physical', def: '0.001', unit: 'Ang', doc: 'Tolerance on the change in atom positions between iterations.', quotes: ['default: 0.001'] },
  { name: 'geom_max_iter', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'integer', def: '30', doc: 'Maximum number of geometry optimisation iterations.', quotes: ['default: 30'] },
  { name: 'write_cell_structure', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'logical', doc: 'Write a cell file with the final coordinates.', quotes: ['write_cell_structure : T'] },
  { name: 'write_cif_structure', page: 'documentation/Geometry_Optimisation/keywords.md', type: 'logical', doc: 'Write a cif file with the final coordinates.', quotes: ['write_cif_structure  : T'] },
  { name: 'md_num_iter', page: 'documentation/Molecular_Dynamics/keywords.md', type: 'integer', def: '100', doc: 'Number of MD steps.', quotes: ['default 100'] },
  { name: 'md_delta_t', page: 'documentation/Molecular_Dynamics/keywords.md', type: 'physical', def: '1', unit: 'fs', doc: 'MD time step.', quotes: ['default 1fs'] },
  { name: 'md_ensemble', page: 'documentation/Molecular_Dynamics/keywords.md', type: 'string', options: ['NVE', 'NVT', 'NPH', 'NPT', 'HUG'], doc: 'MD ensemble.', quotes: ['NVE, NVT, NPH, NPT, HUG'] },
  { name: 'md_thermostat', page: 'documentation/Molecular_Dynamics/keywords.md', type: 'string', def: 'NOSE-HOOVER', options: ['NOSE-HOOVER', 'LANGEVIN', 'HOOVER-LANGEVIN'], doc: 'Thermostat if the ensemble is not constant energy.', quotes: ['NOSE-HOOVER (default), LANGEVIN, HOOVER-LANGEVIN'] },
  { name: 'md_barostat', page: 'documentation/Molecular_Dynamics/keywords.md', type: 'string', def: 'ANDERSEN-HOOVER', options: ['ANDERSEN-HOOVER', 'PARRINELLO-RAHMAN'], doc: 'Barostat if the ensemble is not constant volume.', quotes: ['ANDERSEN-HOOVER (default), PARRINELLO-RAHMAN'] },
  { name: 'md_temperature', page: 'documentation/Molecular_Dynamics/keywords.md', type: 'physical', doc: 'Temperature if the ensemble is not constant energy.', quotes: ['md_temperature'] },
  { name: 'spectral_task', page: 'documentation/Spectral/keywords.md', type: 'string', options: ['bandstructure', 'dos', 'optics', 'pdos', 'coreloss'], doc: 'What a spectral calculation computes.', quotes: ['bandstructure', 'dos', 'optics', 'pdos', 'coreloss'] },
  { name: 'spin_treatment', page: 'documentation/Delta_SCF/overview.md', type: 'string', examples: ['scalar', 'none'], doc: 'Treatment of spin; the delta-SCF constraints work only for scalar or none.', quotes: ['spin_treatment=scalar'] },
  { name: 'metals_method', page: 'documentation/Delta_SCF/overview.md', type: 'string', examples: ['DM', 'EDFT'], doc: 'Method for metals: density mixing (DM) or EDFT.', quotes: ['metals_method=DM'] },
  { name: 'fix_occupancy', page: 'documentation/Phonons/Castep_Phonons/Keyword-Reference.md', type: 'logical', doc: 'Treat the system as an insulator.', quotes: ['FIX_OCCUPANCY'] },
  { name: 'elec_energy_tol', page: 'tutorials/NMR/silicates/quartz.param', type: 'physical', doc: 'Electronic energy convergence tolerance.', quotes: ['elec_energy_tol = 1.0e-12 ry'] },
  { name: 'kpoint_mp_grid', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'integer-vector', doc: 'Monkhorst-Pack grid of k-points: three integers.', quotes: ['KPOINT_MP_GRID I_i I_j I_k'] },
  { name: 'kpoint_mp_offset', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'real-vector', doc: 'Offset of the Monkhorst-Pack grid in fractional coordinates: three numbers.', quotes: ['KPOINT_MP_OFFSET R_i R_j R_k'] },
  { name: 'kpoint_mp_spacing', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'physical', def: '0.1', unit: '1/Ang', doc: 'Maximum distance between k-points of the Monkhorst-Pack grid (in units of 2pi).', quotes: ['KPOINT_MP_SPACING R [units]'] },
  { name: 'symmetry_tol', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'physical', unit: 'Ang', doc: 'Tolerance within which symmetry is considered satisfied.', quotes: ['SYMMETRY_TOL R [units]'] },
  { name: 'unit_cell', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'string', doc: 'A pre-defined structure by name (Si2, GaAs, Quartz, Graphene, ...); exclusive with the lattice and position blocks.', quotes: ['UNIT_CELL name'], examples: ['Si2', 'GaAs', 'Quartz', 'Graphene'] },
  { name: 'fix_all_ions', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'logical', doc: 'Fix all ionic positions.', quotes: ['FIX_ALL_IONS'] },
  { name: 'fix_all_cell', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'logical', doc: 'Fix all cell parameters.', quotes: ['FIX_ALL_CELL'] },
  { name: 'fix_com', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'logical', doc: 'Fix the centre of mass of the ions.', quotes: ['FIX_COM'] },
  { name: 'snap_to_symmetry', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'logical', doc: 'Also adjust the ionic positions to the symmetry of the lattice.', quotes: ['SNAP_TO_SYMMETRY'] },
  { name: 'symmetry_generate', file: 'cell', page: 'documentation/Input_Files/cell_file.md', type: 'defined', doc: 'Find the highest symmetry of the cell and generate its operations.', quotes: ['SYMMETRY_GENERATE'] },
  { name: 'hubbard_u', file: 'cell', page: 'tutorials/Bands_and_DOS/magnetic.md', type: 'block', doc: 'Hubbard U per species and angular momentum channel (DFT+U).', quotes: ['%block hubbard_u'] },
];
const allDocs = (function all(dir) {
  return readdirSync(dir).map((f) => (statSync(join(dir, f)).isDirectory() ? all(join(dir, f)) : /\.(md|cell|param)$/.test(f) ? readFileSync(join(dir, f), 'utf8') : '')).join('\n');
})(docs);
const pageCache = new Map();
const pageText = (p) => (pageCache.get(p) ?? pageCache.set(p, read(p).toLowerCase()).get(p));
for (const c of CURATED) {
  const check = (page, s) => {
    if (!pageText(page).includes(s.toLowerCase())) throw new Error(`curated ${c.name}: "${s}" not found in ${page}`);
  };
  check(c.page, c.name.toLowerCase() === 'kpoint_mp_grid' ? 'KPOINT_MP_GRID' : c.name);
  for (const q of c.quotes ?? []) check(c.page, q);
  // Example values of task and xc_functional must occur as `name value` somewhere in the docs.
  if (c.name === 'task' || c.name === 'xc_functional') {
    for (const ex of c.examples) if (!new RegExp(`${c.name}\\s*[:=]?\\s*${ex}\\b`, 'i').test(allDocs)) throw new Error(`curated ${c.name}: example ${ex} not used in the docs`);
  }
  const file = c.file ?? 'param';
  const known = table[file].get(c.name);
  add(file, c.name, { type: c.type, def: c.def ?? '', unit: c.unit ?? '', doc: c.doc, options: c.options ?? [], examples: c.examples ?? [] }, c.page, true);
  if (known && known.type && known.type !== c.type && c.type !== 'string') console.warn(`note: ${c.name} is ${known.type} in ${known.source}, ${c.type} in the curated entry`);
}

// 5. names used in the docs: keyword lines in code blocks and tutorial inputs, and %block names. Name only.
const CELL_NAME = /^(kpoints?_|spectral_kpoints?_|bs_kpoints?_|optics_kpoints?_|phonon_(fine_)?kpoints?_|phonon_gamma|supercell_|symmetry_|fix_|ionic_|cell_constraints|species_|lattice_|positions_|hubbard_|external_|quantisation|snap_to|nonlinear_|hirshfeld|devel_cell)/;
const NOT_KEYWORDS = new Set(['file_name', 'output_file', 'output_filename', 'input_file', 'new_line', 'new_lines', 'max_idx', 'n_complex', 'diam_tst', 'e_cont', 'socket_port', 'socket_host', 'castep_command', 'castep_cmd', 'axis_energy_margin']);
const BARE_OK = new Set(['task', 'iprint', 'continuation', 'reuse', 'comment', 'spin']);
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(md|cell|param)$/.test(f)) out.push(p);
  }
  return out;
}
for (const file of walk(docs)) {
  const rel = relative(docs, file);
  if (rel.startsWith('developer/')) continue;
  const text = readFileSync(file, 'utf8');
  const isInput = /\.(cell|param)$/.test(file);
  let fenced = isInput;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~|````)/.test(line)) {
      fenced = isInput || !fenced;
      continue;
    }
    if (!fenced) continue;
    const b = line.match(/^\s*%block\s+([A-Za-z][A-Za-z0-9_]*)/i);
    if (b) {
      add(/^(devel_code)$/i.test(b[1]) ? 'param' : 'cell', b[1].toUpperCase(), { type: 'block' }, rel);
      continue;
    }
    const k = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:[:=]|\s)\s*(\S.*)?$/);
    if (!k || !k[2] && !/^[A-Za-z_]+$/.test(line.trim())) continue;
    const name = k[1].toLowerCase();
    if (NOT_KEYWORDS.has(name) || !(name.includes('_') || BARE_OK.has(name))) continue;
    if (/^[a-z]+_[a-z]+$/.test(name) && !/[:=]/.test(line) && !isInput) continue; // prose and code, not keyword lines
    if (!/[:=]/.test(line) && !isInput && !/^\s*[A-Z][A-Z0-9_]+\s{2,}/.test(line)) continue;
    add(CELL_NAME.test(name) ? 'cell' : 'param', name.toUpperCase(), {}, rel);
  }
}
// Names of the cell table and the reference also belong to nothing else: drop anything that is in both files.
for (const [k, row] of table.param) if (table.cell.has(k) && !row.type) table.param.delete(k);
// Lines of examples, Python and formulas that look like keywords, and the aliases (the canonical spelling is in the table).
const JUNK = new Set('deltascf_constraints nonlinear_constraints ccc_1 ccc_2 i_1 i_2 t_1 true false none file_path energies_arr eps_111_values eps_vals eps1_arr eps2_arr epsilon_1 epsilon_2 sigma_1 sigma_2 loss_function target_p diam_f diam_i iso_value b88_x component_lines fix_cell fix_vol'.split(' '));
for (const f of ['cell', 'param']) for (const k of [...table[f].keys()]) if (JUNK.has(k) || canon(k) !== k) table[f].delete(k);

// Documented aliases of whole names.
const aliases = {};
for (const [from, to, page] of NAME_ALIASES) {
  if (!pageText(page).includes(from) || !pageText(page).includes(to)) throw new Error(`alias ${from}/${to} not found in ${page}`);
  aliases[from] = to;
}
for (const f of ['cell', 'param'])
  for (const [k, r] of table[f]) if (r.alias) aliases[k] = r.alias.toLowerCase();

const ser = (v) => JSON.stringify(v);
let out = `// Generated by scripts/fetch-castep-keywords.mjs from the CASTEP community documentation
// (https://castep-docs.github.io/castep-docs/, repository castep-docs/castep-docs at ${commit}).
// Do not edit by hand: run the script again.
//
// The documentation is not a complete keyword reference (CASTEP's own \`castep -h all\` is), so this table
// holds the keywords the pages document, plus the names used in their examples. The castep-docs repository
// declares no licence; its pages carry the copyright of their authors (the phonon pages: Science and
// Technology Facilities Council, 2009). Only names, types, defaults, allowed values and short one-line
// descriptions are kept here, attributed to the page they come from (see LICENSES/CASTEP-docs.txt).

/** [name as written in the docs, type, default, unit, short description, closed list of values, example values, source page] */
export type CastepKeywordRow = [string, string, string, string, string, string[], string[], string];

export const CASTEP_DOCS_COMMIT = ${ser(commit)};

`;
for (const f of ['cell', 'param']) {
  const rows = [...table[f].values()].sort((a, b) => a.name.localeCompare(b.name));
  console.log(`${f}: ${rows.length} keywords (${rows.filter((r) => r.type).length} typed, ${rows.filter((r) => r.type === 'block').length} blocks)`);
  out += `export const CASTEP_${f.toUpperCase()}_DEFS: Record<string, CastepKeywordRow> = {\n`;
  for (const r of rows) out += `  ${ser(r.name.toLowerCase())}: [${ser(r.name)}, ${ser(r.type)}, ${ser(cleanDefault(r.def, r.type))}, ${ser(cleanUnit(r.unit))}, ${ser(KEEP_DOCS ? r.doc : '')}, ${ser(r.options)}, ${ser(r.examples)}, ${ser(r.source)}],\n`;
  out += '};\n\n';
}
out += `/** Groups of cell keywords of which "only one may be present" (cell_keywords.md, footnotes), under their canonical names. */\nexport const CASTEP_EXCLUSIVE: string[][] = ${ser(exclusive)};\n\n`;
out += `/** Prefixes that name the same keyword (cell_file.md, Keyword-Reference.md): [prefix, canonical prefix]. */\nexport const CASTEP_PREFIX_ALIASES: [string, string][] = ${ser(PREFIX_ALIASES)};\n\n`;
out += `/** Whole names that mean the same (lower case): alias → canonical name. */\nexport const CASTEP_ALIASES: Record<string, string> = ${ser(aliases)};\n`;
writeFileSync(new URL('../src/core/castep/keywords.generated.ts', import.meta.url), out);
console.log(`exclusive groups: ${exclusive.map((g) => g.join('/')).join(' | ')}`);
console.log(`wrote src/core/castep/keywords.generated.ts (${(out.length / 1024).toFixed(0)} kB)`);
