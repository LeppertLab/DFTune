// Typed access to the entries of a parsed QE input.

import type { QeCard, QeDoc, QeEntry, QeNamelist } from './parse';
import { isReal, parseLogical, toReal, unquote, valueItems } from './values';

/** Typed access to the entries of a parsed input. */
export class Reader {
  constructor(readonly doc: QeDoc) {}
  namelist = (name: string): QeNamelist | undefined => this.doc.namelists.find((n) => n.name === name);
  card = (name: string): QeCard | undefined => this.doc.cards.find((c) => c.name === name);
  /** The last entry of `name` (QE uses the last assignment); with `index`, that array element. */
  entry(namelist: string, name: string, index?: string): QeEntry | undefined {
    const list = this.namelist(namelist)?.entries.filter((e) => e.name === name && (index === undefined || e.index?.trim() === index));
    return list?.[list.length - 1];
  }
  has = (namelist: string, name: string, index?: string) => this.entry(namelist, name, index) !== undefined;

  /**
   * Element `i` (1-based) of an array variable as text. Fortran also allows the array form,
   * `celldm = 10.0, 0, 1.6`, where each value goes to the next element (also `2*0.5` repeats);
   * both forms are read, the later assignment winning.
   */
  elem(namelist: string, name: string, i: number): string | undefined {
    let found: string | undefined;
    for (const e of this.namelist(namelist)?.entries ?? []) {
      if (e.name !== name.toLowerCase()) continue;
      const first = e.index === undefined ? 1 : Number(e.index.split(',')[0]);
      if (!Number.isInteger(first)) continue;
      let at = first;
      for (const item of e.items) {
        const repeat = item.text.match(/^(\d+)\*(.*)$/);
        const count = repeat ? Number(repeat[1]) : 1;
        const value = repeat ? repeat[2] : item.text;
        if (i >= at && i < at + count) found = value;
        at += count;
      }
    }
    return found;
  }

  /** Element `i` of a real array variable, undefined when not set or not a number. */
  elemNum(namelist: string, name: string, i: number): number | undefined {
    const v = this.elem(namelist, name, i);
    return v !== undefined && isReal(v) ? toReal(v) : undefined;
  }
  /** First item of the value, unquoted and lower-cased. */
  str(namelist: string, name: string): string | undefined {
    const e = this.entry(namelist, name);
    return e && e.value ? unquote(valueItems(e.value)[0] ?? '').toLowerCase() : undefined;
  }
  num(namelist: string, name: string, index?: string): number | undefined {
    const e = this.entry(namelist, name, index);
    const item = e && valueItems(e.value)[0];
    return item !== undefined && isReal(item) ? toReal(item) : undefined;
  }
  bool(namelist: string, name: string): boolean | undefined {
    const e = this.entry(namelist, name);
    const item = e && valueItems(e.value)[0];
    return item === undefined ? undefined : parseLogical(item);
  }
}
