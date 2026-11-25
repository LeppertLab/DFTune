// Reading the value tokens of an ABINIT input the way the parser does (inarray and inread in
// src/42_parser/m_parser.F90):
//
//   - `n*value` repeats a value n times, `*value` fills the rest of the array
//   - integers are read list-directed: `3` is fine, `3.0` is an error
//   - reals are read list-directed (`1.0`, `.5`, `1d-3`, `1e-3`), also as a fraction `1/3`, or as `sqrt(x)` /
//     `-sqrt(x)` where x is a number or a fraction; a zero denominator and a negative root are errors

import { isInteger, isNumber, toNumber } from '../lines';

export interface AbinitTokenValue {
  /** How many array elements the token stands for (`3*0.5` → 3). Infinity for `*0.5`. */
  count: number;
  /** The value, when it could be evaluated. */
  value?: number;
  /** Set when ABINIT cannot read the token. */
  error?: string;
}

const REPEAT = /^(\d*)\*(.*)$/;

function realValue(s: string): { value?: number; error?: string } {
  if (s === '') return { error: 'a number is missing' };
  const sqrt = /^(-?)sqrt\((.*)\)$/i.exec(s);
  if (sqrt) {
    const inner = fraction(sqrt[2]);
    if (inner.value === undefined) return inner;
    if (inner.value < -1e-12) return { error: `the square root of the negative number ${sqrt[2]}` };
    const root = Math.sqrt(Math.max(inner.value, 0));
    return { value: sqrt[1] ? -root : root };
  }
  return fraction(s);
}

function fraction(s: string): { value?: number; error?: string } {
  const slash = s.indexOf('/');
  if (slash < 0) return isNumber(s) ? { value: toNumber(s) } : { error: `"${s}" is not a number` };
  const num = s.slice(0, slash);
  const den = s.slice(slash + 1);
  if (!isNumber(num) || !isNumber(den)) return { error: `"${s}" is not a fraction of two numbers` };
  if (Math.abs(toNumber(den)) < 1e-12) return { error: `the denominator of ${s} is zero` };
  return { value: toNumber(num) / toNumber(den) };
}

/** Reads one token of an integer (`int`) or real (`real`) array. */
export function readAbinitValue(text: string, type: 'int' | 'real'): AbinitTokenValue {
  let count = 1;
  let body = text;
  const rep = REPEAT.exec(text);
  if (rep) {
    if (rep[1] === '') count = Infinity;
    else count = Number(rep[1]);
    body = rep[2];
  }
  if (type === 'int') {
    // A slash ends list-directed input without an error.
    if (body.includes('/')) return { count };
    if (body === '') return { count, error: 'a number is missing' };
    return isInteger(body) ? { count, value: Number(body) } : { count, error: `"${body}" is not an integer` };
  }
  const r = realValue(body);
  return { count, ...r };
}
