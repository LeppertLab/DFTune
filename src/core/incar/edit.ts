// Text edits on an INCAR that touch as little of the file as possible.

import { parseIncar, type Entry, type Span } from './parse';

/** Tag name → new raw value, or null to remove the tag. */
export type TagChanges = Record<string, string | null>;

export function setTags(text: string, changes: TagChanges): string {
  let out = text;
  for (const [key, value] of Object.entries(changes)) {
    out = value === null ? removeTag(out, key) : setTag(out, key, value);
  }
  return out;
}

/** Replaces the value of the first occurrence of `key`, or appends `KEY = value`. */
export function setTag(text: string, key: string, value: string): string {
  const K = key.toUpperCase();
  const entry = parseIncar(text).tags.get(K);
  if (entry) {
    const { start, end } = entry.valueSpan;
    if (text.slice(start, end) === value) return text;
    const pad = start === end && text[start - 1] === '=' ? ' ' : '';
    return splice(text, entry.valueSpan, pad + value);
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const sep = text.length === 0 || text.endsWith('\n') ? '' : eol;
  return `${text}${sep}${K} = ${value}${eol}`;
}

/** Removes every occurrence of `key`. A line left with nothing but a comment is dropped too. */
export function removeTag(text: string, key: string): string {
  const K = key.toUpperCase();
  const entries = parseIncar(text).entries.filter((e) => e.key === K);
  let out = text;
  for (const entry of entries.reverse()) out = removeEntry(out, entry);
  return out;
}

function removeEntry(text: string, e: Entry): string {
  const lineStart = text.lastIndexOf('\n', e.span.start - 1) + 1;
  let lineEnd = text.indexOf('\n', e.span.end);
  if (lineEnd < 0) lineEnd = text.length;
  const before = text.slice(lineStart, e.span.start);
  const after = text.slice(e.span.end, lineEnd);

  // Alone on its line (possibly with a trailing comment about it): drop the whole line.
  if (/^[\s;]*$/.test(before) && /^[\s;]*([!#].*)?$/.test(after)) {
    const end = lineEnd < text.length ? lineEnd + 1 : lineEnd;
    let start = lineStart;
    // Last line without a newline: eat the previous line break instead.
    if (end === text.length && lineEnd === text.length && start > 0) start--;
    if (start > 0 && text[start - 1] === '\r' && end === text.length) start--;
    return text.slice(0, start) + text.slice(end);
  }

  // Shares the line with other statements: remove it together with one separator.
  const next = after.match(/^\s*;\s*/);
  if (next) return text.slice(0, e.span.start) + text.slice(e.span.end + next[0].length);
  const prevSemi = before.lastIndexOf(';');
  if (prevSemi >= 0) {
    let start = lineStart + prevSemi;
    while (start > lineStart && /[ \t]/.test(text[start - 1])) start--;
    return text.slice(0, start) + text.slice(e.span.end);
  }
  return text.slice(0, e.span.start) + text.slice(e.span.end);
}

function splice(text: string, span: Span, insert: string): string {
  return text.slice(0, span.start) + insert + text.slice(span.end);
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Smallest single replacement that turns `before` into `after`, or undefined if equal. */
export function minimalEdit(before: string, after: string): TextEdit | undefined {
  if (before === after) return undefined;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  return { start, end: endB, text: after.slice(start, endA) };
}
