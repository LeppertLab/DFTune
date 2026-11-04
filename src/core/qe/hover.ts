// Hover text and completions for QE inputs, independent of VS Code.

import type { QeDoc } from './parse';
import { assessGrid } from './kpoints';
import { speciesRows, type PseudoFile, type QeContext } from './pseudos';
import { describeCell, qeCell } from './structure';
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
    const cellHover = hoverCell(doc, offset);
    if (cellHover) return cellHover;
    const gridHover = hoverGrid(doc, offset);
    if (gridHover) return gridHover;
    for (const row of speciesRows(doc)) {
      if (offset < row.lineSpan.start || offset > row.lineSpan.end) continue;
      const found = ctx.pseudos?.get(row.file);
      return found && { markdown: pseudoMarkdown(row.file, found), start: row.lineSpan.start, end: row.lineSpan.end };
    }
  }
  return undefined;
}

type HoverResult = { markdown: string; start: number; end: number };

const CELL_VARIABLES = new Set(['ibrav', 'celldm', 'a', 'b', 'c', 'cosab', 'cosac', 'cosbc']);

/** The cell on hover over the value of ibrav, celldm, A, B, C…, or the CELL_PARAMETERS keyword. */
function hoverCell(doc: QeDoc, offset: number): HoverResult | undefined {
  const system = doc.namelists.find((n) => n.name === 'SYSTEM');
  const entry = system?.entries.find((e) => CELL_VARIABLES.has(e.name) && offset >= e.valueSpan.start && offset <= e.valueSpan.end && e.valueSpan.end > e.valueSpan.start);
  const card = doc.cards.find((c) => c.name === 'CELL_PARAMETERS' && offset >= c.nameSpan.start && offset <= c.nameSpan.end);
  const span = entry?.valueSpan ?? card?.nameSpan;
  if (!span) return undefined;
  const cell = qeCell(doc);
  if (!cell) return undefined;
  const markdown = 'error' in cell ? `**Cell**: cannot be built: ${cell.error}` : `**Cell** · ${describeCell(cell.lattice, cell.volume)}`;
  return { markdown, start: span.start, end: span.end };
}

/** The grid of K_POINTS {automatic}: number of points and spacing. */
function hoverGrid(doc: QeDoc, offset: number): HoverResult | undefined {
  const card = doc.cards.find((c) => c.name === 'K_POINTS' && c.option === 'automatic');
  const row = card?.lines.find((l) => l.text.trim());
  if (!row || offset < row.start || offset > row.end || row.tokens.length < 6) return undefined;
  const n = row.tokens.slice(0, 6).map((t) => Number(t.text));
  if (!n.every(Number.isInteger) || n.slice(0, 3).some((x) => x <= 0)) return undefined;
  const total = n[0] * n[1] * n[2];
  const shifted = n.slice(3).some((x) => x !== 0);
  let text = `**${shifted ? 'Shifted' : 'Γ-centred'} ${n[0]} × ${n[1]} × ${n[2]} grid**: ${total} k points before symmetry reduction.`;
  const cell = qeCell(doc);
  if (cell && !('error' in cell)) {
    const { spacing } = assessGrid(cell, n.slice(0, 3) as [number, number, number], n.slice(3) as [number, number, number]);
    text += `\n\nSpacing ${spacing.map((x) => Number(x.toFixed(3))).join(' × ')} Å⁻¹ along b1 × b2 × b3 (2π included).`;
  }
  return { markdown: text, start: row.start, end: row.end };
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

  // The namelist the cursor is in: up to its closing slash, or for an unclosed one up to the next namelist or card.
  const starts = [...doc.namelists.map((n) => n.nameSpan.start), ...doc.cards.map((c) => c.nameSpan.start)];
  const nl = doc.namelists.find((n) => {
    if (offset <= n.nameSpan.end) return false;
    const bound = n.closed ? n.span.end : Math.min(...starts.filter((s) => s > n.nameSpan.start), Infinity);
    return offset <= bound;
  });
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
