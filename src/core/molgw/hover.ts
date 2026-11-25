// Hover text and completions for MolGW inputs, independent of VS Code.

import type { MolgwDoc } from './parse';
import { atomicNumber, lookupMolgw, molgwKeywords, molgwManualUrl, MOLGW_ELEMENTS, baseName, type MolgwKeyword } from './tags';

const MAX_DOC = 1400;

const TYPES = { integer: 'integer', real: 'real', yesno: "yes/no (a string: 'yes' or 'no')", string: 'string', vector3: 'three reals' } as const;

/** Markdown for a variable: type, section, whether it is mandatory or experimental, the description, values, default. */
export function molgwKeywordMarkdown(k: MolgwKeyword): string {
  const head = `**${k.name}** · ${TYPES[k.type]}${k.mandatory ? ' · **mandatory**' : ''}${k.experimental ? ' · experimental' : ''}`;
  const parts = [head, `_${k.section}_`];
  const doc = k.doc.length > MAX_DOC ? `${k.doc.slice(0, MAX_DOC).replace(/\s+\S*$/, '')} …` : k.doc;
  if (doc) parts.push(doc);
  const facts: string[] = [];
  if (k.default !== '') facts.push(`default: \`${k.default}\``);
  if (k.type !== 'yesno' && k.values.length) {
    const shown = k.values.length > 14 ? `${k.values.slice(0, 14).join(', ')}, … (${k.values.length})` : k.values.join(', ');
    facts.push(`${k.valuesAre === 'strict' ? 'accepted' : 'listed'} values: ${shown}`);
  }
  if (facts.length) parts.push(facts.join(' · '));
  parts.push(`[MolGW input variables](${molgwManualUrl(k.name)})`);
  return parts.join('\n\n');
}

/** The hover for the variable name under `offset`, or the element symbol of an atom line. */
export function molgwHover(doc: MolgwDoc, offset: number): { markdown: string; start: number; end: number } | undefined {
  for (const e of doc.entries) {
    if (offset < e.keySpan.start || offset > e.keySpan.end) continue;
    const k = lookupMolgw(baseName(e.key));
    return k && { markdown: molgwKeywordMarkdown(k), start: e.keySpan.start, end: e.keySpan.end };
  }
  for (const a of doc.atoms) {
    const f = a.fields[0];
    if (!f || offset < f.start || offset > f.end) continue;
    const z = atomicNumber(f.text);
    return z === undefined ? undefined : { markdown: `**${f.text}** · element ${z}`, start: f.start, end: f.end };
  }
  return undefined;
}

export interface MolgwCompletion {
  label: string;
  kind: 'keyword' | 'value';
  detail?: string;
  documentation?: string;
  insertText: string;
  sortText: string;
}

const placeholder = (k: MolgwKeyword) => {
  if (k.type === 'yesno') return "'${1|yes,no|}'";
  if (k.type === 'string') return `'\${1:${k.default.replace(/[$}\\]/g, '\\$&')}}'`;
  if (k.type === 'vector3') return `\${1:${k.default || '0.0 0.0 0.0'}}`;
  return `\${1:${k.default || '0'}}`;
};

/**
 * Inside the namelist: variable names at the start of an item (the mandatory ones first), and the accepted words
 * after `name =`. In the atom lines: element symbols at the start of a line.
 */
export function molgwCompletions(doc: MolgwDoc, offset: number): MolgwCompletion[] {
  const lineStart = doc.text.lastIndexOf('\n', offset - 1) + 1;
  const before = doc.text.slice(lineStart, offset);
  const group = doc.group;
  const inGroup = !!group && offset > group.nameSpan.end && (!group.end || offset <= group.end.start);
  if (!group) return [];

  if (!inGroup) {
    // The atom lines: an element symbol at the start of the line.
    if (!group.end || lineStart <= group.end.end || !/^\s*[A-Za-z]*$/.test(before) || before.includes('!')) return [];
    return MOLGW_ELEMENTS.map((s, i) => ({ label: s, kind: 'value' as const, detail: `element ${i + 1}`, insertText: s, sortText: String(i).padStart(3, '0') }));
  }
  if (before.includes('!')) return [];

  // After `name =`: the accepted words.
  const value = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"]?)([^'"\s,=]*)$/);
  if (value) {
    const k = lookupMolgw(value[1]);
    if (!k) return [];
    const wrap = (v: string) => (value[2] ? v : `'${v}'`);
    return k.values.map((v, i) => ({ label: v, kind: 'value' as const, detail: k.valuesAre === 'strict' ? undefined : 'listed in the manual', insertText: wrap(v), sortText: String(i).padStart(4, '0') }));
  }

  // At the start of an item: names not yet set. (After a complete value on the same line this also offers names.)
  if (!/(^|[\s,])[A-Za-z0-9_]*$/.test(before)) return [];
  const set = new Set(doc.entries.filter((e) => e.keySpan.end <= offset - (before.match(/[A-Za-z0-9_]*$/)![0].length)).map((e) => e.key.toLowerCase()));
  return molgwKeywords()
    .filter((k) => !set.has(k.name))
    .map((k) => ({
      label: k.name,
      kind: 'keyword' as const,
      detail: `${TYPES[k.type]}${k.default !== '' ? ` · default ${k.default}` : ''}`,
      documentation: molgwKeywordMarkdown(k),
      insertText: `${k.name} = ${placeholder(k)}`,
      sortText: (k.mandatory ? '0' : k.experimental ? '2' : '1') + k.name,
    }));
}
