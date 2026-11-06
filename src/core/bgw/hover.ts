// Hover text and completions for BerkeleyGW inputs, independent of VS Code.

import type { BgwDoc } from './parse';
import { bgwManualUrl, keywordsOf, lookupKeyword, type BgwKeyword, type BgwProgram } from './tags';

const MAX_DOC = 1400;

/** Markdown for a keyword: type and unit, whether it is required, the documentation, allowed values. */
export function keywordMarkdown(k: BgwKeyword, current?: string): string {
  const type = k.kind === 'block' ? 'block' : k.type === 'toggle' ? 'flag' : k.type;
  const head = `**${k.kind === 'block' ? `begin ${k.name} … end` : k.name}** · ${k.program}.inp · ${type}${k.unit ? ` (${k.unit})` : ''}${k.required ? ' · **required**' : ''}`;
  const parts = [head];
  const doc = k.doc.length > MAX_DOC ? `${k.doc.slice(0, MAX_DOC).replace(/\s+\S*$/, '')} …` : k.doc;
  if (doc) parts.push(doc);
  const facts = [k.default && `default: \`${k.default}\``, k.example && k.kind !== 'block' && k.type !== 'toggle' && `example: \`${k.name} ${k.example}\``].filter(Boolean);
  if (facts.length) parts.push(facts.join(' · '));
  if (current !== undefined && k.options.length) {
    const hit = k.options.find((o) => o.value === String(Number(current)));
    if (hit) parts.push(`**${current}**: ${hit.note}`);
  }
  parts.push(`[BerkeleyGW manual](${bgwManualUrl(k.program)}#${k.name})`);
  return parts.join('\n\n');
}

/** The hover for the keyword (or block name) under `offset`. */
export function bgwHover(doc: BgwDoc, program: BgwProgram, offset: number): { markdown: string; start: number; end: number } | undefined {
  for (const e of doc.entries) {
    if (offset < e.keySpan.start || offset > e.keySpan.end) continue;
    const k = lookupKeyword(program, e.keyword);
    return k && { markdown: keywordMarkdown(k, e.args[0]?.text), start: e.keySpan.start, end: e.keySpan.end };
  }
  for (const b of doc.blocks) {
    if (offset < b.beginSpan.start || offset > b.beginSpan.end) continue;
    const k = lookupKeyword(program, b.name);
    return k && { markdown: keywordMarkdown(k), start: b.nameSpan.start, end: b.nameSpan.end };
  }
  return undefined;
}

export interface BgwCompletion {
  label: string;
  kind: 'keyword' | 'block' | 'value';
  detail?: string;
  documentation?: string;
  insertText: string;
  sortText: string;
}

/** Keywords at the start of a line (required ones first), the documented values after an integer keyword. */
export function bgwCompletions(doc: BgwDoc, program: BgwProgram, offset: number): BgwCompletion[] {
  if (doc.blocks.some((b) => offset > b.beginSpan.end && offset <= (b.endSpan?.start ?? doc.text.length))) return [];
  const lineStart = doc.text.lastIndexOf('\n', offset - 1) + 1;
  const before = doc.text.slice(lineStart, offset);
  if (before.startsWith('#')) return [];

  const value = before.match(/^(\S+) +(\S*)$/);
  if (value) {
    const k = lookupKeyword(program, value[1]);
    return (k?.options ?? []).map((o, i) => ({ label: o.value, kind: 'value' as const, detail: o.note, insertText: o.value, sortText: String(i).padStart(3, '0') }));
  }
  if (!/^\S*$/.test(before)) return [];
  const set = new Set(doc.entries.map((e) => e.keyword));
  const setBlocks = new Set(doc.blocks.map((b) => b.name));
  return keywordsOf(program)
    .filter((k) => (k.kind === 'block' ? !setBlocks.has(k.name) : !set.has(k.name)))
    .map((k) => ({
      label: k.kind === 'block' ? `begin ${k.name}` : k.name,
      kind: k.kind === 'block' ? ('block' as const) : ('keyword' as const),
      detail: [k.type === 'toggle' ? 'flag' : k.type, k.unit && `(${k.unit})`].filter(Boolean).join(' '),
      documentation: keywordMarkdown(k),
      insertText: k.kind === 'block' ? `begin ${k.name}\n  $0\nend` : k.type === 'toggle' || !k.example ? k.name : `${k.name} \${1:${k.example}}`,
      sortText: (k.required ? '0' : '1') + k.name.toLowerCase(),
    }));
}
