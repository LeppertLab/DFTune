// Generates src/core/bgw/keywords.generated.ts from the keyword documentation of a BerkeleyGW
// distribution: documentation/input_files/*.inp. Run:
//
//   node scripts/fetch-bgw-keywords.mjs <path to the unpacked BerkeleyGW-4.0 directory>
//
// The distribution is at https://berkeleygw.org/download/ (BerkeleyGW-4.0.tar.gz). The .inp files
// are the source of the online manual (manual.berkeleygw.org); this script follows the rules the
// manual generator uses (documentation/user_manual/lib/bgw_input_keywords_to_markdown.py):
//
//   - a group of non-blank lines is documentation (`# text`), optional `#[unit=Ry,type=float,…]`
//     metadata and keywords: `keyword sample` (required) or `#keyword sample` (optional)
//   - the type is guessed from the sample argument: none → toggle, an integer, a float, several → array
//   - `begin name … end` is a block whose columns are labeled in the first line of its group
//   - `%include file.inp` splices a shared file; INTERNAL_ONLY sections are dropped
//
//
// The Fortran input readers are scanned too: BerkeleyGW dies on a keyword it does not know, but it
// accepts some that the documentation does not list; those are recorded as accepted.
//
// BerkeleyGW is distributed under a modified BSD license (LICENSES/BerkeleyGW.txt); the descriptions
// are excerpts from its documentation and keep that notice.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/fetch-bgw-keywords.mjs <unpacked BerkeleyGW-4.0 directory>');
  process.exit(1);
}
const dir = join(root, 'documentation', 'input_files');
const VERSION = process.argv[3] ?? '4.0';

/** program id → file. Only the keyword-style inputs; fixed-format ones (kgrid.inp, …) are not here. */
const PROGRAMS = {
  epsilon: 'epsilon.inp',
  sigma: 'sigma.inp',
  kernel: 'kernel.inp',
  absorption: 'absorption.inp',
  inteqp: 'inteqp.inp',
};

/** The Fortran files whose `keyword` comparisons make up the accepted keywords of each program. */
const READERS = {
  epsilon: ['Epsilon/inread.f90', 'Epsilon/algos_epsilon.f90'],
  sigma: ['Sigma/inread.f90', 'Sigma/algos_sigma.f90'],
  kernel: ['BSE/inread_kernel.f90', 'BSE/algos_kernel.f90'],
  absorption: ['BSE/inread.f90', 'BSE/algos_absorption.f90'],
  inteqp: ['BSE/inread.f90', 'BSE/algos_absorption.f90'], // inteqp.f90 calls the absorption reader
};
const COMMON_READERS = ['Common/inread_common.f90', 'Common/scissors.f90', 'Common/algos_common.f90'];

/** String literals compared with `keyword` in a Fortran reader. */
function acceptedKeywords(files) {
  const out = new Set();
  for (const file of files) {
    for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
      if (!/keyword/i.test(line) || line.trim().startsWith('!')) continue;
      for (const m of line.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)) out.add(m[1]);
    }
  }
  out.delete('begin');
  out.delete('end');
  return out;
}

const isInteger = (s) => /^-?\d+$/.test(s);
const isFloat = (s) => /^-?(\d+\.?\d*|\.\d+)([dDeE][+-]?\d+)?$/.test(s);

/** The lines of a file with `%include` spliced in and INTERNAL_ONLY sections removed. */
function readLines(file, seen = new Set()) {
  if (seen.has(file)) throw new Error(`include loop at ${file}`);
  const out = [];
  let internal = false;
  for (const raw of readFileSync(join(dir, file), 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('#BEGIN_INTERNAL_ONLY')) internal = true;
    else if (line.startsWith('#END_INTERNAL_ONLY')) internal = false;
    else if (internal) continue;
    else if (line.startsWith('%include')) out.push(...readLines(line.split(/\s+/)[1], new Set([...seen, file])));
    else out.push(line);
  }
  return out;
}

/** Documentation text: [[keyword]] references become `keyword`. */
const clean = (s) =>
  s
    .replace(/\[\[([^\]]+)\]\]/g, '`$1`')
    .replace(/^#{1,6} (.+)$/gm, '**$1**') // group headings
    .replace(/\s+$/, '');

function parseMetadata(line) {
  const meta = {};
  for (const item of line.replace(/^[#\s[]+/, '').replace(/\]\s*$/, '').split(',')) {
    const [k, ...v] = item.split('=');
    if (k && v.length) meta[k.trim()] = v.join('=').trim();
  }
  return meta;
}

/** Keywords of one file, in order. */
function parse(file) {
  const keywords = [];
  // Blocks of consecutive non-blank lines.
  const groups = [];
  let cur = [];
  for (const raw of readLines(file)) {
    const line = raw.trim();
    if (line === '') {
      if (cur.length) groups.push(cur);
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) groups.push(cur);

  for (const group of groups) {
    let doc = [];
    let meta = {};
    for (let i = 0; i < group.length; i++) {
      const hasPound = group[i].startsWith('#');
      const line = group[i].replace(/^#+/, '');
      if (line === '') {
        doc.push('');
        continue;
      }
      const isKeyword = line[0] !== ' ' && line[0] !== '[';
      if (line.startsWith('[')) {
        meta = parseMetadata(line);
        continue;
      }
      if (!isKeyword) {
        doc.push(line.slice(1));
        continue;
      }
      const tokens = line.split(/\s+/);
      const required = meta.required !== undefined ? meta.required === 'True' : !hasPound;
      let kind = 'keyword';
      let name = tokens[0];
      let cols;
      let type;
      if (tokens[0] === 'begin') {
        kind = 'block';
        name = tokens[1];
        // The columns are labeled in the first line of the group: "# qx qy qz …".
        cols = group[0].replace(/^#+/, '').trim().split(/\s+/);
        while (i + 1 < group.length && !/\bend\b/.test(group[i + 1])) i++;
        i++; // the end line
        type = 'block';
      } else if (meta.type) {
        type = meta.type;
      } else if (tokens.length === 1) type = 'toggle';
      else if (tokens.length === 2) type = isInteger(tokens[1]) ? 'integer' : isFloat(tokens[1]) ? 'float' : 'string';
      else type = 'array';
      // A default only where the metadata gives one: the sample argument is an example, not the default.
      const def = meta.default && meta.default !== 'None' ? meta.default : '';
      keywords.push({ name, kind, type, unit: meta.unit ?? '', required, default: def, doc: clean(doc.join('\n').trim()), cols, example: kind === 'block' ? '' : tokens.slice(1).join(' ') });
      doc = [];
      meta = {};
    }
  }
  return keywords;
}

/** Allowed values from list items such as "- Set to 0 to compute … (default)." or "- 2: full …". */
function optionsOf(doc) {
  const options = [];
  for (const line of doc.split('\n')) {
    const m = line.match(/^\s*-\s*(?:[Ss]et (?:it )?to |[Ii]f set to |[Uu]se |=\s*)?`?(-?\d+)`?\s*(?:to |:|=|-|–|,)?\s*(.*)$/);
    if (m) options.push([m[1], m[2].replace(/\s+/g, ' ').trim()]);
  }
  return options;
}

let out = `// Generated by scripts/fetch-bgw-keywords.mjs from the BerkeleyGW ${VERSION} documentation
// (documentation/input_files/*.inp). Do not edit by hand: run the script again.
//
// The descriptions are excerpts from the BerkeleyGW documentation. BerkeleyGW is distributed under a
// modified BSD license (LICENSES/BerkeleyGW.txt), and these excerpts keep its notice.

/** [kind keyword|block, type, unit, required, default (only if stated), documentation, allowed values [value, note][], block columns, example value] */
export type BgwKeywordRow = ['keyword' | 'block', string, string, boolean, string, string, [string, string][], string[], string];

export const BGW_VERSION = ${JSON.stringify(VERSION)};

export const BGW_DEFS: Record<string, Record<string, BgwKeywordRow>> = {\n`;
for (const [id, file] of Object.entries(PROGRAMS)) {
  const keywords = parse(file);
  // A keyword may appear in several places (e.g. broadening): the first description wins, required if any is.
  const byName = new Map();
  for (const k of keywords) {
    const have = byName.get(k.name);
    if (!have) byName.set(k.name, k);
    else if (k.required) have.required = true;
  }
  console.log(`${id}: ${byName.size} keywords (${[...byName.values()].filter((k) => k.required).map((k) => k.name).join(', ') || 'none required'})`);
  out += `  ${id}: {\n`;
  for (const k of [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    out += `    ${JSON.stringify(k.name)}: [${JSON.stringify(k.kind)}, ${JSON.stringify(k.type)}, ${JSON.stringify(k.unit)}, ${k.required}, ${JSON.stringify(k.default)}, ${JSON.stringify(k.doc)}, ${JSON.stringify(optionsOf(k.doc))}, ${JSON.stringify(k.cols ?? [])}, ${JSON.stringify(k.example)}],\n`;
  }
  out += '  },\n';
}
out += '};\n\n';
out += '/** Keywords the Fortran reader accepts but the documentation does not list (BerkeleyGW does not die on them). */\nexport const BGW_ACCEPTED: Record<string, string[]> = {\n';
for (const [id, files] of Object.entries(READERS)) {
  const documented = new Set(parse(PROGRAMS[id]).map((k) => k.name));
  const extra = [...acceptedKeywords([...files, ...COMMON_READERS])].filter((k) => !documented.has(k)).sort();
  console.log(`${id}: accepted but undocumented: ${extra.join(' ')}`);
  out += `  ${id}: ${JSON.stringify(extra)},\n`;
}
out += '};\n';
writeFileSync(new URL('../src/core/bgw/keywords.generated.ts', import.meta.url), out);
console.log(`wrote src/core/bgw/keywords.generated.ts (${(out.length / 1024).toFixed(0)} kB)`);
