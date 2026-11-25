// Hover text and completions for ABINIT inputs, independent of VS Code.

import { abinitCodeOf, parseAbinit, type AbinitDoc, type AbinitEntry } from './parse';
import { abinitDocUrl, isAbinitArray, ABINIT_UNIT_WORDS, abinitVariables, type AbinitVariable, type AbinitSuffixKind } from './tags';

const MAX_DOC = 1000;

const CHARACTERISTICS: Record<string, string> = {
  energy: 'can take an energy unit (Ha, Ry, eV, meV, K)',
  length: 'can take a length unit (Bohr, Angstrom, nm)',
  magnetic_field: 'can take a magnetic field unit (T, Tesla)',
  develop: 'under development',
  evolving: 'changes during a relaxation or molecular dynamics run',
  no_multi: 'the same for all datasets: no dataset index',
  input_only: 'input only: not echoed in the output',
  internal_only: 'internal: not an input variable in the documentation',
};

/** What the suffix of the word on the page means. */
function suffixNote(k: AbinitSuffixKind, suffix: string): string | undefined {
  switch (k.kind) {
    case 'dataset':
      return `\`${suffix}\`: the value for dataset ${k.index}`;
    case 'wild':
      return k.unit !== undefined ? `\`${suffix}\`: the value for every dataset whose index ends in ${k.unit}` : `\`${suffix}\`: the value for the datasets ${k.tens}0 to ${k.tens}9`;
    case 'series':
      return k.op === ':' ? `\`${suffix}\`: the first term of a series over the datasets (needs \`+\` or \`*\`)` : k.op === '+' ? `\`${suffix}\`: the increment of the series from dataset to dataset` : `\`${suffix}\`: the factor of the series from dataset to dataset`;
    default:
      return undefined;
  }
}

/** Markdown for a variable: type, dimension, units, default, the documentation and the allowed values. */
export function abinitVariableMarkdown(v: AbinitVariable, entry?: AbinitEntry): string {
  const dims = isAbinitArray(v) ? ` (${v.dims.join(', ')})` : '';
  const head = `**${v.name}** · ${v.type}${dims}${v.varset ? ` · ${v.varset}` : ''}`;
  const parts = [head];
  if (!v.documented) {
    parts.push('ABINIT reads this variable, but its documentation does not list it.');
    return parts.join('\n\n');
  }
  if (v.mnemonic) parts.push(`*${v.mnemonic}*`);
  if (entry) {
    const note = suffixNote(entry.kind, entry.suffix);
    if (note) parts.push(note);
  }
  const doc = v.doc.length > MAX_DOC ? `${v.doc.slice(0, MAX_DOC).replace(/\s+\S*$/, '')} …` : v.doc;
  if (doc) parts.push(doc);
  const facts = [v.default && `default: \`${v.default}\``, v.commentDefault && v.commentDefault.trim(), v.requires && `requires: ${v.requires.replace(/\s+/g, ' ')}`, v.excludes && `excludes: ${v.excludes.replace(/\s+/g, ' ')}`].filter(Boolean);
  if (facts.length) parts.push(facts.join(' · '));
  const chars = v.characteristics.map((c) => CHARACTERISTICS[c]).filter(Boolean);
  if (chars.length) parts.push(chars.join('; '));
  const current = entry?.args[0]?.text;
  if (current !== undefined && v.options.length) {
    const hit = v.options.find((o) => o.value === current.replace(/^"|"$/g, '') || o.value === String(Number(current)));
    if (hit) parts.push(`**${current}**: ${hit.note}`);
  }
  parts.push(`[ABINIT documentation](${abinitDocUrl(v.name)})`);
  return parts.join('\n\n');
}

export function abinitHover(doc: AbinitDoc, offset: number): { markdown: string; start: number; end: number } | undefined {
  for (const e of doc.entries) {
    if (offset >= e.keySpan.start && offset <= e.keySpan.end) return e.variable && { markdown: abinitVariableMarkdown(e.variable, e), start: e.keySpan.start, end: e.keySpan.end };
    for (const u of e.units) {
      if (offset >= u.start && offset <= u.end) {
        const c = ABINIT_UNIT_WORDS[u.text.toLowerCase()];
        const what = c === 'none' ? 'atomic units: ABINIT reads the word but does not convert anything' : `a ${c} unit: the values before it are converted to atomic units`;
        return { markdown: `**${u.text}** · unit · ${what}`, start: u.start, end: u.end };
      }
    }
    if (e.variable?.options.length) {
      const t = e.args[0];
      if (t && offset >= t.start && offset <= t.end) {
        const hit = e.variable.options.find((o) => o.value === t.text.replace(/^"|"$/g, '') || o.value === String(Number(t.text)));
        if (hit) return { markdown: `**${e.variable.name} = ${t.text}**: ${hit.note}`, start: t.start, end: t.end };
      }
    }
  }
  return undefined;
}

export interface AbinitCompletion {
  label: string;
  kind: 'variable' | 'value';
  detail?: string;
  documentation?: string;
  insertText: string;
  sortText: string;
}

/**
 * Variable names at the start of a word, the documented values right after an integer or string variable, the units
 * after the values of a variable that takes one.
 */
export function abinitCompletions(doc: AbinitDoc, offset: number): AbinitCompletion[] {
  const lineStart = doc.text.lastIndexOf('\n', offset - 1) + 1;
  const lineBefore = doc.text.slice(lineStart, offset);
  if (abinitCodeOf(lineBefore).length < lineBefore.length) return []; // inside a comment
  const partial = /[\w."+*:?-]*$/.exec(lineBefore)![0];
  // What comes before the word: the variable it belongs to.
  const prefix = parseAbinit(doc.text.slice(0, offset - partial.length));
  const owner = prefix.entries[prefix.entries.length - 1];
  const v = owner?.variable;

  if (partial === '' || /^["\d+.-]/.test(partial)) {
    if (v && !owner.args.length && v.options.length) {
      return v.options.map((o, i) => ({
        label: o.value,
        kind: 'value' as const,
        detail: o.note,
        insertText: v.type === 'string' && !partial.startsWith('"') ? `"${o.value}"` : o.value,
        sortText: String(i).padStart(4, '0'),
      }));
    }
    const unitClass = v?.characteristics.includes('energy') ? 'energy' : v?.characteristics.includes('length') ? 'length' : undefined;
    if (partial === '' && owner?.args.length && !owner.units.length && unitClass) {
      return Object.entries(ABINIT_UNIT_WORDS)
        .filter(([, c]) => c === unitClass || c === 'none')
        .map(([w, c], i) => ({ label: w, kind: 'value' as const, detail: c === 'none' ? 'atomic units (no conversion)' : `${unitClass} unit`, insertText: w, sortText: String(i).padStart(4, '0') }));
    }
    if (partial !== '') return [];
  }
  // A variable name.
  if (!/^[A-Za-z_]\w*$/.test(partial) && partial !== '') return [];
  const set = new Set(doc.entries.filter((e) => e.keySpan.end < offset || e.keySpan.start > offset).filter((e) => e.kind.kind === 'plain').map((e) => e.variable?.name));
  return abinitVariables()
    .filter((x) => !set.has(x.name))
    .map((x) => ({
      label: x.name,
      kind: 'variable' as const,
      detail: [x.type, isAbinitArray(x) ? `(${x.dims.join(', ')})` : '', x.mnemonic].filter(Boolean).join(' '),
      documentation: abinitVariableMarkdown(x),
      insertText: x.name,
      sortText: (x.varset === 'basic' ? '0' : x.characteristics.includes('develop') ? '2' : '1') + x.name,
    }));
}
