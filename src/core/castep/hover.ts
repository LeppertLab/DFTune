// Hover text and completions for CASTEP cell and param files, independent of VS Code.

import { commentStart, type CastepDoc } from './parse';
import { canonicalCastepName, castepDocsUrl, castepKeywordsOf, lookupCastepKeyword, type CastepFile, type CastepKeyword } from './tags';

/** Markdown for a keyword or block: type, unit, default, the description and where the docs say it. */
export function castepKeywordMarkdown(k: CastepKeyword, current?: string): string {
  const type = k.kind === 'block' ? 'block' : k.type === 'defined' ? 'flag' : k.type;
  const parts = [`**${k.kind === 'block' ? `%BLOCK ${k.name.toUpperCase()}` : k.name}** · .${k.file}${type ? ` · ${type}` : ''}${k.unit ? ` (${k.unit})` : ''}`];
  if (k.doc) parts.push(k.doc);
  const facts = [k.default && `default: \`${k.default}\``, k.options.length && `values: ${k.options.map((o) => `\`${o}\``).join(', ')}`, !k.options.length && k.examples.length && `e.g. ${k.examples.map((o) => `\`${o}\``).join(', ')}`].filter(Boolean);
  if (facts.length) parts.push(facts.join(' · '));
  if (current && k.options.length && !k.options.some((o) => o.toLowerCase() === current.toLowerCase())) parts.push(`\`${current}\` is not one of the values the documentation lists.`);
  parts.push(`[CASTEP documentation](${castepDocsUrl(k.source)})`);
  return parts.join('\n\n');
}

/** The hover for the keyword, or the block name, under `offset`. */
export function castepHover(doc: CastepDoc, file: CastepFile, offset: number): { markdown: string; start: number; end: number } | undefined {
  for (const e of doc.entries) {
    if (offset < e.keySpan.start || offset > e.keySpan.end) continue;
    const k = lookupCastepKeyword(file, e.keyword);
    return k && { markdown: castepKeywordMarkdown(k, e.args[0]?.text), start: e.keySpan.start, end: e.keySpan.end };
  }
  for (const b of doc.blocks) {
    if (offset < b.nameSpan.start || offset > b.nameSpan.end) continue;
    const k = lookupCastepKeyword(file, b.name);
    return k && { markdown: castepKeywordMarkdown(k), start: b.nameSpan.start, end: b.nameSpan.end };
  }
  return undefined;
}

export interface CastepCompletion {
  label: string;
  kind: 'keyword' | 'block' | 'value';
  detail?: string;
  documentation?: string;
  insertText: string;
  sortText: string;
}

const detailOf = (k: CastepKeyword) => [k.type === 'defined' ? 'flag' : k.type, k.unit && `(${k.unit})`].filter(Boolean).join(' ');

/**
 * Keywords (and `%BLOCK` lines) at the start of a line, block names after `%BLOCK`, the documented values after a
 * keyword. Nothing inside a block or a comment.
 */
export function castepCompletions(doc: CastepDoc, file: CastepFile, offset: number): CastepCompletion[] {
  if (doc.blocks.some((b) => offset > b.beginSpan.end && offset <= (b.endSpan?.start ?? (b.closed ? offset - 1 : doc.text.length)))) return [];
  const lineStart = doc.text.lastIndexOf('\n', offset - 1) + 1;
  const before = doc.text.slice(lineStart, offset);
  if (commentStart(before) >= 0) return [];

  const blockWord = before.match(/^\s*%\s*(block|endblock)\s+(\S*)$/i);
  if (blockWord) {
    const used = new Set(doc.blocks.map((b) => canonicalCastepName(b.name)));
    return castepKeywordsOf(file)
      .filter((k) => k.kind === 'block' && (blockWord[1].toLowerCase() === 'endblock' || !used.has(canonicalCastepName(k.name))))
      .map((k) => ({ label: k.name.toUpperCase(), kind: 'block' as const, detail: k.doc, documentation: castepKeywordMarkdown(k), insertText: k.name.toUpperCase(), sortText: k.name.toLowerCase() }));
  }

  const value = before.match(/^\s*([^\s:=%]+)\s*(?:[:=]\s*|\s+)(\S*)$/);
  if (value) {
    const k = lookupCastepKeyword(file, value[1]);
    if (!k || k.kind === 'block') return [];
    const values = k.options.length ? k.options : k.type === 'logical' ? ['TRUE', 'FALSE'] : k.examples;
    return values.map((v, i) => ({ label: v, kind: 'value' as const, detail: v === k.default ? 'default' : undefined, insertText: v, sortText: String(i).padStart(3, '0') }));
  }
  if (!/^\s*[^\s:=]*$/.test(before)) return [];
  const set = new Set(doc.entries.map((e) => canonicalCastepName(e.keyword)));
  const setBlocks = new Set(doc.blocks.map((b) => canonicalCastepName(b.name)));
  return castepKeywordsOf(file)
    .filter((k) => (k.kind === 'block' ? !setBlocks.has(canonicalCastepName(k.name)) : !set.has(canonicalCastepName(k.name))))
    .map((k) => {
      const name = k.kind === 'block' ? k.name.toUpperCase() : k.name.toLowerCase();
      return {
        label: k.kind === 'block' ? `%BLOCK ${name}` : name,
        kind: k.kind === 'block' ? ('block' as const) : ('keyword' as const),
        detail: detailOf(k),
        documentation: castepKeywordMarkdown(k),
        insertText: k.kind === 'block' ? `%BLOCK ${name}\n  $0\n%ENDBLOCK ${name}` : k.type === 'defined' ? name : `${name} : \${1:${k.options[0] ?? k.default ?? ''}}`,
        sortText: (k.type ? '0' : '1') + k.name.toLowerCase(),
      };
    });
}
