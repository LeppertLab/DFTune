// Lossless INCAR parser.
//
// The parser never rebuilds text: it records where every statement, key and value sits in
// the original string. Edits (see edit.ts) splice the original text, so comments, alignment,
// tag order and tags we know nothing about all survive a round trip through the GUI.
//
// INCAR syntax handled here:
//   TAG = value                 one statement per line
//   A = 1 ; B = 2               several statements on one line
//   ! comment   # comment       comments, anywhere on a line
//   MAGMOM = 1 1 1 \            line continuation with a trailing backslash
//            -1 -1 -1
//   SYSTEM = "a quoted value"   quoted values may span lines

export interface Span {
  start: number;
  end: number;
}

export interface Entry {
  /** Upper-cased tag name, as VASP treats tags case-insensitively. */
  key: string;
  /** Value with continuations collapsed and surrounding quotes removed. */
  value: string;
  keySpan: Span;
  /** Exact source range of the value. Empty (start === end) for `TAG =`. */
  valueSpan: Span;
  /** From the first character of the key to the last character of the value. */
  span: Span;
  /** Zero-based line of the key. */
  line: number;
}

export interface ParseIssue {
  message: string;
  span: Span;
}

export interface IncarDoc {
  text: string;
  /** All statements, in file order, including duplicates. */
  entries: Entry[];
  issues: ParseIssue[];
  comments: Span[];
  /** First occurrence of each tag. */
  tags: Map<string, Entry>;
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export function parseIncar(text: string): IncarDoc {
  const entries: Entry[] = [];
  const issues: ParseIssue[] = [];
  const comments: Span[] = [];
  const lineStarts = computeLineStarts(text);
  const n = text.length;

  let stmtStart = 0;
  let inQuote = false;

  const flush = (end: number) => {
    const span = trimSpan(text, stmtStart, end);
    if (span.start === span.end) return;
    const eq = text.indexOf('=', span.start);
    if (eq < 0 || eq >= span.end) {
      issues.push({ message: "Expected 'TAG = value'", span });
      return;
    }
    const keySpan = trimSpan(text, span.start, eq);
    const rawKey = text.slice(keySpan.start, keySpan.end);
    if (!TAG_NAME.test(rawKey)) {
      issues.push({
        message: rawKey ? `'${rawKey}' is not a valid tag name` : 'Missing tag name before =',
        span: keySpan.start === keySpan.end ? span : keySpan,
      });
      return;
    }
    let valueSpan = trimSpan(text, eq + 1, span.end);
    if (valueSpan.start === valueSpan.end) valueSpan = { start: eq + 1, end: eq + 1 };
    entries.push({
      key: rawKey.toUpperCase(),
      value: cleanValue(text.slice(valueSpan.start, valueSpan.end)),
      keySpan,
      valueSpan,
      span: { start: keySpan.start, end: Math.max(valueSpan.end, eq + 1) },
      line: lineOf(lineStarts, keySpan.start),
    });
  };

  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') inQuote = false;
      continue;
    }
    if (c === '"') {
      inQuote = true;
    } else if (c === '!' || c === '#') {
      flush(i);
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      comments.push(trimSpan(text, i, j));
      stmtStart = j;
      i = j - 1;
    } else if (c === ';') {
      flush(i);
      stmtStart = i + 1;
    } else if (c === '\\') {
      // A backslash followed only by whitespace up to the line end continues the statement.
      let k = i + 1;
      while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r')) k++;
      if (k >= n || text[k] === '\n') i = k;
    } else if (c === '\n') {
      flush(i);
      stmtStart = i + 1;
    }
  }
  if (inQuote) {
    issues.push({ message: 'Unterminated quote', span: trimSpan(text, stmtStart, n) });
  }
  flush(n);

  const tags = new Map<string, Entry>();
  for (const e of entries) if (!tags.has(e.key)) tags.set(e.key, e);
  return { text, entries, issues, comments, tags };
}

function cleanValue(raw: string): string {
  let v = raw.replace(/\\[ \t\r]*\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

function trimSpan(text: string, start: number, end: number): Span {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Statement containing `offset`, if any (inclusive of the end, for cursor positions). */
export function entryAt(doc: IncarDoc, offset: number): Entry | undefined {
  return doc.entries.find((e) => e.span.start <= offset && offset <= e.span.end);
}
