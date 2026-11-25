// Parser for ABINIT main input files (*.abi), following how ABINIT reads them (`instrng` and `parsefile`
// in src/42_parser/m_parser.F90):
//
//   - the file is one stream of blank-separated tokens: a variable and its values may span lines, and
//     several variables may share a line (`acell 3*10 Bohr  ecut 270 eV`)
//   - a `#` or `!` starts a comment that runs to the end of the line (even inside quotes)
//   - `=` counts as a blank, case does not matter
//   - a tab, or a minus sign followed by a blank, stops ABINIT ("This sign is confusing, and has been forbidden")
//   - a token that starts with a letter is a variable name, unless it is a unit that follows values (`Ha`, `Angstrom`)
//     or a square root; everything else are values of the variable before it
//   - strings are in double quotes; `include "file"` splices another file
//
// Values are only recorded as tokens here; `values.ts` reads them and `validate.ts` checks them.

import type { Span } from '../incar/parse';
import { splitLines, type Line, type Token } from '../lines';
import type { Diagnostic } from '../validation/rules';
import { isAbinitLogicalVariable, isAbinitStringVariable, parseAbinitSuffix, splitAbinitWord, ABINIT_UNIT_WORDS, abinitVariableOfWord, type AbinitVariable, type AbinitSuffixKind } from './tags';

export interface AbinitEntry {
  /** The word as written (`ecut?1`, `xred`). */
  word: string;
  /** The word cut back to its last letter, as written. */
  base: string;
  suffix: string;
  kind: AbinitSuffixKind;
  /** The documented variable, when the name is known. */
  variable?: AbinitVariable;
  /** Written with the `img` / `lastimg` suffix. */
  image: boolean;
  keySpan: Span;
  /** Value tokens (quoted strings are one token, quotes included). */
  args: Token[];
  /** Words after the values that name a unit. */
  units: Token[];
  span: Span;
  line: Line;
}

export interface AbinitDoc {
  text: string;
  lines: Line[];
  entries: AbinitEntry[];
  /** The files named by `include "file"`. */
  includes: Token[];
  issues: Diagnostic[];
}

/** The part of the line ABINIT reads: up to the first # or !. */
export function abinitCodeOf(line: string): string {
  const cut = line.search(/[#!]/);
  return cut < 0 ? line : line.slice(0, cut);
}

export function parseAbinit(text: string): AbinitDoc {
  const lines = splitLines(text, 'x');
  const doc: AbinitDoc = { text, lines, entries: [], includes: [], issues: [] };
  const issue = (severity: Diagnostic['severity'], code: string, message: string, span: Span, fix?: Diagnostic['fix']) =>
    doc.issues.push({ severity, code, message, span, ...(fix && { fix }) });

  let cur: AbinitEntry | undefined;
  let strayReported = false;
  let expectInclude = false;
  let lastQuote: Span | undefined;
  let quotes = 0;

  for (const line of lines) {
    const code = abinitCodeOf(line.text);
    // Tab and "- ": ABINIT refuses both, in the part of the line before a comment.
    const tab = code.indexOf('\t');
    if (tab >= 0) {
      issue('error', 'abinit-tab', 'A tab stops ABINIT ("This sign is confusing, and has been forbidden"). Use spaces.', { start: line.start + tab, end: line.start + tab + 1 }, {
        title: 'Replace the tab with a space',
        edit: { start: line.start + tab, end: line.start + tab + 1, text: ' ' },
      });
    }
    const minus = code.indexOf('- ');
    if (minus >= 0) {
      issue('error', 'abinit-minus-blank', 'A minus sign followed by a blank stops ABINIT: write the sign directly before the number (-1, not - 1).', { start: line.start + minus, end: line.start + minus + 2 }, {
        title: 'Remove the blank after the minus sign',
        edit: { start: line.start + minus + 1, end: line.start + minus + 2, text: '' },
      });
    }
    // `=` is a blank to ABINIT (same length, so the offsets stay).
    const body = code.replace(/=/g, ' ');
    for (const m of body.matchAll(/"[^"]*"?|\S+/g)) {
      const start = line.start + m.index!;
      const tok: Token = { text: m[0], start, end: start + m[0].length };
      if (tok.text[0] === '"') {
        quotes += (tok.text.match(/"/g) ?? []).length;
        lastQuote = tok;
      }
      if (tok.text === '//') continue; // concatenation of two strings
      if (expectInclude && tok.text[0] === '"') {
        doc.includes.push(tok);
        expectInclude = false;
        continue;
      }
      expectInclude = false;
      if (tok.text.toLowerCase() === 'include') {
        expectInclude = true;
        continue;
      }
      const first = tok.text[0];
      // chkvars_in_string: the word after a string variable is skipped whatever it is (`xyzfile t10.in.xyz`);
      // a logical variable takes T or F.
      if (cur && !cur.args.length && cur.variable && ((isAbinitStringVariable(cur.variable) && first !== '"') || (isAbinitLogicalVariable(cur.variable) && /^[TtFf]$/.test(tok.text)))) {
        cur.args.push(tok);
        cur.span.end = tok.end;
        continue;
      }
      if (/[A-Za-z]/.test(first) && !/^sqrt\(/i.test(tok.text)) {
        // A unit after the values of a variable.
        if (cur && cur.args.length && ABINIT_UNIT_WORDS[tok.text.toLowerCase()] !== undefined) {
          cur.units.push(tok);
          cur.span.end = tok.end;
          continue;
        }
        const { base, suffix } = splitAbinitWord(tok.text);
        const found = abinitVariableOfWord(base);
        cur = {
          word: tok.text,
          base,
          suffix,
          kind: parseAbinitSuffix(suffix),
          variable: found?.variable,
          image: !!found?.image,
          keySpan: tok,
          args: [],
          units: [],
          span: { start: tok.start, end: tok.end },
          line,
        };
        doc.entries.push(cur);
        continue;
      }
      if (!cur) {
        if (!strayReported) issue('warning', 'abinit-stray', `"${tok.text}" comes before any variable: ABINIT ignores values that belong to no variable.`, tok);
        strayReported = true;
        continue;
      }
      cur.args.push(tok);
      cur.span.end = tok.end;
    }
  }
  if (quotes % 2 === 1) issue('error', 'abinit-quote', 'The input has an unmatched double quote ("): ABINIT stops ("unmatched quotation marks"). Check the strings.', lastQuote ?? { start: 0, end: 0 });
  return doc;
}

