import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { minimalEdit, removeTag, setTag, setTags } from '../../src/core/incar/edit';
import { parseIncar } from '../../src/core/incar/parse';
import { compressArray, expandArray, parseBool, parseReal } from '../../src/core/incar/values';

const fixtures = join(__dirname, '..', 'fixtures');

describe('parseIncar', () => {
  it('reads tags, comments, ; separators and continuations', () => {
    const text = 'SYSTEM = test run ! title\nENCUT=520;  ismear = 0 # gaussian\nMAGMOM = 2*1.0 \\\n   -1 -1\n';
    const doc = parseIncar(text);
    expect(doc.entries.map((e) => [e.key, e.value])).toEqual([
      ['SYSTEM', 'test run'],
      ['ENCUT', '520'],
      ['ISMEAR', '0'],
      ['MAGMOM', '2*1.0 -1 -1'],
    ]);
    expect(doc.entries[2].line).toBe(1);
    expect(doc.entries[3].line).toBe(2);
    expect(doc.comments).toHaveLength(2);
    expect(doc.issues).toEqual([]);
  });

  it('keeps the exact source span of each value', () => {
    const text = '  EDIFF   =   1E-6   ! tight\n';
    const e = parseIncar(text).entries[0];
    expect(text.slice(e.valueSpan.start, e.valueSpan.end)).toBe('1E-6');
    expect(text.slice(e.keySpan.start, e.keySpan.end)).toBe('EDIFF');
  });

  it('handles quoted values spanning lines and CRLF', () => {
    const doc = parseIncar('SYSTEM = "a ; b # c"\r\nNSW = 5\r\n');
    expect(doc.entries.map((e) => [e.key, e.value])).toEqual([['SYSTEM', 'a ; b # c'], ['NSW', '5']]);
  });

  it('reports statements without =', () => {
    const doc = parseIncar('ENCUT 400\n= 3\n');
    expect(doc.issues.map((i) => i.message)).toEqual(["Expected 'TAG = value'", 'Missing tag name before =']);
  });

  it('reads GROUP { ... } blocks as GROUP/TAG', () => {
    const text = 'ENCUT = 400\nKERNEL_TRUNCATION {\n   LTRUNCATE = T   ! on\n   ISURFACE  = 3\n}\nPLUGINS/STRUCTURE = T\n';
    const doc = parseIncar(text);
    expect(doc.issues).toEqual([]);
    expect(doc.entries.map((e) => [e.key, e.value])).toEqual([
      ['ENCUT', '400'],
      ['KERNEL_TRUNCATION/LTRUNCATE', 'T'],
      ['KERNEL_TRUNCATION/ISURFACE', '3'],
      ['PLUGINS/STRUCTURE', 'T'],
    ]);
    // Edits inside a block touch only the value.
    expect(setTag(text, 'KERNEL_TRUNCATION/ISURFACE', '2')).toBe(text.replace('ISURFACE  = 3', 'ISURFACE  = 2'));
  });

  it('reports unbalanced blocks', () => {
    expect(parseIncar('PLUGINS {\nSTRUCTURE = T\n').issues.map((i) => i.message)).toEqual(["'PLUGINS {' is never closed with '}'"]);
    expect(parseIncar('NSW = 1\n}\n').issues.map((i) => i.message)).toEqual(["'}' without a matching 'GROUP {'"]);
  });

  it('uses the first occurrence for duplicates', () => {
    const doc = parseIncar('NSW = 1\nNSW = 2\n');
    expect(doc.tags.get('NSW')?.value).toBe('1');
    expect(doc.entries).toHaveLength(2);
  });

  it('parses every fixture without issues', () => {
    for (const name of readdirSync(fixtures).filter((f) => f.startsWith('INCAR'))) {
      const doc = parseIncar(readFileSync(join(fixtures, name), 'utf8'));
      expect(doc.issues, name).toEqual([]);
      expect(doc.entries.length, name).toBeGreaterThan(3);
    }
  });
});

describe('editing', () => {
  it('replaces only the value, preserving alignment and comments', () => {
    const text = 'ENCUT  = 400   ! cutoff\nISMEAR = 0\n';
    expect(setTag(text, 'encut', '520')).toBe('ENCUT  = 520   ! cutoff\nISMEAR = 0\n');
  });

  it('appends new tags, adding a final newline when missing', () => {
    expect(setTag('NSW = 0', 'IBRION', '-1')).toBe('NSW = 0\nIBRION = -1\n');
    expect(setTag('', 'NSW', '0')).toBe('NSW = 0\n');
    expect(setTag('A = 1\r\n', 'NSW', '0')).toBe('A = 1\r\nNSW = 0\r\n');
  });

  it('fills an empty value', () => {
    expect(setTag('ENCUT =\n', 'ENCUT', '400')).toBe('ENCUT = 400\n');
  });

  it('removes whole lines, including a trailing comment', () => {
    expect(removeTag('A = 1\nB = 2 ! about B\nC = 3\n', 'B')).toBe('A = 1\nC = 3\n');
    expect(removeTag('A = 1\nB = 2', 'B')).toBe('A = 1');
  });

  it('removes statements that share a line', () => {
    expect(removeTag('A = 1 ; B = 2 ; C = 3\n', 'B')).toBe('A = 1 ; C = 3\n');
    expect(removeTag('A = 1 ; B = 2\n', 'B')).toBe('A = 1\n');
    expect(removeTag('A = 1 ; B = 2\n', 'A')).toBe('B = 2\n');
  });

  it('removes continued statements and duplicates', () => {
    expect(removeTag('MAGMOM = 1 \\\n 2\nNSW = 1\nMAGMOM = 3\n', 'MAGMOM')).toBe('NSW = 1\n');
  });

  it('keeps Windows line endings', () => {
    const text = 'ENCUT = 400\r\nISMEAR = 1\r\nSIGMA = 0.2\r\n';
    expect(setTags(text, { ENCUT: '520', SIGMA: null, EDIFF: '1E-6' })).toBe('ENCUT = 520\r\nISMEAR = 1\r\nEDIFF = 1E-6\r\n');
  });

  it('applies a batch of changes', () => {
    expect(setTags('ISMEAR = 1\nSIGMA = 0.2\n', { ISMEAR: '0', SIGMA: null, EDIFF: '1E-6' })).toBe('ISMEAR = 0\nEDIFF = 1E-6\n');
  });

  it('round-trips fixtures through a no-op edit', () => {
    for (const name of readdirSync(fixtures).filter((f) => f.startsWith('INCAR'))) {
      const text = readFileSync(join(fixtures, name), 'utf8');
      const first = parseIncar(text).entries[0];
      expect(setTag(text, first.key, text.slice(first.valueSpan.start, first.valueSpan.end)), name).toBe(text);
    }
  });

  it('computes minimal edits', () => {
    expect(minimalEdit('ENCUT = 400\n', 'ENCUT = 520\n')).toEqual({ start: 8, end: 10, text: '52' });
    expect(minimalEdit('a', 'a')).toBeUndefined();
    const before = 'A = 1\nB = 2\n';
    const after = 'A = 1\n';
    const e = minimalEdit(before, after)!;
    expect(before.slice(0, e.start) + e.text + before.slice(e.end)).toBe(after);
  });
});

describe('values', () => {
  it('parses Fortran logicals and reals', () => {
    expect(['.TRUE.', 'T', '.t.', 'true'].map(parseBool)).toEqual([true, true, true, true]);
    expect(['.FALSE.', 'F', '.f.'].map(parseBool)).toEqual([false, false, false]);
    expect(parseBool('yes')).toBeUndefined();
    expect(parseReal('1.0D-5')).toBe(1e-5);
    expect(parseReal('-.5')).toBe(-0.5);
    expect(parseReal('1e')).toBeUndefined();
  });

  it('expands and compresses repeats', () => {
    expect(expandArray('2*1.0 -1 3*0')).toEqual(['1.0', '1.0', '-1', '0', '0', '0']);
    expect(expandArray('x*1')).toBeUndefined();
    expect(compressArray(['5', '5', '-5', '0', '0', '0'])).toBe('2*5 -5 3*0');
  });
});
