import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatKpoints } from '../../src/core/kpoints/format';
import { parseKpoints } from '../../src/core/kpoints/parse';

const fixtures = join(__dirname, '..', 'fixtures');
const files = readdirSync(fixtures).filter((f) => f.startsWith('KPOINTS')).map((f) => [f, readFileSync(join(fixtures, f), 'utf8')] as const);

const codes = (text: string) => parseKpoints(text).diagnostics.map((d) => d.code + ':' + d.severity);
const errors = (text: string) => parseKpoints(text).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

describe('parseKpoints', () => {
  it('accepts the fixtures', () => {
    for (const [name, text] of files) expect(errors(text), name).toEqual([]);
  });

  it('accepts every layout', () => {
    expect(errors('t\n0\nG\n4 4 4\n0 0 0\n')).toEqual([]);
    expect(errors('t\n0\nMonkhorst-Pack\n4 4 4\n')).toEqual([]);
    expect(errors('t\n0\nAuto\n30\n')).toEqual([]);
    expect(errors('t\n0\nR\n1 0 0\n0 1 0\n0 0 1\n0 0 0\n')).toEqual([]);
    expect(errors('t\n2\nC\n0 0 0 1\n0.5 0 0 1\n')).toEqual([]);
  });

  it('reports unreadable numbers where they are', () => {
    const text = 't\n0\nGamma\n4 x 4\n';
    const [d] = parseKpoints(text).diagnostics;
    expect(d.severity).toBe('error');
    expect(text.slice(d.span!.start, d.span!.end)).toBe('x');
  });

  it('reports structural problems', () => {
    expect(errors('')).toHaveLength(1);
    expect(errors('t\n')).toHaveLength(1);
    expect(errors('t\nabc\nGamma\n')[0]).toMatch(/number of k points/);
    expect(errors('t\n-1\nGamma\n')[0]).toMatch(/negative/);
    expect(errors('t\n0\nGamma\n4 4\n')[0]).toMatch(/expected 3 numbers/);
    expect(errors('t\n0\nGamma\n4 0 4\n')[0]).toMatch(/positive integers/);
    expect(errors('t\n0\nAuto\n-5\n')[0]).toMatch(/positive/);
    expect(errors('t\n3\nR\n0 0 0 1\n')[0]).toMatch(/ends after 1 of 3/);
    expect(errors('t\n2\nR\n0 0 0\n0 0 0 1\n')[0]).toMatch(/expected 4/);
    expect(errors('t\n2\nR\n0 0 0 1\n\n0 0 0 1\n')[0]).toMatch(/Blank line/);
    expect(errors('t\n0\nR\n1 0 0\n0 1 0\n0 0 1\n')[0]).toMatch(/shift/);
    expect(errors('t\n10\nL\nR\n0 0 0\n0.5 0 0\n0.5 0 0\n')[0]).toMatch(/pairs/);
    expect(errors('t\n0\nL\nR\n0 0 0\n0.5 0 0\n')[0]).toMatch(/points per segment/);
    expect(errors('t\n1\nR\n0 0 0 1\nT\n1 0.1\n1 1 2 3 4\n').join()).toMatch(/between 1 and 1/);
  });

  it('only hints at things VASP tolerates', () => {
    expect(codes('t\n0\nM\n4 4 4\n')).toEqual(['kpoints-even-mp:info']);
    expect(codes('t\n0\nGamma\n4 4 4\n0 0 0\nleft over\n')).toEqual(['kpoints-ignored:info']);
    expect(codes('t\n0\nGamma\n4 4 4\n! shift?\n')).toEqual(['kpoints-syntax:warning']);
    expect(codes('t\n1\nR\n0 0 0 0\n')).toEqual(['kpoints-weight:info']);
  });
});

describe('formatKpoints', () => {
  it('lines up k points on the decimal point and keeps the labels', () => {
    expect(formatKpoints('Bands\n10\nline\nrec\n0 0 0 ! G\n0.5 0.0 0.5  ! X\n\n\n0.5 0.0 0.5 ! X\n0.375 0.375   0.75 ! K\n')).toBe(
      [
        'Bands',
        '10',
        'Line-mode',
        'Reciprocal',
        '0      0      0     ! G',
        '0.5    0.0    0.5   ! X',
        '',
        '0.5    0.0    0.5   ! X',
        '0.375  0.375  0.75  ! K',
        '',
      ].join('\n'),
    );
  });

  it('aligns an explicit list with tetrahedra and negative numbers', () => {
    expect(formatKpoints(readFileSync(join(fixtures, 'KPOINTS.explicit'), 'utf8'))).toBe(
      [
        'Fe3O4 explicit list',
        '4',
        'Reciprocal',
        ' 0.0   0.0   0.0   1',
        ' 0.5   0.0   0.0   6',
        '-0.25  0.25  0.0  12  ! mid',
        ' 0.5   0.5   0.5   1',
        'Tetrahedra',
        '1 0.0123',
        '6  1  2  3  4',
        '',
      ].join('\n'),
    );
  });

  it('spells mode words one way and tidies whitespace', () => {
    expect(formatKpoints('title  \n  0  \ngamma\n  4   4 4  \n 0 0 0\n\n\n')).toBe('title\n0\nGamma\n4 4 4\n0 0 0\n');
    expect(formatKpoints('t\n0\nMonkhorst Pack\n2 2 2\n')).toBe('t\n0\nMonkhorst-Pack\n2 2 2\n');
    expect(formatKpoints('t\n0\nM\n2 2 2\n')).toBe('t\n0\nMonkhorst-Pack\n2 2 2\n');
    expect(formatKpoints('t\n1\ncart\n0 0 0 1\n')).toBe('t\n1\nCartesian\n0  0  0  1\n');
  });

  it('keeps CRLF line endings', () => {
    expect(formatKpoints('t\r\n0\r\ng\r\n2 2 2\r\n')).toBe('t\r\n0\r\nGamma\r\n2 2 2\r\n');
  });

  it('keeps every number and word, and is idempotent', () => {
    const words = (t: string) => t.split(/\s+/).filter(Boolean);
    for (const [name, text] of files) {
      const once = formatKpoints(text)!;
      expect(formatKpoints(once), name).toBe(once);
      expect(parseKpoints(once).diagnostics, name).toEqual(parseKpoints(text).diagnostics.map((d) => ({ ...d, span: expect.anything() })));
      // Same words in the same order, apart from the mode keywords.
      expect(words(once).filter((w) => /\d/.test(w)), name).toEqual(words(text).filter((w) => /\d/.test(w)));
    }
  });

  it('leaves files with errors alone', () => {
    expect(formatKpoints('t\n0\nGamma\n4 x 4\n')).toBeUndefined();
    expect(formatKpoints('t\n3\nR\n0 0 0 1\n')).toBeUndefined();
  });
});
