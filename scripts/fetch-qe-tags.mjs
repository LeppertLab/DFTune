// Generates src/core/qe/tags.generated.ts from the input definitions (INPUT_*.def) of a Quantum
// ESPRESSO release: the variables of every namelist, with type, default, allowed values and a
// short description. Run: node scripts/fetch-qe-tags.mjs [qe-7.4]
//
// The .def files are the machine-readable source of QE's INPUT_*.html/.txt documentation
// (https://gitlab.com/QEF/q-e). QE is GPL-2.0-or-later; the descriptions excerpted here keep that
// licence (see LICENSES/GPL-2.0.txt and README).

import { writeFileSync } from 'node:fs';

const TAG = process.argv[2] ?? 'qe-7.4';
// GitHub mirror of the QE repository (GitLab rate-limits unauthenticated clients).
const BASE = `https://raw.githubusercontent.com/QEF/q-e/${TAG}`;

/** program id → definition file. plotband.x and plotrho.x have no .def (interactive prompts). */
const PROGRAMS = {
  pw: 'PW/Doc/INPUT_PW.def',
  ph: 'PHonon/Doc/INPUT_PH.def',
  projwfc: 'PP/Doc/INPUT_PROJWFC.def',
  dos: 'PP/Doc/INPUT_DOS.def',
  bands: 'PP/Doc/INPUT_BANDS.def',
  pp: 'PP/Doc/INPUT_PP.def',
  pw2bgw: 'PP/Doc/INPUT_pw2bgw.def',
};

// ---------------------------------------------------------------------------------------------
// The .def format: `head { body }` items, nested; `info`/`opt` bodies are free text.

/** Splits `text` into items `{ head, body }`; a line without braces is an item with body null. */
function items(text) {
  const out = [];
  let head = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '#' && /^\s*$/.test(head) && (i === 0 || text[i - 1] === '\n' || /^\s*$/.test(head))) {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      out.push({ head: head.trim(), body: text.slice(i + 1, j - 1) });
      head = '';
      i = j;
    } else if (c === '\n') {
      if (head.trim()) out.push({ head: head.trim(), body: null });
      head = '';
      i++;
    } else {
      head += c;
      i++;
    }
  }
  if (head.trim()) out.push({ head: head.trim(), body: null });
  return out;
}

/** Plain text of an info body: markup removed, indentation and blank-line runs normalized. */
function plain(body) {
  let t = body
    .replace(/@ref\s+([A-Za-z_][\w]*(\([^)]*\))?)/g, '$1')
    .replace(/@(?:b|i|tt)\s+\{([^}]*)\}/g, '$1')
    .replace(/@(?:b|i|tt)\s+(\S+)/g, '$1')
    .replace(/@sup\s+\{([^}]*)\}/g, '^$1')
    .replace(/@sup\s+(\S+)/g, '^$1')
    .replace(/@br/g, '\n');
  const lines = t.split('\n').map((l) => l.replace(/\s+$/, ''));
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), Infinity);
  t = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** First sentences of `text`, at most `max` characters, on one line. */
function brief(text, max) {
  const flat = text.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

/** Summaries for variables whose definition has none worth showing. */
const OVERRIDES = {
  calculation: 'The task to perform: a single scf run, a band structure, an ionic relaxation, MD, and their variable-cell versions.',
  occupations: 'How the electronic states are occupied: smearing (metals), tetrahedra, fixed (insulators) or from_input.',
  smearing: 'The smearing function, used with occupations = \'smearing\'; the width is set by degauss.',
};

/** REQUIRED in the definition, but only when an optional feature is on (said in prose, not in the structure). */
const CONDITIONALLY_REQUIRED = new Set(['gcscf_mu', 'fcp_mu', 'nsolv', 'ahc_nbnd']);

const TYPES = { INTEGER: 'I', REAL: 'R', LOGICAL: 'L', CHARACTER: 'C', STRING: 'C' };
const flags = (head) => Object.fromEntries([...head.matchAll(/-(\w+)\s+(\S+)/g)].map((m) => [m[1], m[2]]));

/**
 * Allowed values from an `options { }` body: `opt -val 'x' { text }` or, for several spellings of
 * one value, `opt -val {'a', 'b'} { text }` (parsed as two items: the values, then the text).
 */
function parseOptions(body) {
  const options = [];
  let intro = '';
  const list = items(body);
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it.head === 'info' && it.body !== null) {
      if (!intro) intro = plain(it.body);
    } else if (it.head === 'opt -val' && it.body !== null) {
      // The values are in this body, the description in the next item (empty head).
      const note = list[i + 1]?.head === '' ? brief(plain(list[++i].body ?? ''), 160) : '';
      for (const v of it.body.split(',')) options.push([v.trim().replace(/^['"]|['"]$/g, ''), note]);
    } else if (it.head.startsWith('opt')) {
      options.push([it.head.replace(/^opt\s+-val\s+/, '').replace(/^['"]|['"]$/g, ''), brief(plain(it.body ?? ''), 160)]);
    }
  }
  return { options, intro };
}

/** One variable (or several, for a vargroup) from the head words and the items of its body. */
function variable(names, head, body, shared = {}) {
  const f = { ...flags(head) };
  const info = { type: TYPES[f.type] ?? shared.type ?? '', default: shared.default ?? '', summary: shared.summary ?? '', options: shared.options ?? [], dim: '', required: shared.required ?? false, status: '' };
  if (f.type && TYPES[f.type]) info.type = TYPES[f.type];
  if (f.start !== undefined) info.dim = `${f.start}:${f.end}`;
  info.status = '';
  let optionsIntro = '';
  for (const it of body) {
    const w = it.head.split(/\s+/)[0];
    if (w === 'default' && it.body !== null) info.default = plain(it.body).replace(/^'(.*)'$/s, '$1').replace(/\s+/g, ' ');
    else if (w === 'status') info.required = /REQUIRED|MANDATORY/.test(it.body ?? '') && !CONDITIONALLY_REQUIRED.has(names[0]);
    else if (w === 'info' && it.body !== null) info.summary = brief(plain(it.body), 320);
    else if (w === 'options' && it.body !== null) {
      const { options, intro } = parseOptions(it.body);
      info.options = options;
      optionsIntro = intro;
    }
  }
  // Some variables describe themselves in the intro of their options (unless it is just "Available options are:").
  if (!info.summary && optionsIntro && !(optionsIntro.endsWith(':') && optionsIntro.length < 45)) info.summary = brief(optionsIntro, 320);
  if (OVERRIDES[names[0]]) info.summary = OVERRIDES[names[0]];
  return names.map((name) => [name, { ...info }]);
}

/** Body items that are descriptions, not containers of variables. */
const LEAF = new Set(['info', 'default', 'options', 'status', 'see', 'label', 'opt', 'flag', 'syntax', 'toc', 'intro', 'table', 'enum']);

/** "alpha_mix(niter)" → ["alpha_mix", "niter"]: the part in parentheses is the index range. */
const splitName = (word) => {
  const m = word.match(/^([A-Za-z_][\w]*)(?:\((.*)\))?$/);
  return [m ? m[1] : word, m?.[2] ?? ''];
};

/** Containers whose variables are only needed under a condition (REQUIRED inside them is not unconditional). */
const CONDITIONAL = new Set(['if', 'ifvar', 'when', 'elsewhen', 'choose', 'optional', 'optionally', 'else', 'elseif']);

/** Variables of a namelist body; descends into group, ifvar, elsewhen, choose, … */
function collectVars(body, out, conditional = false) {
  for (const it of items(body)) {
    const words = it.head.split(/\s+/);
    if (it.body === null || LEAF.has(words[0])) continue;
    if (words[0] === 'var' || words[0] === 'dimension' || words[0] === 'multidimension') {
      const [name, dim] = splitName(words[1]);
      for (const [n, v] of variable([name], it.head, items(it.body))) {
        if (dim && !v.dim) v.dim = `1:${dim}`;
        if (conditional) v.required = false;
        out.set(n, v);
      }
    } else if (words[0] === 'vargroup' || words[0] === 'dimensiongroup') {
      const inner = items(it.body);
      const names = inner.filter((x) => x.body === null && /^(var|dimension)\s/.test(x.head)).map((x) => splitName(x.head.split(/\s+/)[1])[0]);
      const rest = inner.filter((x) => x.body !== null);
      for (const [n, v] of variable(names, it.head, rest)) {
        if (conditional) v.required = false;
        out.set(n, v);
      }
    } else {
      collectVars(it.body, out, conditional || CONDITIONAL.has(words[0]));
    }
  }
}

function parseDef(text) {
  // The header line has braces of its own (-distribution {Quantum ESPRESSO}): the body is the item with -program.
  const top = items(text).find((x) => /-program/.test(x.head));
  const namelists = {};
  const cards = {};
  for (const it of items(top.body)) {
    const words = it.head.split(/\s+/);
    if (words[0] === 'namelist' && it.body !== null) {
      const vars = new Map();
      collectVars(it.body, vars);
      namelists[words[1]] = vars;
    } else if (words[0] === 'card' && it.body !== null) {
      // The card's keyword options, when the definition lists them.
      const values = [];
      for (const inner of items(it.body)) {
        if (!inner.head.startsWith('flag') || inner.body === null) continue;
        const sub = items(inner.body);
        const enumItem = sub.find((x) => x.head === 'enum');
        if (enumItem) values.push(...enumItem.body.split('|').map((s) => s.trim()).filter(Boolean));
        for (const o of sub.filter((x) => x.head === 'options')) values.push(...items(o.body).filter((x) => x.head.startsWith('opt')).map((x) => x.head.replace(/^opt\s+-val\s+/, '').replace(/^['"]|['"]$/g, '')));
      }
      cards[words[1]] = [...new Set(values)];
    }
  }
  return { namelists, cards };
}

// ---------------------------------------------------------------------------------------------
// The Fortran source declares every name a namelist accepts, with `! obsolete` on retired ones.
// Names that are accepted but missing from the documentation must not be reported as unknown.

/** program id → the source files with its `NAMELIST / name / …` declarations. */
const SOURCES = {
  pw: ['Modules/input_parameters.f90'],
  ph: ['PHonon/PH/phq_readin.f90'],
  projwfc: ['PP/src/projwfc.f90'],
  dos: ['PP/src/dos.f90'],
  bands: ['PP/src/bands.f90'],
  pp: ['PP/src/postproc.f90', 'PP/src/chdens_module.f90'],
  pw2bgw: ['PP/src/pw2bgw.f90'],
};
/** Names the input reader warns about ("The input parameter X is obsolete"). */
const OBSOLETE_SOURCE = 'Modules/read_namelists.f90';

/** namelist (upper case) → Map(lower-case name → 'obsolete' | ''), from `NAMELIST / name / a, b, c &` statements. */
function parseNamelistDeclarations(source) {
  const out = {};
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*NAMELIST\s*\/\s*(\w+)\s*\/(.*)$/i);
    if (!m) continue;
    const names = new Map();
    let rest = m[2];
    let continued = true;
    let first = true;
    while (continued) {
      const [code, ...comment] = rest.split('!');
      const obsolete = /obsolete/i.test(comment.join('!'));
      continued = /&\s*$/.test(code);
      for (const n of code.replace(/&\s*$/, '').split(',').map((x) => x.trim()).filter(Boolean)) names.set(n.toLowerCase(), obsolete ? 'obsolete' : '');
      if (!continued) break;
      rest = lines[++i] ?? '';
      first = false;
    }
    out[m[1].toUpperCase()] = names;
  }
  return out;
}

const programs = {};
for (const [id, path] of Object.entries(PROGRAMS)) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  programs[id] = parseDef(await res.text());
  if (SOURCES[id]) {
    const declared = {};
    for (const file of SOURCES[id]) {
      const src = await fetch(`${BASE}/${file}`);
      if (!src.ok) throw new Error(`${file}: ${src.status}`);
      for (const [nl, names] of Object.entries(parseNamelistDeclarations(await src.text()))) {
        declared[nl] = new Map([...(declared[nl] ?? []), ...names]);
      }
    }
    // pw.x also warns at run time about obsolete parameters.
    let warned = new Set();
    if (id === 'pw') {
      const reader = await fetch(`${BASE}/${OBSOLETE_SOURCE}`);
      if (!reader.ok) throw new Error(`${OBSOLETE_SOURCE}: ${reader.status}`);
      warned = new Set([...(await reader.text()).matchAll(/input parameter (\w+) is obsolete/gi)].map((m) => m[1].toLowerCase()));
    }
    for (const [nl, vars] of Object.entries(programs[id].namelists)) {
      const names = declared[nl];
      if (!names) {
        console.log(`  note: no declaration found for &${nl}`);
        continue;
      }
      const documented = new Set([...vars.keys()].map((k) => k.toLowerCase()));
      for (const [lower, flag] of names) {
        if (documented.has(lower)) continue;
        const obsolete = flag === 'obsolete' || warned.has(lower);
        vars.set(lower, {
          type: '',
          default: '',
          summary: obsolete
            ? 'Obsolete: still read by this version, which prints a warning, but no longer documented. See the HUBBARD card for the DFT+U inputs that replaced the Hubbard variables.'
            : 'Accepted by this version but not described in the input documentation.',
          options: [],
          dim: '',
          required: false,
          status: obsolete ? 'obsolete' : 'undocumented',
        });
      }
      // The reverse: documented but not declared (reported to catch parser slips).
      const undeclared = [...documented].filter((n) => !names.has(n));
      if (undeclared.length) console.log(`  note: ${nl} documented but not in the source declaration: ${undeclared.join(' ')}`);
    }
  }
  const n = Object.values(programs[id].namelists).reduce((a, m) => a + m.size, 0);
  console.log(`${id}: ${Object.keys(programs[id].namelists).join(', ')}: ${n} variables, cards: ${Object.keys(programs[id].cards).join(' ') || '-'}`);
}

const q = (s) => JSON.stringify(s);
let out = `// Generated by scripts/fetch-qe-tags.mjs from the Quantum ESPRESSO ${TAG.replace('qe-', '')} input definitions
// (INPUT_*.def in https://gitlab.com/QEF/q-e). Do not edit by hand: run the script again.
//
// The descriptions are excerpts from the Quantum ESPRESSO documentation. Quantum ESPRESSO is
// distributed under the GNU General Public License, version 2 or later (LICENSES/GPL-2.0.txt),
// and these excerpts keep that licence.

/** [type (I/R/L/C), default, summary, allowed values [value, note][], index range "1:ntyp" or "", required, status "" | "obsolete" | "undocumented"] */
export type QeVarRow = [string, string, string, [string, string][], string, boolean, string];

export const QE_VERSION = ${q(TAG.replace('qe-', ''))};

export const QE_DEFS: Record<string, { namelists: Record<string, Record<string, QeVarRow>>; cards: Record<string, string[]> }> = {\n`;
for (const [id, prog] of Object.entries(programs)) {
  out += `  ${id}: {\n    namelists: {\n`;
  for (const [nl, vars] of Object.entries(prog.namelists)) {
    out += `      ${nl}: {\n`;
    for (const [name, v] of [...vars].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }))) {
      out += `        ${q(name)}: [${q(v.type)}, ${q(v.default)}, ${q(v.summary)}, ${q(v.options)}, ${q(v.dim)}, ${v.required}, ${q(v.status ?? '')}],\n`;
    }
    out += `      },\n`;
  }
  out += `    },\n    cards: ${JSON.stringify(prog.cards)},\n  },\n`;
}
out += '};\n';
writeFileSync(new URL('../src/core/qe/tags.generated.ts', import.meta.url), out);
console.log(`wrote src/core/qe/tags.generated.ts (${(out.length / 1024).toFixed(0)} kB)`);
