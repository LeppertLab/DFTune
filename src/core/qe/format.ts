// Formats a Quantum ESPRESSO input: one variable per line inside namelists with `=` aligned,
// documented spelling of variable names, logicals as `.true.`/`.false.`, cards with their columns
// lined up and their option in braces. Values, strings and every comment are kept; the order of
// everything stays as written.
//
// Idempotent. Returns undefined for an unrecognized program or while the file has syntax errors.

import type { Span } from '../incar/parse';
import { alignColumns, joinLines, type Line } from '../lines';
import { formatBool } from '../incar/values';
import type { QeCard, QeDoc, QeEntry, QeNamelist } from './parse';
import { parseQe } from './parse';
import { cardsOf, detectProgram, lookupVar, type QeProgram } from './tags';
import { isInteger, isReal, parseLogical } from './values';

/** Trailing comments of longer lines are not used to set the comment column. */
const MAX_ALIGNED_BODY = 50;
const INDENT = '  ';

export function formatQe(text: string): string | undefined {
  const program = detectProgram(text);
  if (!program) return undefined;
  const doc = parseQe(text, { cards: cardsOf(program) });
  if (doc.issues.some((i) => i.severity === 'error')) return undefined;

  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = doc.lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (doc.lines[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const starts = new Map<number, { namelist?: QeNamelist; card?: QeCard }>();
  for (const nl of doc.namelists) starts.set(lineAt(nl.nameSpan.start), { namelist: nl });
  for (const card of doc.cards) starts.set(lineAt(card.nameSpan.start), { card });

  const out: string[] = [];
  for (let i = 0; i < doc.lines.length; i++) {
    const block = starts.get(i);
    if (block?.namelist) {
      const nl = block.namelist;
      const last = lineAt(Math.max(nl.span.end - 1, nl.nameSpan.start));
      out.push(...formatNamelist(nl, doc, program, lineAt));
      i = last;
    } else if (block?.card) {
      const card = block.card;
      out.push(...formatCard(card, doc.lines[i]));
      i += card.raw.length;
    } else {
      out.push(doc.lines[i].text.trimEnd());
    }
  }
  return joinLines(collapseBlanks(out), text);
}

/** One blank line at most in a row. */
function collapseBlanks(lines: string[]): string[] {
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === ''));
}

interface Item {
  /** Offset of the first character, for ordering. */
  start: number;
  /** Source line index of the first character. */
  line: number;
  /** A blank line directly above it in the source. */
  blankBefore: boolean;
  /** Text without comment; for a standalone comment the comment itself. */
  body: string;
  standalone: boolean;
  comment?: string;
}

function formatNamelist(nl: QeNamelist, doc: QeDoc, program: QeProgram, lineAt: (o: number) => number): string[] {
  const headerLine = lineAt(nl.nameSpan.start);
  const lastLine = lineAt(Math.max(nl.span.end - 1, nl.nameSpan.start));
  const range: Span = { start: doc.lines[headerLine].start, end: doc.lines[lastLine].end };
  const text = doc.text;

  // Entries, as `name = value`.
  const entries = nl.entries.map((e) => ({ e, name: entryName(e, nl, program, text), value: entryValue(e, nl, program) }));
  const width = Math.max(0, ...entries.map((x) => x.name.length));
  const items: Item[] = entries.map(({ e, name, value }) => ({
    start: e.keySpan.start,
    line: lineAt(e.keySpan.start),
    blankBefore: isBlank(doc.lines[lineAt(e.keySpan.start) - 1]),
    body: value ? `${name.padEnd(width)} = ${value}` : `${name.padEnd(width)} =`,
    standalone: false,
  }));

  // Comments: after something on the same line → trailing; alone on a line → a line of its own.
  let headerComment: string | undefined;
  for (const c of doc.comments) {
    if (c.start < range.start || c.start > range.end) continue;
    const line = doc.lines[lineAt(c.start)];
    const commentText = text.slice(c.start, c.end).trimEnd();
    const before = text.slice(line.start, c.start).trim();
    if (before === '') {
      items.push({ start: c.start, line: line.n, blankBefore: isBlank(doc.lines[line.n - 1]), body: commentText, standalone: true });
      continue;
    }
    // Trailing: the entry that starts last before the comment (its value may continue from a line above).
    const owner = items.filter((it) => !it.standalone && it.start < c.start).sort((a, b) => b.start - a.start)[0];
    if (owner && line.n >= owner.line && owner.start >= range.start) owner.comment = commentText;
    else headerComment = commentText;
  }
  items.sort((a, b) => a.start - b.start);

  // Align trailing comments.
  const commented = items.filter((it) => it.comment && !it.standalone);
  const bodies = commented.map((it) => it.body.length).filter((n) => n <= MAX_ALIGNED_BODY);
  const commentColumn = bodies.length ? Math.max(...bodies) : 0;

  const out = [`&${nl.name}${headerComment ? `  ${headerComment}` : ''}`];
  for (const it of items) {
    if (it.blankBefore && out[out.length - 1] !== '' && out.length > 1) out.push('');
    if (it.standalone) out.push(`${INDENT}${it.body}`);
    else out.push(`${INDENT}${it.comment ? `${it.body.padEnd(commentColumn)}  ${it.comment}` : it.body}`);
  }
  // The closing line keeps whatever follows the slash (usually nothing, or a comment).
  const closeLine = doc.lines[lastLine];
  const slash = Math.max(nl.span.end - closeLine.start, 1);
  const after = nl.closed ? closeLine.text.slice(slash).trim() : '';
  out.push(`/${after ? `  ${after}` : ''}`);
  return out;
}

const isBlank = (l: Line | undefined) => l !== undefined && l.text.trim() === '';

/** The variable name with its documented capitalization; unknown names stay as written. */
function entryName(e: QeEntry, nl: QeNamelist, program: QeProgram, text: string): string {
  const known = lookupVar(program, nl.name, e.name);
  if (!known) return text.slice(e.keySpan.start, e.keySpan.end);
  return `${known.name}${e.index !== undefined ? `(${e.index.replace(/\s+/g, '')})` : ''}`;
}

function entryValue(e: QeEntry, nl: QeNamelist, program: QeProgram): string {
  const known = lookupVar(program, nl.name, e.name);
  const items = e.items.map((t) => t.text);
  if (known?.type === 'logical' && items.length === 1) {
    const b = parseLogical(items[0]);
    if (b !== undefined) return formatBool(b).toLowerCase();
  }
  return items.join(' ');
}

// ---------------------------------------------------------------------------------------------

interface Row {
  kind: 'blank' | 'comment' | 'data';
  line: Line;
  /** The data without its trailing comment, split into tokens. */
  tokens: string[];
  comment?: string;
}

function formatCard(card: QeCard, headerLine: Line): string[] {
  const comment = headerLine.text.match(/[!#].*$/)?.[0].trimEnd();
  const out = [`${card.name}${card.option ? ` {${card.option}}` : ''}${comment ? `  ${comment}` : ''}`];

  const rows: Row[] = card.raw.map((line) => {
    const t = line.text.trim();
    if (t === '') return { kind: 'blank', line, tokens: [] };
    if (t[0] === '!' || t[0] === '#') return { kind: 'comment', line, tokens: [t] };
    const bang = line.text.indexOf('!');
    const data = (bang < 0 ? line.text : line.text.slice(0, bang)).trim();
    return { kind: 'data', line, tokens: data.split(/\s+/), comment: bang < 0 ? undefined : line.text.slice(bang).trimEnd() };
  });

  const data = rows.filter((r) => r.kind === 'data');
  const cells = dataCells(card, data);
  let d = 0;
  // Trailing comments line up across the data lines.
  const commentColumn = Math.max(0, ...data.map((r, i) => (r.comment && cells[i].length <= MAX_ALIGNED_BODY ? cells[i].length : 0)));
  for (const row of rows) {
    if (row.kind === 'blank') out.push('');
    else if (row.kind === 'comment') out.push(`${INDENT}${row.tokens[0]}`);
    else {
      const body = cells[d++];
      out.push(`${INDENT}${row.comment ? `${body.padEnd(commentColumn)}  ${row.comment}` : body}`);
    }
  }
  return out;
}

/** The formatted text of each data line of a card (without indentation and comment). */
function dataCells(card: QeCard, data: Row[]): string[] {
  const tokens = data.map((r) => r.tokens);
  const real = (t: string[], from: number, n: number) => t.length >= from + n && t.slice(from, from + n).every(isReal);
  switch (card.name) {
    case 'ATOMIC_SPECIES':
      return align(tokens, (t) => t.length >= 3 && isReal(t[1]), ['left', 'num', 'left']);
    case 'ATOMIC_POSITIONS':
      // label x y z [if_pos × 3]; Wyckoff lines (crystal_sg) stay as they are.
      return align(tokens, (t) => (t.length === 4 || t.length === 7) && real(t, 1, 3), ['left', 'num', 'num', 'num', 'num', 'num', 'num']);
    case 'CELL_PARAMETERS':
      return align(tokens, (t) => t.length === 3 && real(t, 0, 3), ['num', 'num', 'num']);
    case 'K_POINTS': {
      const type = card.option ?? 'tpiba';
      if (type === 'gamma') return tokens.map((t) => t.join(' '));
      if (type === 'automatic') return tokens.map((t) => t.join(' '));
      // First line: the count; then x y z weight, or `label nk` on band paths.
      const head = tokens.slice(0, 1).map((t) => t.join(' '));
      const points = align(tokens.slice(1), (t) => t.length === 4 && real(t, 0, 4), ['num', 'num', 'num', 'num']);
      const labelled = align(tokens.slice(1), (t) => t.length === 2 && !isReal(t[0]) && isInteger(t[1]), ['left', 'num']);
      return [...head, ...tokens.slice(1).map((t, i) => (real(t, 0, 4) && t.length === 4 ? points[i] : t.length === 2 && !isReal(t[0]) && isInteger(t[1]) ? labelled[i] : t.join(' ')))];
    }
    default:
      return tokens.map((t) => t.join(' '));
  }
}

/** Aligns the rows that `fits`; any other row is just its tokens, single-spaced. */
function align(rows: string[][], fits: (t: string[]) => boolean, kinds: ('num' | 'left')[]): string[] {
  const idx = rows.map((t, i) => (fits(t) ? i : -1)).filter((i) => i >= 0);
  const aligned = alignColumns(idx.map((i) => rows[i]), kinds);
  const byRow = new Map(idx.map((i, k) => [i, aligned[k]]));
  return rows.map((t, i) => byRow.get(i) ?? t.join(' '));
}
