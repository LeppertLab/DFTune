// Minimal text edits of a QE input: set or remove namelist variables without touching anything
// else, so comments, alignment and order survive (the same promise as the INCAR editor).

import { parseQe, type QeDoc, type QeEntry, type QeNamelist } from './parse';
import { cardsOf, namelistsOf, type QeProgram } from './tags';

export interface QeChange {
  /** Upper-case namelist, e.g. "SYSTEM". */
  namelist: string;
  /** Variable name (any case). */
  name: string;
  /** Array index, e.g. "1" for `starting_magnetization(1)`. */
  index?: string;
  /** The new value as written in the file (`'scf'`, `.true.`, `0.02`); null removes the variable. */
  value: string | null;
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

const splice = (text: string, s: Splice) => text.slice(0, s.start) + s.text + text.slice(s.end);

/** Applies the changes in order; each sees the result of the one before. */
export function setVariables(text: string, program: QeProgram, changes: QeChange[]): string {
  let out = text;
  for (const change of changes) out = applyChange(out, program, change);
  return out;
}

function applyChange(text: string, program: QeProgram, change: QeChange): string {
  const doc = parseQe(text, { cards: cardsOf(program) });
  const nl = doc.namelists.find((n) => n.name === change.namelist);
  const key = change.name.toLowerCase();
  const index = change.index?.trim();
  const matches = (nl?.entries ?? []).filter((e) => e.name === key && (e.index?.trim() ?? undefined) === index);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  if (change.value === null) {
    // Last to first, so earlier offsets stay valid.
    let out = text;
    for (const e of [...matches].reverse()) out = splice(out, removal(out, e));
    return out;
  }
  const label = `${change.name}${index !== undefined ? `(${index})` : ''}`;
  if (matches.length) {
    const e = matches[matches.length - 1];
    // `name =` without a value: the value goes after the equals sign.
    const empty = e.valueSpan.start === e.valueSpan.end;
    return splice(text, { start: e.valueSpan.start, end: e.valueSpan.end, text: empty ? ` ${change.value}` : change.value });
  }
  const line = `${label} = ${change.value}`;
  return nl ? splice(text, insertIntoNamelist(text, nl, line, eol)) : splice(text, createNamelist(text, doc, program, change.namelist, line, eol));
}

/** The span to cut to remove an entry: its whole line when it is alone on it, else just the entry and its comma. */
function removal(text: string, e: QeEntry): Splice {
  const lineStart = text.lastIndexOf('\n', e.span.start - 1) + 1;
  let lineEnd = text.indexOf('\n', e.span.end);
  if (lineEnd < 0) lineEnd = text.length;
  const before = text.slice(lineStart, e.span.start);
  const after = text.slice(e.span.end, lineEnd).replace(/\r$/, '');
  // Alone on its line (a trailing comma or comment belongs to it).
  if (before.trim() === '' && /^\s*,?\s*(!.*)?$/.test(after)) return { start: lineStart, end: Math.min(lineEnd + 1, text.length), text: '' };
  // The last entry of a line with others before it: cut the comma that separates it instead.
  const comma = before.match(/,\s*$/);
  if (comma && /^\s*,?\s*(!.*)?$/.test(after)) return { start: lineStart + before.length - comma[0].length, end: e.span.end + (after.match(/^\s*,?/)![0].length), text: '' };
  // Sharing the line: the entry, its comma and the spaces after it.
  const tail = after.match(/^\s*,?\s*/)![0].length;
  return { start: e.span.start, end: e.span.end + tail, text: '' };
}

/** Where and how to add `line` to an existing namelist. */
function insertIntoNamelist(text: string, nl: QeNamelist, line: string, eol: string): Splice {
  const last = nl.entries[nl.entries.length - 1];
  if (last) {
    // A new line after the line of the last entry (and the end of its value, when it continues).
    let end = text.indexOf('\n', last.span.end);
    if (end < 0) end = text.length;
    if (text[end - 1] === '\r') end -= 1;
    const lastLineStart = text.lastIndexOf('\n', last.span.start - 1) + 1;
    const lead = text.slice(lastLineStart, last.span.start);
    const indent = lead.trim() === '' ? lead : '  ';
    // Entries sharing the line of the closing slash: put the new variable before the slash instead.
    const slashLineStart = nl.closed ? text.lastIndexOf('\n', nl.span.end - 1) + 1 : -1;
    if (nl.closed && slashLineStart === text.lastIndexOf('\n', last.span.end - 1) + 1) {
      const slash = nl.span.end - 1;
      return { start: slash, end: slash, text: `${eol}${indent || '  '}${line}${eol}` };
    }
    return { start: end, end, text: `${eol}${indent || '  '}${line}` };
  }
  // Empty namelist: before the closing slash, on its own line.
  if (nl.closed) {
    const slash = nl.span.end - 1;
    const lineStart = text.lastIndexOf('\n', slash - 1) + 1;
    if (text.slice(lineStart, slash).trim() === '') return { start: lineStart, end: lineStart, text: `  ${line}${eol}` };
    return { start: slash, end: slash, text: `${eol}  ${line}${eol}` };
  }
  return { start: nl.span.end, end: nl.span.end, text: `${eol}  ${line}` };
}

/** Where and how to add a whole namelist, in the order the program reads them. */
function createNamelist(text: string, doc: QeDoc, program: QeProgram, name: string, line: string, eol: string): Splice {
  const order = namelistsOf(program);
  const rank = order.indexOf(name);
  const block = `&${name}${eol}  ${line}${eol}/${eol}`;
  const before = doc.namelists.filter((n) => order.indexOf(n.name) >= 0 && order.indexOf(n.name) < rank && n.closed);
  const prev = before.sort((a, b) => b.span.end - a.span.end)[0];
  if (prev) {
    // After the line that closes the previous namelist.
    let end = text.indexOf('\n', prev.span.end);
    end = end < 0 ? text.length : end + 1;
    return { start: end, end, text: end === text.length && !text.endsWith('\n') ? eol + block : block };
  }
  // First of its kind: before the first namelist that must follow it, else before the first card, else at the end.
  const next = doc.namelists.filter((n) => order.indexOf(n.name) > rank).sort((a, b) => a.nameSpan.start - b.nameSpan.start)[0];
  const at = next ? text.lastIndexOf('\n', next.nameSpan.start - 1) + 1 : (doc.cards[0] ? text.lastIndexOf('\n', doc.cards[0].nameSpan.start - 1) + 1 : text.length);
  return { start: at, end: at, text: at === text.length && at > 0 && !text.endsWith('\n') ? eol + block : block };
}
