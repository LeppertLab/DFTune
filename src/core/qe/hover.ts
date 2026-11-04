// Hover text and completions for QE inputs, independent of VS Code.

import type { QeDoc } from './parse';
import { speciesRows, type PseudoFile, type QeContext } from './pseudos';
import { cardsOf, lookupVar, namelistsOf, varsOf, qeDocsUrl, type QeProgram, type QeVar } from './tags';

/** Markdown describing a variable. `current` highlights the option in use. */
export function varMarkdown(v: QeVar, program: QeProgram, current?: string): string {
  const parts = [`**${v.name}**${v.dim ? `(${v.dim.replace(':', '…')})` : ''} · &${v.namelist}`];
  if (v.summary) parts.push(v.summary);
  const facts = [v.type ? `type: \`${v.type}\`` : '', v.default ? `default: \`${v.default}\`` : '', v.required ? 'required' : ''].filter(Boolean);
  if (facts.length) parts.push(facts.join(' · '));
  if (v.options.length) {
    const cur = current?.replace(/^['"]|['"]$/g, '').toLowerCase();
    parts.push(
      v.options
        .map((o) => {
          const label = cur !== undefined && o.value.toLowerCase() === cur ? `**\`${o.value}\`**` : `\`${o.value}\``;
          return `- ${label}${o.note ? ` ${o.note}` : ''}`;
        })
        .join('\n'),
    );
  }
  parts.push(`[Quantum ESPRESSO documentation](${qeDocsUrl(program)})`);
  return parts.join('\n\n');
}

/** Markdown describing a pseudopotential file as found (or not) by the lookup. */
export function pseudoMarkdown(file: string, found: PseudoFile): string {
  if (found.status === 'missing') return `**${file}**: not found in \`${found.dir}\``;
  const i = found.info;
  if (found.status === 'unreadable' || !i) return `**${file}**: found, but not a UPF file, so element and functional are not read.`;
  const facts = [
    i.element && `element: **${i.element}**`,
    i.type && `type: ${{ NC: 'norm-conserving', US: 'ultrasoft', PAW: 'PAW' }[i.type] ?? i.type}`,
    i.functional && `functional: ${i.functional}`,
    i.zValence !== undefined && `valence electrons: ${i.zValence}`,
    i.coreCorrection !== undefined && `nonlinear core correction: ${i.coreCorrection ? 'yes' : 'no'}`,
    i.spinOrbit && 'spin–orbit: yes',
  ].filter(Boolean);
  const cutoffs = i.suggestedEcutwfc || i.suggestedEcutrho ? `\n\nSuggested minimum cutoffs: ecutwfc ${i.suggestedEcutwfc ?? '?'} Ry, ecutrho ${i.suggestedEcutrho ?? '?'} Ry` : '';
  return `**${file}** (${i.format.toUpperCase()}) in \`${found.dir}\`\n\n${facts.join(' · ')}${cutoffs}`;
}

/** The hover for the variable name under `offset`, or for the pseudopotential on an ATOMIC_SPECIES line. */
export function qeHover(doc: QeDoc, program: QeProgram, offset: number, ctx: QeContext = {}): { markdown: string; start: number; end: number } | undefined {
  for (const nl of doc.namelists) {
    for (const e of nl.entries) {
      if (offset < e.keySpan.start || offset > e.keySpan.end) continue;
      const v = lookupVar(program, nl.name, e.name);
      return v && { markdown: varMarkdown(v, program, e.value), start: e.keySpan.start, end: e.keySpan.end };
    }
  }
  if (program === 'pw') {
    for (const row of speciesRows(doc)) {
      if (offset < row.lineSpan.start || offset > row.lineSpan.end) continue;
      const found = ctx.pseudos?.get(row.file);
      return found && { markdown: pseudoMarkdown(row.file, found), start: row.lineSpan.start, end: row.lineSpan.end };
    }
  }
  return undefined;
}

export interface QeCompletion {
  label: string;
  kind: 'variable' | 'value' | 'namelist' | 'card';
  detail?: string;
  documentation?: string;
  insertText: string;
  /** Sort key: variables not set yet first. */
  sortText: string;
}

/** Completions at `offset`: values after `name =`, variable names inside a namelist, namelists and cards between them. */
export function qeCompletions(doc: QeDoc, program: QeProgram, offset: number): QeCompletion[] {
  const text = doc.text;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  if (/[!#]/.test(before.replace(/'[^']*'|"[^"]*"/g, ''))) return [];

  const nl = doc.namelists.find((n) => offset > n.nameSpan.end && (offset <= n.span.end || !n.closed) && !(n.closed && offset > n.span.end));
  if (!nl) {
    // Between namelists and cards: offer what can start a line.
    if (!/^\s*&?\w*$/.test(before)) return [];
    const amp = before.trimStart().startsWith('&');
    return [
      ...namelistsOf(program).map((n) => ({ label: `&${n}`, kind: 'namelist' as const, insertText: amp ? n : `&${n}\n  $0\n/`, sortText: '0' + n })),
      ...cardsOf(program).map((c) => ({ label: c, kind: 'card' as const, insertText: c, sortText: '1' + c })),
    ];
  }

  // Value position: `name = <here>`.
  const assign = before.match(/([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*=\s*([^=,]*)$/);
  if (assign) {
    const v = lookupVar(program, nl.name, assign[1]);
    if (!v) return [];
    if (v.type === 'logical') return ['.true.', '.false.'].map((value, i) => ({ label: value, kind: 'value' as const, insertText: value, sortText: String(i) }));
    return [...new Map(v.options.map((o) => [o.value, o])).values()].map((o, i) => ({
      label: o.value,
      kind: 'value' as const,
      detail: o.note,
      insertText: v.type === 'character' ? `'${o.value}'` : o.value,
      sortText: String(i).padStart(3, '0'),
    }));
  }

  // Variable names not set yet (array variables stay available).
  if (!/^[\s,]*[A-Za-z0-9_]*$/.test(before.replace(/^.*[,;]/, ''))) return [];
  const set = new Set(nl.entries.map((e) => e.name));
  return varsOf(program, nl.name)
    .filter((v) => v.dim || !set.has(v.name.toLowerCase()))
    .map((v) => ({
      label: v.name,
      kind: 'variable' as const,
      detail: [v.type, v.default && `default ${v.default}`].filter(Boolean).join(' · '),
      documentation: varMarkdown(v, program),
      insertText: `${v.name}${v.dim ? '(${1:1})' : ''} = `,
      sortText: (v.required ? '0' : '1') + v.name.toLowerCase(),
    }));
}
