// Typed access to the entries of a parsed BerkeleyGW input. The Fortran reader keeps the last value
// of a keyword, and so does this.

import { isNumber, toNumber } from '../lines';
import type { BgwBlock, BgwDoc, BgwEntry } from './parse';

export class BgwReader {
  constructor(readonly doc: BgwDoc) {}
  /** The last entry of a keyword. */
  entry(name: string): BgwEntry | undefined {
    const all = this.doc.entries.filter((e) => e.keyword === name);
    return all[all.length - 1];
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
