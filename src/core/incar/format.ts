// Formats a whole INCAR: one statement per line, tag names in upper case, tags grouped by
// category in a fixed order with `# Category` headers, and `=` signs and trailing comments aligned.
//
// Values are copied verbatim (including quotes and `\` continuations) and every comment is kept:
// a trailing comment stays with its statement, comment lines move with the statement below them.
// Formatting is idempotent: the category headers it writes are recognized and replaced.

import { CATEGORY_LABELS, type Category } from '../tags/schema';
import { TAG_DEFS, tagDef } from '../tags/definitions';
import { fallbackDef, isKnownTag, tagCategory } from '../tags/known';
import { formatBool, parseBool } from './values';
import { computeLineStarts, lineOf, parseIncar, type Span } from './parse';

export interface FormatOptions {
  /** Sort tags into categories (General, Electronic minimization, …); otherwise keep file order. */
  groupByCategory: boolean;
  /** Write a `# Category` comment above each group. */
  categoryHeaders: boolean;
  /** Pad tag names so the `=` signs of a group line up. */
  alignEquals: boolean;
  /** Line up trailing comments within a group. */
  alignComments: boolean;
  /** Spelling of logical values of logical tags: `.TRUE.`/`.FALSE.`, `T`/`F`, or as written. */
  logicals: '.TRUE.' | 'T' | 'keep';
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  groupByCategory: true,
  categoryHeaders: true,
  alignEquals: true,
  alignComments: true,
  logicals: '.TRUE.',
};

/**
 * Rewrites the values of logical tags (T, .t., True, .TRUE., …) in one spelling, everywhere in the
 * file including GROUP { } blocks. Values that are not plain logicals are left alone.
 */
export function unifyLogicals(text: string, style: FormatOptions['logicals']): string {
  if (style === 'keep') return text;
  let out = text;
  for (const e of [...parseIncar(text).entries].reverse()) {
    if ((tagDef(e.key) ?? fallbackDef(e.key))?.type !== 'bool') continue;
    const raw = text.slice(e.valueSpan.start, e.valueSpan.end);
    const value = parseBool(raw);
    if (value === undefined) continue;
    const spelled = style === 'T' ? (value ? 'T' : 'F') : formatBool(value);
    if (spelled !== raw) out = out.slice(0, e.valueSpan.start) + spelled + out.slice(e.valueSpan.end);
  }
  return out;
}

const OTHER = 'Other tags';
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as Category[];
const HEADER_TEXTS = new Set([...Object.values(CATEGORY_LABELS), OTHER]);
const DEF_ORDER = new Map(TAG_DEFS.map((d, i) => [d.name, i]));
/** Trailing comments of longer statements are not used to set the comment column. */
const MAX_ALIGNED_BODY = 50;

interface Item {
  span: Span;
  /** Comment lines directly above the statement. */
  leading: string[];
  trailing?: string;
  /** Comment lines below the statement that close its paragraph (a blank line follows them). */
  after: string[];
  /**
   * For a statement: `KEY`, raw value. For a GROUP { … } block or a commented-out statement: its
   * verbatim text (and for the latter the tag in `key`, for sorting).
   */
  key?: string;
  value?: string;
  block?: string;
  group: Category | typeof OTHER;
  order: number;
  /** `leading` is one comment line that opens a paragraph: possibly a hand-written section heading. */
  section?: boolean;
}

/** Words that mark a hand-written section heading as being about a category. */
const SECTION_WORDS: Record<Category | typeof OTHER, RegExp> = {
  flow: /\b(flow|output|input|i\/o|write|start|restart|files?|dos)\b/i,
  electronic: /\b(electronic|scf|convergence|minimi[sz]ation|basis|cutoff|precision|accuracy)\b/i,
  smearing: /\b(smearing|occupations?)\b/i,
  xc: /\b(exchange|functional|xc|hybrid|hse\d*|pbe\d*|gga|meta-?gga|r?scan)\b/i,
  vdw: /\b(vdw|van der waals|dispersion|d3|d4)\b/i,
  spin: /\b(magneti\w*|spin|soc)\b/i,
  ldau: /(dft\s*\+\s*u|\bldau\b|\bhubbard\b|\+u\b)/i,
  ionic: /\b(ionic|relax\w*|geometry|optimi[sz]ation)\b/i,
  md: /\b(md|molecular dynamics|thermostat|barostat)\b/i,
  response: /\b(dielectric|optic\w*|response|born|phonons?)\b/i,
  manybody: /\b(gw|bse|rpa|acfdt|mp2|many[- ]body)\b/i,
  parallel: /\b(parallel\w*)\b/i,
  mlff: /\b(mlff|machine[- ]learn\w*|force fields?)\b/i,
  [OTHER]: /\bother\b/i,
};

/**
 * The formatted text, or undefined when the INCAR has syntax problems: text the parser cannot
 * place could otherwise be lost or moved to the wrong statement.
 */
export function formatIncar(original: string, options: FormatOptions = DEFAULT_FORMAT_OPTIONS): string | undefined {
  if (parseIncar(original).issues.length) return undefined;
  const text = unifyLogicals(original, options.logicals);
  const doc = parseIncar(text);
  if (!doc.entries.length && !doc.comments.length) return text.trim() ? undefined : text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lineStarts = computeLineStarts(text);
  const line = (offset: number) => lineOf(lineStarts, offset);

  // Outermost blocks are kept whole; statements and comments inside them are part of the block.
  const blocks = doc.blocks.filter((b) => !doc.blocks.some((o) => o !== b && o.span.start <= b.span.start && b.span.end <= o.span.end));
  const inside = (outer: Span, s: Span) => outer.start <= s.start && s.end <= outer.end;
  const inBlock = (s: Span) => blocks.some((b) => inside(b.span, s));

  // A comment line that is itself a statement of a known tag ("# ML_MB = 2000") is a switched-off
  // setting: it is sorted with that tag's category and kept verbatim.
  const disabled = doc.comments
    .filter((c) => !inBlock(c) && !doc.entries.some((e) => line(e.span.start) === line(c.start)))
    .map((c) => ({ span: c, key: text.slice(c.start, c.end).match(DISABLED)?.[1].toUpperCase() }))
    .filter((d): d is { span: Span; key: string } => !!d.key && isKnownTag(d.key));

  const items: Item[] = [
    ...doc.entries
      .filter((e) => !inBlock(e.span))
      .map((e): Item => ({
        span: e.span,
        leading: [],
        after: [],
        key: e.key,
        value: text.slice(e.valueSpan.start, e.valueSpan.end),
        group: categoryOf(e.key),
        order: 0,
      })),
    ...disabled.map((d): Item => ({ span: d.span, leading: [], after: [], key: d.key, block: text.slice(d.span.start, d.span.end), group: categoryOf(d.key), order: 0 })),
    // A block goes with the category of the first tag inside it that has one.
    ...blocks.map((b): Item => ({
      span: b.span,
      leading: [],
      after: [],
      block: text.slice(b.span.start, b.span.end),
      group: doc.entries.filter((e) => inside(b.span, e.span)).map((e) => categoryOf(e.key)).find((g) => g !== OTHER) ?? OTHER,
      order: 0,
    })),
  ].sort((a, b) => a.span.start - b.span.start);
  items.forEach((item, i) => (item.order = i));

  // Attach comments: same line after a statement → trailing; on their own line → leading for the
  // next statement. Comment lines before the first statement and separated from it by a blank
  // line stay at the top; comment lines after the last statement stay at the bottom.
  const preamble: string[] = [];
  let pending: { text: string; start: number; end: number }[] = [];
  let next = 0;
  const comments = doc.comments.filter((c) => !inBlock(c) && !disabled.some((d) => d.span === c));
  for (const c of comments) {
    while (next < items.length && items[next].span.start < c.start) {
      attachPending(items[next]);
      next++;
    }
    const commentText = text.slice(c.start, c.end);
    const owner = items[next - 1];
    if (owner && line(owner.span.end) === line(c.start)) {
      owner.trailing = commentText;
      continue;
    }
    if (isHeader(commentText)) continue;
    pending.push({ text: commentText, start: c.start, end: c.end });
  }
  while (next < items.length) attachPending(items[next++]);
  const footer = pending.map((p) => p.text);

  function attachPending(item: Item) {
    if (!pending.length) return;
    const last = pending[pending.length - 1];
    const blankLineBetween = line(item.span.start) - line(last.end) > 1;
    const previous = items[item.order - 1];
    if (item.order === 0 && blankLineBetween) {
      preamble.push(...pending.map((p) => p.text));
    } else if (blankLineBetween && previous) {
      // Separated from the next statement by a blank line: these close the paragraph above.
      previous.after.push(...pending.map((p) => p.text));
    } else {
      item.leading.push(...pending.map((p) => p.text));
      // A single comment line opening a paragraph is a section heading written by hand.
      item.section = pending.length === 1 && (!previous || line(pending[0].start) - line(previous.span.end) > 1);
    }
    pending = [];
  }

  // Group and order.
  const groups = new Map<string, Item[]>();
  if (options.groupByCategory) {
    // SYSTEM is the title of the run: first, without a header.
    groups.set(TITLE, items.filter(isTitle));
    for (const g of [...CATEGORY_ORDER, OTHER]) groups.set(g, []);
    for (const item of items) if (!isTitle(item)) groups.get(item.group)!.push(item);
    for (const [g, list] of groups) {
      // Curated tags in their definition order, then the rest (and blocks) in file order.
      const rank = (i: Item) => (i.key !== undefined ? DEF_ORDER.get(i.key) : undefined) ?? Infinity;
      if (g !== OTHER) list.sort((a, b) => rank(a) - rank(b) || a.order - b.order);
    }
  } else {
    groups.set('', items);
  }

  // Headers. A hand-written section heading ("# DFT+U (Dudarev)") about the same topic as a group
  // replaces ours, when any statement of its paragraph lands in that group. Decided for all groups
  // before printing, since the heading is taken away from the statement it was written above.
  const headers = new Map<string, string>();
  if (options.groupByCategory && options.categoryHeaders) {
    const paragraphs = new Map<Item, Item>(); // statement → owner of its paragraph's heading
    let owner: Item | undefined;
    for (const item of items) {
      const previous = items[item.order - 1];
      if (item.section) owner = item;
      else if (previous && line(item.span.start) - line(previous.span.end) > 1) owner = undefined;
      if (owner) paragraphs.set(item, owner);
    }
    const used = new Set<Item>();
    for (const [g, list] of groups) {
      if (!list.length || g === TITLE) continue;
      const own = list.map((item) => paragraphs.get(item)).find((o) => o && !used.has(o) && SECTION_WORDS[g as Item['group']].test(o.leading[0]));
      if (own) used.add(own);
      headers.set(g, own ? own.leading[0] : `# ${g === OTHER ? OTHER : CATEGORY_LABELS[g as Category]}`);
    }
    for (const o of used) o.leading.shift();
  }

  const sections: string[][] = [];
  if (preamble.length) sections.push(preamble);
  for (const [g, list] of groups) {
    if (!list.length) continue;
    sections.push([...(headers.has(g) ? [headers.get(g)!] : []), ...formatGroup(list, options)]);
  }
  if (footer.length) sections.push(footer);
  return sections.map((s) => s.join(eol)).join(eol + eol) + eol;
}

function formatGroup(items: Item[], options: FormatOptions): string[] {
  const statements = items.filter((i) => i.block === undefined);
  const keyWidth = options.alignEquals ? Math.max(...statements.map((i) => i.key!.length), 0) : 0;
  const bodies = items.map((item) => {
    if (item.block !== undefined) return item.block;
    const key = item.key!.padEnd(keyWidth);
    return item.value ? `${key} = ${item.value}` : `${key} =`;
  });
  // Comment column: just past the longest single-line statement of normal length.
  const lastLine = (s: string) => s.slice(s.lastIndexOf('\n') + 1);
  const column = options.alignComments
    ? Math.max(0, ...bodies.filter((b, i) => items[i].trailing && !b.includes('\n') && b.length <= MAX_ALIGNED_BODY).map((b) => b.length))
    : 0;
  const out: string[] = [];
  items.forEach((item, i) => {
    out.push(...item.leading);
    let body = bodies[i];
    if (item.trailing) {
      const width = lastLine(body).length;
      body += ' '.repeat(Math.max(0, column - width) + 2) + item.trailing;
    }
    out.push(body, ...item.after);
  });
  return out;
}

const TITLE = 'SYSTEM';

function isTitle(item: Item): boolean {
  return item.key === TITLE && item.block === undefined;
}

/** `# TAG = value` on its own line. */
const DISABLED = /^[#!]+\s*([A-Za-z][A-Za-z0-9_]*(?:\/[A-Za-z][A-Za-z0-9_]*)*)\s*=/;

function categoryOf(key: string): Item['group'] {
  return tagCategory(key) ?? OTHER;
}

function isHeader(comment: string): boolean {
  return HEADER_TEXTS.has(comment.replace(/^[#!]+/, '').trim());
}
