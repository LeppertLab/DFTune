// Regenerates src/core/tags/wikiTags.generated.ts from the VASP wiki (Category:INCAR tag).
// Usage: node scripts/fetch-wiki-tags.mjs
import { writeFileSync } from 'node:fs';

const API = 'https://vasp.at/wiki/api.php';
const OUT = new URL('../src/core/tags/wikiTags.generated.ts', import.meta.url);

async function query(params) {
  const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', ...params })}`);
  if (!res.ok) throw new Error(`${res.status} for ${params.action}`);
  return res.json();
}

async function categoryTitles(category) {
  const titles = [];
  let cont = {};
  do {
    const j = await query({ action: 'query', list: 'categorymembers', cmtitle: category, cmlimit: '500', ...cont });
    titles.push(...j.query.categorymembers.filter((m) => m.ns === 0).map((m) => m.title));
    cont = j.continue;
  } while (cont);
  return titles;
}

async function pageContents(titles) {
  const pages = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const j = await query({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.slice(i, i + 50).join('|') });
    for (const p of Object.values(j.query.pages)) pages.set(p.title, p.revisions?.[0]?.slots?.main?.['*'] ?? '');
  }
  return pages;
}

/** Redirect pages that point at tag pages (alias → tag), e.g. ML_IERR, LVDW. */
async function redirects(titles) {
  const aliases = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    let cont = {};
    do {
      const j = await query({ action: 'query', prop: 'redirects', rdlimit: 'max', titles: titles.slice(i, i + 50).join('|'), ...cont });
      for (const p of Object.values(j.query.pages)) {
        for (const r of p.redirects ?? []) aliases.set(r.title.replace(/ /g, '_'), p.title.replace(/ /g, '_'));
      }
      cont = j.continue;
    } while (cont);
  }
  return aliases;
}

const LATEX = {
  AA: 'Å', Gamma: 'Γ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', sigma: 'σ', mu: 'μ', lambda: 'λ',
  omega: 'ω', rho: 'ρ', pi: 'π', chi: 'χ', epsilon: 'ε', times: '×', cdot: '·',
};

const ENTITIES = {
  le: '≤', ge: '≥', ne: '≠', lt: '<', gt: '>', nbsp: ' ', amp: '&', Aring: 'Å', times: '×', lang: '⟨', rang: '⟩', nabla: '∇',
  alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', eta: 'η', lambda: 'λ', mu: 'μ', psi: 'ψ', sigma: 'σ', omega: 'ω',
};

/** Wikitext → plain text, good enough for one-line summaries. */
function plain(s) {
  return s
    .replace(/\{\{!\}\}/g, '|')
    .replace(/\{\{=\}\}/g, '=')
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/\\ldots/g, '…')
    .replace(/<math>(.*?)<\/math>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{TAG\|([^|}]+)\|([^|}=]+)\}\}/g, '$1 = $2')
    .replace(/\{\{(?:TAG|TAGO|FILE|sc)\|([^|}]+)[^}]*\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\S+\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\\(AA|Gamma|alpha|beta|gamma|delta|sigma|mu|lambda|omega|rho|pi|chi|epsilon|times|cdot)\b/g, (_, c) => LATEX[c])
    .replace(/\\[a-z]+\{([^}]*)\}/gi, '$1')
    .replace(/\\[a-z]+/gi, '')
    .replace(/[{}]/g, '')
    .replace(/¦/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

// Wiki pages that are categorized as INCAR tags but are not tags themselves.
const NOT_TAGS = new Set(['Profiling', 'NMRCAR.magres', 'NICS', 'POSNICS']);

const NB = /\{\{NB\|(\w+)\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/g;

/** The wiki's deprecation note, if the page has one. */
function deprecation(text, name) {
  // Notes about deprecated *values* of a tag (e.g. PREC = High) don't count.
  const subject = `(?:this (?:tag|feature|plugin)|the ${name} tag|${name})`;
  const says = new RegExp(`${subject}[^.]*?\\b(?:is|are) (?:now )?(?:considered (?:as )?)?(?:deprecated|obsolete)|^not supported since`, 'i');
  for (const [, , body] of text.matchAll(NB)) {
    const note = plain(body);
    if (says.test(note)) return note;
  }
  return '';
}

/** Wiki categories of each page. */
async function pageCategories(titles) {
  const cats = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    let cont = {};
    do {
      const j = await query({ action: 'query', prop: 'categories', cllimit: 'max', titles: titles.slice(i, i + 50).join('|'), ...cont });
      for (const p of Object.values(j.query.pages)) {
        for (const c of p.categories ?? []) cats.set(p.title, [...(cats.get(p.title) ?? []), c.title.replace(/^Category:/, '')]);
      }
      cont = j.continue;
    } while (cont);
  }
  return cats;
}

// Wiki category → the extension's category (see src/core/tags/schema.ts). The first match in this
// order wins, so specific topics come before broad ones.
const CATEGORY_MAP = [
  ['mlff', ['Machine-learned force fields']],
  ['ldau', ['DFT+U', 'Strongly correlated electrons']],
  ['vdw', ['Van der Waals functionals']],
  ['manybody', ['GW', 'Many-body perturbation theory', 'Bethe-Salpeter equations', 'ACFDT', 'Low-scaling GW and RPA', 'Constrained-random-phase approximation', 'MP2']],
  ['xc', ['Exchange-correlation functionals', 'Hybrid functionals']],
  ['spin', ['Magnetism', 'Spin-orbit coupling', 'Noncollinear magnetism', 'Spin spirals']],
  ['md', ['Molecular dynamics', 'Advanced molecular-dynamics sampling', 'Thermostats', 'Ensemble properties', 'Ensembles']],
  ['response', ['Dielectric properties', 'Linear response', 'NMR', 'Berry phases', 'Phonons', 'Electron-phonon interactions', 'XAS', 'Electrostatics']],
  ['ionic', ['Ionic minimization', 'Transition states', 'Forces']],
  ['smearing', ['Electronic occupancy']],
  ['parallel', ['Parallelization', 'Performance', 'Memory']],
  ['flow', ['Files', 'Density of states', 'Wannier functions', 'Band structure', 'Calculation setup']],
  ['electronic', ['Electronic minimization', 'Density mixing', 'Electronic ground-state properties', 'Projector-augmented-wave method', 'Symmetry', 'Crystal momentum', 'Charge density', 'Potential', 'Molecules', '2D materials']],
];

function categoryOf(wikiCategories) {
  return CATEGORY_MAP.find(([, names]) => names.some((n) => wikiCategories.includes(n)))?.[0] ?? '';
}

/** "{{DEF|TAG|12|if IBRION=0|0|else}}" → "12 if IBRION=0; 0 else". */
function conditionalDefault(text) {
  const def = text.match(/\{\{DEF\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/);
  if (!def) return '';
  // Split at '|' outside nested templates such as {{TAG|ML_MODE|run}}.
  const raw = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < def[1].length; i++) {
    if (def[1].startsWith('{{', i)) depth++;
    else if (def[1].startsWith('}}', i)) depth--;
    else if (def[1][i] === '|' && depth === 0) {
      raw.push(def[1].slice(start, i));
      start = i + 1;
    }
  }
  raw.push(def[1].slice(start));
  const args = raw.slice(1).map((a) => plain(a));
  const parts = [];
  for (let i = 0; i < args.length; i += 2) if (args[i]) parts.push([args[i], args[i + 1]].filter(Boolean).join(' '));
  return parts.join('; ');
}

const titles = (await categoryTitles('Category:INCAR_tag')).filter((t) => !NOT_TAGS.has(t));
const contents = await pageContents(titles);
const wikiCategories = await pageCategories(titles);
const tags = [];
for (const title of titles) {
  // {{!}} is a literal '|' inside template arguments; hide it from the TAGDEF split.
  const text = (contents.get(title) ?? '').replace(/\{\{!\}\}/g, '¦');
  const name = title.replace(/ /g, '_');
  const tagdef = text.match(/\{\{TAGDEF\|([^|}]*)(?:\|([^|}]*))?(?:\|((?:[^{}]|\{\{[^{}]*\}\})*))?\}\}/);
  // The description runs until a blank line or the '----' rule, and may wrap.
  const desc = text.match(/Description:\s*([\s\S]*?)(?:\n\s*\n|\n?-{4}|$)/);
  // Pages without a description line: fall back to the first prose paragraph.
  const para = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^-{4,}/, '').trim())
    .find((p) => /^[A-Za-z']/.test(p) && !p.startsWith('==') && !p.startsWith('[[Category'));
  let summary = desc ? plain(desc[1]) : para ? plain(para).split(/(?<=\.)\s/)[0] : '';
  if (summary.length > 300) summary = summary.slice(0, summary.lastIndexOf(' ', 297)) + '…';
  tags.push({
    name,
    type: tagdef?.[2] ? plain(tagdef[2]).replace(/^\[|\]$/g, '') : '',
    default: tagdef?.[3] ? plain(tagdef[3]) : conditionalDefault(text),
    category: categoryOf(wikiCategories.get(title) ?? []),
    summary,
    deprecated: deprecation(text, title),
  });
}
tags.sort((a, b) => a.name.localeCompare(b.name));

// Keep only redirects that look like tag names and aren't tags themselves.
const names = new Set(tags.map((t) => t.name));
const aliases = [...(await redirects(titles))]
  .filter(([alias, target]) => /^[A-Z][A-Z0-9_]*$/.test(alias) && !names.has(alias) && names.has(target))
  .sort(([a], [b]) => a.localeCompare(b));

const lines = tags.map((t) => `  ${JSON.stringify(t.name)}: ${JSON.stringify([t.summary, t.type, t.default, t.category, ...(t.deprecated ? [t.deprecated] : [])])},`);
const aliasLines = aliases.map(([alias, target]) => `  ${JSON.stringify(alias)}: ${JSON.stringify(target)},`);
writeFileSync(
  OUT,
  `// Generated by scripts/fetch-wiki-tags.mjs from https://vasp.at/wiki (Category:INCAR tag). Do not edit.
// The text is excerpted from the VASP Wiki, copyright VASP Software GmbH and the VASP Wiki authors,
// and is distributed under the GNU Free Documentation License 1.2 (see LICENSES/GFDL-1.2.txt),
// unlike the rest of this project (MIT).
// name: [summary, type, default, category ('' if none fits), deprecation note?]

import type { Category } from './schema';

export const WIKI_TAGS: Record<string, [summary: string, type: string, defaultValue: string, category: Category | '', deprecated?: string]> = {
${lines.join('\n')}
};

/** Wiki redirects from another tag name (alias → documented tag), e.g. renamed or legacy tags. */
export const WIKI_ALIASES: Record<string, string> = {
${aliasLines.join('\n')}
};
`,
);
console.log(`${tags.length} tags, ${tags.filter((t) => !t.summary).length} without summary, ${tags.filter((t) => t.deprecated).length} deprecated, ${aliases.length} aliases`);
