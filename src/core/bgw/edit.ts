// Edits of a BerkeleyGW keyword input for the builder: set, flag or remove a keyword, set or remove
// a block. Lines the change does not touch stay as they are (comments included).

import { parseBgw } from './parse';

export type BgwChange =
  /** `value` null removes the keyword; '' writes it as a flag; else `keyword value`. */
  | { keyword: string; value: string | null }
  /** `rows` null removes the block; else its rows (blank lines are dropped: BerkeleyGW reads them as data). */
  | { block: string; rows: string[] | null };

export function setBgwKeywords(text: string, changes: BgwChange[]): string {
  let out = text;
  for (const change of changes) out = 'keyword' in change ? setKeyword(out, change.keyword, change.value) : setBlock(out, change.block, change.rows);
  return out;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** The text with [start, end) replaced. */
const splice = (text: string, start: number, end: number, insert: string) => text.slice(0, start) + insert + text.slice(end);

/** End of the line break that follows offset `end` (the offset itself when the file ends there). */
function afterBreak(text: string, end: number) {
  if (text[end] === '\r' && text[end + 1] === '\n') return end + 2;
  return text[end] === '\n' ? end + 1 : end;
}

function setKeyword(text: string, keyword: string, value: string | null): string {
  const doc = parseBgw(text);
  const mine = doc.entries.filter((e) => e.keyword === keyword);
  if (value === null) {
    // Last to first, so the offsets of the earlier ones stay valid.
    let out = text;
    for (const e of [...mine].reverse()) out = splice(out, e.line.start, afterBreak(out, e.line.end), '');
    return out;
  }
  const line = value === '' ? keyword : `${keyword} ${value}`;
  const last = mine[mine.length - 1];
  if (last) return splice(text, last.line.start, last.line.end, line);

  const eol = eolOf(text);
  // New keywords go after the last one; without any, after the leading comment header (before the first block).
  // Keywords before the first block (do_rpa has to precede `begin qpoints`), else after the header.
  const firstBlock = doc.blocks[0]?.span.start ?? Infinity;
  const before = doc.entries.filter((e) => e.span.start < firstBlock);
  const anchor = before[before.length - 1];
  if (anchor) {
    const at = anchor.line.end;
    return splice(text, at, at, eol + line);
  }
  let at = 0;
  for (const l of doc.lines) {
    if (l.text.trim() !== '' && l.text[0] !== '#') break;
    at = afterBreak(text, l.end);
  }
  if (at === text.length && text.length > 0 && !text.endsWith('\n')) return text + eol + line + eol;
  return splice(text, at, at, line + eol);
}

function setBlock(text: string, name: string, rows: string[] | null): string {
  const doc = parseBgw(text);
  const block = doc.blocks.find((b) => b.name === name);
  const eol = eolOf(text);
  if (rows === null) {
    return block ? splice(text, block.span.start, afterBreak(text, block.span.end), '') : text;
  }
  // Blank lines and # comments inside a block would be read as rows by BerkeleyGW.
  const body = rows.map((r) => r.trimEnd()).filter((r) => r.trim() !== '' && !r.trimStart().startsWith('#'));
  const written = [`begin ${name}`, ...body.map((r) => (r.startsWith(' ') ? r : `  ${r}`)), 'end'].join(eol);
  if (block) return splice(text, block.span.start, block.span.end, written);
  const sep = text === '' || text.endsWith('\n') ? '' : eol;
  return `${text}${sep}${text === '' ? '' : eol}${written}${eol}`;
}
