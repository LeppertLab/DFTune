// Formats an ABINIT input. Deliberately conservative: ABINIT reads the file as a stream of words, so layout does
// not matter to it, but people script against inputs, compare them and line up their own rows. Only
//   - every variable starts on its own line (`acell 3*10 Bohr  ecut 270 eV` is split)
//   - the values of consecutive `variable values` lines are aligned in a column; a variable whose values go on
//     in the lines below (rprim, xred, kpt, symrel, …) lines up with those lines instead
//   - trailing whitespace is removed and runs of blank lines collapse to one
//   - the file ends with one newline, and line endings are kept
// Comments (kept in their column where the line allows it), the order of everything, every word as written (names
// keep their case, numbers and units are never touched), the lines that continue a variable and the spacing inside
// the values stay as they are. A line that holds `include` is not touched.
//
// Idempotent. Returns undefined while the file has errors that make ABINIT read it differently from how it looks
// (a tab, a minus sign followed by a blank, an unmatched quote).

import { joinLines } from '../lines';
import { abinitCodeOf, parseAbinit, type AbinitEntry } from './parse';

/** A name longer than this does not take part in the alignment (one long name would push every value away). */
const MAX_NAME = 20;

interface Tail {
  /** The comment (starting at # or !), '' when the line has none. */
  comment: string;
  /** Spaces between the code and the comment in the original. */
  gap: number;
  /** Length of the code in the original line (indentation included), to keep the comment in its column. */
  codeLen: number;
  /** Set when the line was split: the comment then follows its last piece after the original gap. */
  split: boolean;
}

type Piece =
  | { kind: 'blank' }
  | { kind: 'raw'; text: string }
  | { kind: 'cont'; indent: string; text: string; tail: Tail }
  | { kind: 'entry'; name: string; rest: string; equals: boolean; tail: Tail; run: number; anchor?: number };

export function formatAbinit(text: string): string | undefined {
  const doc = parseAbinit(text);
  if (doc.issues.some((i) => i.severity === 'error')) return undefined;

  const entriesByLine = new Map<number, AbinitEntry[]>();
  for (const e of doc.entries) entriesByLine.set(e.line.n, [...(entriesByLine.get(e.line.n) ?? []), e]);

  const pieces: Piece[] = [];
  let run = 0;
  for (const line of doc.lines) {
    const code = abinitCodeOf(line.text);
    const codeLen = code.trimEnd().length;
    const comment = line.text.slice(code.length).trimEnd();

    if (line.text.trim() === '') {
      pieces.push({ kind: 'blank' });
      run++;
      continue;
    }
    if (codeLen === 0 || /include/i.test(code)) {
      // A comment line, or a line with an include statement: kept as written.
      pieces.push({ kind: 'raw', text: line.text.trimEnd() });
      run++;
      continue;
    }

    const starts = entriesByLine.get(line.n) ?? [];
    const firstStart = starts.length ? starts[0].keySpan.start - line.start : code.length;
    const parts: { text: string; entry?: AbinitEntry }[] = [];
    const lead = code.slice(0, firstStart);
    if (lead.trim()) parts.push({ text: lead.trim() });
    starts.forEach((e, i) => {
      const to = i + 1 < starts.length ? starts[i + 1].keySpan.start - line.start : code.length;
      parts.push({ text: code.slice(e.keySpan.start - line.start, to).trim(), entry: e });
    });
    const split = parts.length > 1;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const tail: Tail = { comment: last ? comment : '', gap: comment ? Math.max(1, code.length - codeLen) : 0, codeLen, split };
      if (!part.entry) {
        pieces.push({ kind: 'cont', indent: /^\s*/.exec(line.text)![0], text: part.text, tail });
        return;
      }
      const afterName = part.text.slice(part.entry.word.length);
      const equals = /^\s*=/.test(afterName);
      pieces.push({ kind: 'entry', name: part.entry.word, rest: afterName.trim().replace(/^=\s*/, ''), equals, tail, run });
    });
  }

  // A variable whose values continue in the lines below lines up with the first of them.
  for (const [i, p] of pieces.entries()) {
    if (p.kind !== 'entry') continue;
    for (let j = i + 1; j < pieces.length; j++) {
      const q = pieces[j];
      if (q.kind === 'cont') {
        if (q.indent.length > p.name.length && !p.equals) p.anchor = q.indent.length;
        break;
      }
      if (q.kind === 'blank' || q.kind === 'entry') break;
    }
  }

  // Alignment width of each run of lines.
  const widths = new Map<number, number>();
  for (const p of pieces) {
    if (p.kind !== 'entry' || p.name.length > MAX_NAME || p.equals || p.anchor !== undefined || !p.rest) continue;
    widths.set(p.run, Math.max(widths.get(p.run) ?? 0, p.name.length + 1));
  }

  const withTail = (code: string, tail: Tail, origLen: number): string => {
    if (!tail.comment) return code.trimEnd();
    // Keep the comment in its column where the code got shorter or longer, never closer than one space.
    const gap = tail.split ? tail.gap : Math.max(1, tail.gap + origLen - code.length);
    return code + ' '.repeat(gap) + tail.comment;
  };

  const out: string[] = [];
  for (const p of pieces) {
    if (p.kind === 'blank') out.push('');
    else if (p.kind === 'raw') out.push(p.text);
    else if (p.kind === 'cont') out.push(withTail(p.indent + p.text, p.tail, p.tail.codeLen));
    else {
      const head = !p.rest ? p.name : p.equals ? `${p.name} = ` : p.anchor !== undefined ? p.name.padEnd(p.anchor) : p.name.length <= MAX_NAME ? p.name.padEnd(widths.get(p.run) ?? p.name.length + 1) : `${p.name} `;
      out.push(withTail(head + p.rest, p.tail, p.tail.codeLen));
    }
  }
  const collapsed = out.filter((l, i) => !(l === '' && out[i - 1] === ''));
  return joinLines(collapsed, text);
}
