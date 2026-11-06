// Typed access to the entries of a parsed BerkeleyGW input. The Fortran reader keeps the last value
// of a keyword, and so does this.

import { isNumber, toNumber } from '../lines';
import type { Span } from '../incar/parse';
import type { Diagnostic } from '../validation/rules';
import type { BgwBlock, BgwDoc, BgwEntry } from './parse';

/** How the semantic checks report a problem. */
export type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => void;

export class BgwReader {
  constructor(readonly doc: BgwDoc) {}
  /** The last entry of a keyword. */
  entry(name: string): BgwEntry | undefined {
    const all = this.doc.entries.filter((e) => e.keyword === name);
    return all[all.length - 1];
  }
  /** Where the keyword is written (its last entry). */
  keyAt = (name: string): Span => this.entry(name)!.keySpan;
  /** Where its value is: the value, or the keyword itself for a flag. */
  valueAt(name: string): Span {
    const e = this.entry(name)!;
    return e.args.length ? e.valueSpan : e.keySpan;
  }
  has = (name: string) => this.entry(name) !== undefined;
  block(name: string): BgwBlock | undefined {
    return this.doc.blocks.find((b) => b.name === name);
  }
  /** The first value as a number, undefined when not set or not a number. */
  num(name: string): number | undefined {
    const t = this.entry(name)?.args[0];
    return t && isNumber(t.text) ? toNumber(t.text) : undefined;
  }
  /** Whether `name` comes after `other` in the file (the later of two switches wins). */
  after(name: string, other: string): boolean {
    const a = this.entry(name);
    const b = this.entry(other);
    return !!a && (!b || a.span.start > b.span.start);
  }
}
