// Typed access to the variables of a parsed MolGW input, with the defaults of the Fortran source for what is
// not set. The namelist keeps the last value of a variable that is set twice, and so does this.

import type { Span } from '../incar/parse';
import { toNumber } from '../lines';
import type { MolgwDoc, MolgwEntry } from './parse';
import { lookupMolgw } from './tags';

/** Fortran list-directed numbers: `1`, `1.`, `.5`, `1.0e-3`, `1.0d-3`, `1.0+3`. */
const REAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdDqQ][+-]?\d+|[+-]\d+)?$/;
const INTEGER = /^[+-]?\d+$/;
export const isFortranReal = (s: string) => REAL.test(s);
export const isFortranInteger = (s: string) => INTEGER.test(s);
export const toReal = (s: string) => toNumber(s.replace(/[qQ]/, 'e').replace(/^([+-]?[\d.]+)([+-]\d+)$/, '$1e$2'));

/** A repeat count `3*0.0` of list-directed input: the count and the value after it. */
export const splitRepeat = (s: string): { count: number; value: string } | undefined => {
  const m = s.match(/^(\d+)\*(.*)$/);
  return m ? { count: Number(m[1]), value: m[2] } : undefined;
};

export class MolgwReader {
  constructor(readonly doc: MolgwDoc) {}

  /** The last entry of a variable (any case; elements with a subscript are not the variable). */
  entry(name: string): MolgwEntry | undefined {
    let found: MolgwEntry | undefined;
    for (const e of this.doc.entries) if (!e.subscript && e.key.toLowerCase() === name) found = e;
    return found;
  }
  has = (name: string) => this.entry(name) !== undefined;

  /** The first value as written, without quotes; undefined when not set (or set without a value). */
  raw(name: string): string | undefined {
    return this.entry(name)?.values[0]?.text;
  }
  /** The string MolGW works with: the set value, else the default, trailing blanks dropped. */
  str(name: string): string {
    const v = this.raw(name);
    return (v ?? (lookupMolgw(name)?.default ?? '')).replace(/\s+$/, '');
  }
  /** As `str`, upper case: MolGW capitalizes most of its character variables before it compares them. */
  upper = (name: string) => this.str(name).toUpperCase();

  /** The number of an integer or real variable; undefined when the value is not a number. */
  num(name: string): number | undefined {
    const v = this.raw(name) ?? (lookupMolgw(name)?.default ?? '').replace(/'/g, '');
    const ok = lookupMolgw(name)?.type === 'integer' ? isFortranInteger(v) : isFortranReal(v);
    return ok ? toReal(v) : undefined;
  }
  /** A yes/no variable, read the way yesno_to_logical does (first three characters). */
  yes(name: string, yes: string[]): boolean {
    return yes.includes(this.str(name).toLowerCase().slice(0, 3));
  }
  /** Where to point at: the value when there is one, else the name. */
  at(name: string): Span {
    const e = this.entry(name)!;
    return e.values.length ? e.valueSpan : e.keySpan;
  }
}
