// Parser for Quantum ESPRESSO input files: Fortran namelists followed by cards.
//
//   &CONTROL
//     calculation = 'scf', prefix = 'si'      one or more `name = value` per line, commas optional
//     celldm(1) = 10.2                        array elements: name(index) = value
//   /                                         ends the namelist (`&END` also works)
//   ATOMIC_SPECIES                            cards: a keyword line (+ option), then data lines
//     Si 28.086 Si.pbe-n-rrkjus_psl.1.0.0.UPF
//   K_POINTS {automatic}
//     4 4 4 0 0 0
//
// Like the INCAR parser it records where everything sits in the original text (spans) and never
// rebuilds it. Syntax problems are reported the way QE would trip over them.

import type { Span } from '../incar/parse';
import { lineSpan, splitLines, type Line, type Token } from '../lines';
import type { Diagnostic } from '../validation/rules';

export interface QeEntry {
  /** Upper-case name of the namelist the entry is in. */
  namelist: string;
  /** Variable name, lower case, without index: "celldm" for `celldm(1)`. */
  name: string;
  /** Text inside the parentheses of `name(index)`, if any. */
  index?: string;
  keySpan: Span;
  /** Value as written, without trailing commas; empty (start === end) when missing. */
  value: string;
  valueSpan: Span;
  /** The value's items (commas and comments dropped), with their positions. */
  items: Token[];
  /** From the key to the end of the value. */
  span: Span;
}

export interface QeNamelist {
  /** Upper-case name without the `&`. */
  name: string;
  /** The `&NAME` text. */
  nameSpan: Span;
  entries: QeEntry[];
  /** Ended with `/` or `&END` (not by the next namelist/card or the end of the file). */
  closed: boolean;
  /** From `&` to the closing `/`, or to the last token. */
  span: Span;
}

export interface QeCard {
  /** Upper-case card name. */
  name: string;
  nameSpan: Span;
  /** Lower-case option, e.g. "automatic" or "angstrom"; undefined when none is given. */
  option?: string;
  optionSpan?: Span;
  /** The data lines of the card after its keyword line (comments stripped; comment-only and blank lines are not included). */
  lines: Line[];
  /** Every line after the keyword line up to the end of the card, comments and blank lines included, unmodified. */
  raw: Line[];
  span: Span;
}

export interface QeDoc {
  text: string;
  namelists: QeNamelist[];
  cards: QeCard[];
  /** Text lines outside namelists and cards (the title line of ph.x, q-point lists, …). */
  loose: Line[];
  /** Every line of the file. */
  lines: Line[];
  /** `!` comments inside namelists (from the `!` to the end of the line). */
  comments: Span[];
  issues: Diagnostic[];
}

export interface QeParseOptions {
  /** Upper-case names of the cards the program reads; a line starting with one begins a card. */
  cards?: readonly string[];
}

interface Tok {
  kind: 'word' | 'str' | 'eq' | 'comma' | 'end';
  text: string;
  start: number;
  end: number;
}

const NAMELIST_START = /^\s*&\s*([A-Za-z_]\w*)/;

export function parseQe(text: string, options: QeParseOptions = {}): QeDoc {
  const cardNames = new Set(options.cards ?? []);
  const lines = splitLines<'text'>(text, 'text');
  const doc: QeDoc = { text, namelists: [], cards: [], loose: [], lines, comments: [], issues: [] };
  const issue = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => doc.issues.push({ severity, code, message, span });

  let current: { nl: QeNamelist; tokens: Tok[] } | undefined;
  let card: QeCard | undefined;

  const finishNamelist = (closed: boolean, endAt: number) => {
    if (!current) return;
    current.nl.closed = closed;
    current.nl.span.end = endAt;
    buildEntries(current.nl, current.tokens, text, issue);
    if (!closed) issue('error', 'qe-unterminated', `Namelist &${current.nl.name} is not closed: end it with a line containing only "/".`, current.nl.nameSpan);
    current = undefined;
  };

  for (const line of lines) {
    // A namelist or card keyword at the start of a line ends an unterminated namelist.
    const start = line.text.match(NAMELIST_START);
    const startsNamelist = !!start && start[1].toUpperCase() !== 'END';
    const keyword = cardKeyword(line, cardNames);

    if (current && (startsNamelist || keyword)) finishNamelist(false, current.tokens.length ? current.tokens[current.tokens.length - 1].end : current.nl.span.end);

    if (current) {
      if (scanLine(line, 0, current.tokens, doc.comments, issue)) finishNamelist(true, current.tokens[current.tokens.length - 1].end);
      continue;
    }

    const trimmed = line.text.trim();
    if (card && !startsNamelist && !keyword) card.raw.push(line);
    if (trimmed === '' || trimmed[0] === '!' || trimmed[0] === '#') continue;

    if (startsNamelist) {
      card = undefined;
      const name = start![1];
      const nameStart = line.start + line.text.indexOf('&');
      const nameEnd = line.start + line.text.indexOf(start![1], line.text.indexOf('&')) + name.length;
      const nl: QeNamelist = { name: name.toUpperCase(), nameSpan: { start: nameStart, end: nameEnd }, entries: [], closed: false, span: { start: nameStart, end: nameEnd } };
      doc.namelists.push(nl);
      current = { nl, tokens: [] };
      if (scanLine(line, nameEnd - line.start, current.tokens, doc.comments, issue)) finishNamelist(true, current.tokens[current.tokens.length - 1].end);
      continue;
    }

    if (keyword) {
      card = { name: keyword.name, nameSpan: keyword.nameSpan, option: keyword.option, optionSpan: keyword.optionSpan, lines: [], raw: [], span: lineSpan(line) };
      doc.cards.push(card);
      continue;
    }

    // Data of the current card (comments after `!` do not count), or a loose line.
    const data = stripComment(line);
    if (card) {
      card.lines.push(data);
      card.span.end = line.end;
    } else {
      doc.loose.push(data);
    }
  }
  if (current) finishNamelist(false, current.tokens.length ? current.tokens[current.tokens.length - 1].end : current.nl.span.end);
  return doc;
}

/** The line without a trailing `!` comment (tokens re-cut); the offsets stay those of the file. */
function stripComment(line: Line<'text'>): Line<'text'> {
  const bang = line.text.indexOf('!');
  if (bang < 0) return line;
  const text = line.text.slice(0, bang);
  return { ...line, text, end: line.start + bang, tokens: line.tokens.filter((t) => t.end <= line.start + bang) };
}

/** `ATOMIC_POSITIONS (bohr)`, `K_POINTS {automatic}`, `K_POINTS automatic` → name and option. */
function cardKeyword(line: Line, cards: ReadonlySet<string>): { name: string; nameSpan: Span; option?: string; optionSpan?: Span } | undefined {
  const m = line.text.match(/^(\s*)([A-Za-z_]+)\s*(?:[({]\s*)?([A-Za-z_0-9-]*)\s*[)}]?\s*(?:[!#].*)?$/);
  if (!m || !cards.has(m[2].toUpperCase())) return undefined;
  const nameStart = line.start + m[1].length;
  const result: ReturnType<typeof cardKeyword> = { name: m[2].toUpperCase(), nameSpan: { start: nameStart, end: nameStart + m[2].length } };
  if (m[3]) {
    const at = line.text.indexOf(m[3], m[1].length + m[2].length);
    result.option = m[3].toLowerCase();
    result.optionSpan = { start: line.start + at, end: line.start + at + m[3].length };
  }
  return result;
}

/**
 * Tokenizes one line of a namelist body, from column `from`, appending to `tokens`. Returns true
 * when the namelist ends on this line (a `/` or `&END` outside a string); the rest is ignored.
 */
function scanLine(line: Line, from: number, tokens: Tok[], comments: Span[], issue: (s: Diagnostic['severity'], code: string, message: string, span: Span) => void): boolean {
  const t = line.text;
  let i = from;
  const at = (k: number) => line.start + k;
  while (i < t.length) {
    const c = t[i];
    if (c === ' ' || c === '\t') {
      i++;
    } else if (c === '!') {
      comments.push({ start: at(i), end: line.end });
      return false; // comment to the end of the line
    } else if (c === '/') {
      tokens.push({ kind: 'end', text: '/', start: at(i), end: at(i + 1) });
      return true;
    } else if (c === '=') {
      tokens.push({ kind: 'eq', text: '=', start: at(i), end: at(i + 1) });
      i++;
    } else if (c === ',') {
      tokens.push({ kind: 'comma', text: ',', start: at(i), end: at(i + 1) });
      i++;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      // A doubled quote inside the string is an escaped quote.
      while (j < t.length && (t[j] !== c || t[j + 1] === c)) j += t[j] === c ? 2 : 1;
      if (j >= t.length) issue('error', 'qe-string', 'Unterminated string: the closing quote is missing on this line.', { start: at(i), end: at(t.length) });
      const end = Math.min(j + 1, t.length);
      tokens.push({ kind: 'str', text: t.slice(i, end), start: at(i), end: at(end) });
      i = end;
    } else {
      let j = i;
      while (j < t.length && !' \t=,/!\'"'.includes(t[j])) {
        if (t[j] === '(') {
          // Index list: commas and spaces inside stay part of the word.
          const close = t.indexOf(')', j);
          j = close < 0 ? t.length : close + 1;
        } else j++;
      }
      if (j === i) j = i + 1;
      const word = t.slice(i, j);
      if (/^&end$/i.test(word)) {
        tokens.push({ kind: 'end', text: word, start: at(i), end: at(j) });
        return true;
      }
      tokens.push({ kind: 'word', text: word, start: at(i), end: at(j) });
      i = j;
    }
  }
  return false;
}

/** `name = value` entries from the tokens of a namelist body. */
function buildEntries(nl: QeNamelist, tokens: Tok[], text: string, issue: (s: Diagnostic['severity'], code: string, message: string, span: Span) => void) {
  const body = tokens.filter((t) => t.kind !== 'end');
  const isKey = (k: number) => body[k]?.kind === 'word' && body[k + 1]?.kind === 'eq';
  let i = 0;
  while (i < body.length) {
    const t = body[i];
    if (!isKey(i)) {
      if (t.kind !== 'comma') issue('error', 'qe-syntax', `Expected "variable = value", found "${t.text}".`, t);
      i++;
      continue;
    }
    let j = i + 2;
    while (j < body.length && !isKey(j)) j++;
    const valueTokens = body.slice(i + 2, j);
    while (valueTokens.length && valueTokens[valueTokens.length - 1].kind === 'comma') valueTokens.pop();
    const stray = valueTokens.find((v) => v.kind === 'eq');
    if (stray) issue('error', 'qe-syntax', 'Unexpected "=": is a comma missing between values?', stray);
    const eq = body[i + 1];
    const valueSpan: Span = valueTokens.length ? { start: valueTokens[0].start, end: valueTokens[valueTokens.length - 1].end } : { start: eq.end, end: eq.end };
    const m = t.text.match(/^([^(]*)\(\s*(.*?)\s*\)$/);
    const entry: QeEntry = {
      namelist: nl.name,
      name: (m ? m[1] : t.text).toLowerCase(),
      keySpan: { start: t.start, end: t.end },
      value: text.slice(valueSpan.start, valueSpan.end),
      items: valueTokens.filter((v) => v.kind !== 'comma').map((v) => ({ text: v.text, start: v.start, end: v.end })),
      valueSpan,
      span: { start: t.start, end: valueSpan.end },
    };
    if (m) entry.index = m[2];
    nl.entries.push(entry);
    i = j;
  }
}

export type { Token };
