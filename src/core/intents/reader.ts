// Typed, case-insensitive access to the effective tag values of a parsed INCAR.

import type { IncarDoc } from '../incar/parse';
import { expandArray, parseBool, parseReal } from '../incar/values';

export interface TagReader {
  has(tag: string): boolean;
  raw(tag: string): string | undefined;
  /** Upper-cased string value. */
  str(tag: string): string | undefined;
  num(tag: string): number | undefined;
  bool(tag: string): boolean | undefined;
  array(tag: string): string[] | undefined;
}

export function tagReader(doc: IncarDoc): TagReader {
  const raw = (tag: string) => doc.tags.get(tag.toUpperCase())?.value;
  return {
    has: (tag) => doc.tags.has(tag.toUpperCase()),
    raw,
    str: (tag) => raw(tag)?.toUpperCase(),
    num: (tag) => {
      const v = raw(tag);
      return v === undefined ? undefined : parseReal(v);
    },
    bool: (tag) => {
      const v = raw(tag);
      return v === undefined ? undefined : parseBool(v);
    },
    array: (tag) => {
      const v = raw(tag);
      return v === undefined ? undefined : expandArray(v);
    },
  };
}

/** Effective values of tags whose VASP defaults depend on other tags. */
export const effective = {
  nsw: (r: TagReader) => r.num('NSW') ?? 0,
  ibrion: (r: TagReader) => r.num('IBRION') ?? (effective.nsw(r) > 0 ? 0 : -1),
  isif: (r: TagReader) => r.num('ISIF') ?? (effective.ibrion(r) === 0 || r.bool('LHFCALC') ? 0 : 2),
  ismear: (r: TagReader) => r.num('ISMEAR') ?? 1,
  ispin: (r: TagReader) => r.num('ISPIN') ?? 1,
  noncollinear: (r: TagReader) => r.bool('LNONCOLLINEAR') === true || r.bool('LSORBIT') === true,
  isRelaxation: (r: TagReader) => effective.nsw(r) > 0 && [1, 2, 3].includes(effective.ibrion(r)),
  isMD: (r: TagReader) => effective.nsw(r) > 0 && effective.ibrion(r) === 0,
};
