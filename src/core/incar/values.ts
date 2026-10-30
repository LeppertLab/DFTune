// Typed reading of INCAR values (Fortran logicals, D exponents, N*x repeats).

export function parseBool(raw: string): boolean | undefined {
  const s = raw.trim().toUpperCase().replace(/^\./, '').replace(/\.$/, '');
  if (s === 'T' || s === 'TRUE') return true;
  if (s === 'F' || s === 'FALSE') return false;
  return undefined;
}

export function formatBool(value: boolean): string {
  return value ? '.TRUE.' : '.FALSE.';
}

const REAL = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/;
const INT = /^[+-]?\d+$/;

export function parseReal(raw: string): number | undefined {
  const s = raw.trim();
  return REAL.test(s) ? Number(s.replace(/[dD]/, 'e')) : undefined;
}

export function parseInt_(raw: string): number | undefined {
  const s = raw.trim();
  return INT.test(s) ? Number(s) : undefined;
}

/**
 * Expands an INCAR array (`2*1.0 3*-1 0`) into its items.
 * Returns undefined if a repeat count is malformed.
 */
export function expandArray(raw: string): string[] | undefined {
  const items: string[] = [];
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const star = token.indexOf('*');
    if (star < 0) {
      items.push(token);
      continue;
    }
    const count = parseInt_(token.slice(0, star));
    const item = token.slice(star + 1);
    if (count === undefined || count < 0 || !item) return undefined;
    for (let i = 0; i < count; i++) items.push(item);
  }
  return items;
}

/** Joins items, folding runs of equal items into `N*x`. */
export function compressArray(items: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < items.length; ) {
    let j = i;
    while (j < items.length && items[j] === items[i]) j++;
    out.push(j - i > 1 ? `${j - i}*${items[i]}` : items[i]);
    i = j;
  }
  return out.join(' ');
}

/** Formats a number the way INCARs usually spell it (1E-6 rather than 0.000001). */
export function formatReal(value: number): string {
  if (value !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e6)) {
    const [mant, exp] = value.toExponential().split('e');
    return `${mant}E${Number(exp)}`;
  }
  return String(value);
}
