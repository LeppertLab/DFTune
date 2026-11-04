// Fortran namelist values as Quantum ESPRESSO reads them.

import type { QeType } from './tags';

const LOGICALS: Record<string, boolean> = { '.true.': true, '.t.': true, t: true, true: true, '.false.': false, '.f.': false, f: false, false: false };

/** `.true.`, `.T.`, `T`, `true` … → boolean; undefined if not a logical. */
export const parseLogical = (s: string): boolean | undefined => LOGICALS[s.trim().toLowerCase()];

const INTEGER = /^[+-]?\d+$/;
/** Fortran real: 1, 1., .5, 1.0e-3, 1.d-6, 1D-6 (an integer is a valid real value). */
const REAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;

export const isInteger = (s: string) => INTEGER.test(s.trim());
export const isReal = (s: string) => REAL.test(s.trim());
export const toReal = (s: string) => Number(s.trim().replace(/[dD]/, 'e'));

export const isQuoted = (s: string) => /^'.*'$|^".*"$/s.test(s.trim());
export const unquote = (s: string) => (isQuoted(s) ? s.trim().slice(1, -1) : s.trim());

/** Splits a namelist value into its items (commas and whitespace outside quotes); `n*x` repeats are kept as one item. */
export function valueItems(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/'[^']*'|"[^"]*"|[^\s,]+/g)) out.push(m[0]);
  return out;
}

/** Why `item` is not a valid value of `type`, or undefined if it is. */
export function checkItem(type: QeType, item: string): string | undefined {
  // r*value repeats an item r times.
  const repeat = item.match(/^(\d+)\*(.*)$/);
  if (repeat) item = repeat[2];
  switch (type) {
    case 'integer':
      return isInteger(item) ? undefined : `expected an integer, got ${item}`;
    case 'real':
      return isReal(item) ? undefined : `expected a number, got ${item}`;
    case 'logical':
      return parseLogical(item) !== undefined ? undefined : `expected .true. or .false., got ${item}`;
    case 'character':
      return undefined;
  }
}
