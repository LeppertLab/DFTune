import { describe, expect, it } from 'vitest';
import { readKpoints } from '../../src/core/kpoints/read';
import { parsePoscar } from '../../src/core/poscar/parse';
import { readPoscar } from '../../src/core/poscar/read';
import type { Diagnostic } from '../../src/core/validation/rules';
import { LintCache } from '../../src/extension/lintCache';

describe('readPoscar is tolerant', () => {
  it('still reads species and counts when the scale or lattice is bad (template POSCAR)', () => {
    const zeroScale = readPoscar('template\n0\n1 0 0\n0 1 0\n0 0 1\nFe O\n6 8\nDirect\n');
    expect(zeroScale).toMatchObject({ species: ['Fe', 'O'], counts: [6, 8], nions: 14 });
    expect(zeroScale?.lattice).toBeUndefined();
    const flat = readPoscar('template\n1\n0 0 0\n0 0 0\n0 0 0\nFe O\n6 8\nDirect\n');
    expect(flat).toMatchObject({ species: ['Fe', 'O'], nions: 14 });
    const letters = readPoscar('template\n1\na b c\n0 1 0\n0 0 1\nSi\n2\nDirect\n');
    expect(letters).toMatchObject({ species: ['Si'], nions: 2 });
  });

  it('does not need the atom positions, and the file linter still reports the bad cell', () => {
    const truncated = readPoscar('t\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nDirect\n0 0 0\n');
    expect(truncated).toMatchObject({ nions: 2, volume: 125 });
    expect(parsePoscar('template\n0\n1 0 0\n0 1 0\n0 0 1\nFe\n6\nDirect\n').diagnostics.map((d) => d.message)).toContain('The scaling factor cannot be zero.');
  });
});

describe('readKpoints reads only the header', () => {
  it('does not look at the points', () => {
    expect(readKpoints('k\n3\nR\nnot numbers\nat all\nhere\nTetrahedra\n1 1\n6 1 2 3 4\n')).toEqual({ mode: 'explicit', nkpts: 3, tetrahedra: true });
    expect(readKpoints('k\n20\nLine\nR\ngarbage\n')).toEqual({ mode: 'line', points: 20 });
  });
});

describe('close-atom check on degenerate cells', () => {
  // Pairs are rejected early on the axes where they are far apart, and a cell where every pair is
  // close stops after 10 reports, so even degenerate cells stay fast; MAX_SHIFT_BUDGET is only a
  // safety net on top of that (it cannot be reached with realistic input, so it has no test).
  it('stays fast in a cell 0.001 Å thick', () => {
    const n = 1500;
    const pos = Array.from({ length: n }, (_, i) => `${((i * 0.618) % 1).toFixed(5)} ${((i * 0.414) % 1).toFixed(5)} ${((i * 0.732) % 1).toFixed(5)}`).join('\n');
    const text = `thin\n1\n20 0 0\n0 20 0\n0 0 0.001\nC\n${n}\nDirect\n${pos}\n`;
    const t = performance.now();
    parsePoscar(text);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

/** A document stand-in: only what LintCache looks at. */
const fakeDoc = (version = 1) => ({ uri: { toString: () => 'file:///INCAR' }, version, isClosed: false }) as never;
const d = (code: string): Diagnostic => ({ code, severity: 'info', message: code });

describe('LintCache', () => {
  it('lints once per document version and refreshes after a neighbour change', async () => {
    let runs = 0;
    const cache = new LintCache(async () => [d(`run${++runs}`)]);
    const doc = fakeDoc();
    await cache.get(doc);
    await cache.get(doc);
    expect(runs).toBe(1);
    cache.invalidate();
    await cache.get(doc);
    expect(runs).toBe(2);
    await cache.get(fakeDoc(2));
    expect(runs).toBe(3);
  });

  it('does not keep a failed lint', async () => {
    let runs = 0;
    const cache = new LintCache(async () => {
      if (++runs === 1) throw new Error('transient');
      return [d('ok')];
    });
    const doc = fakeDoc();
    await expect(cache.get(doc)).rejects.toThrow('transient');
    await Promise.resolve(); // let the eviction run
    expect((await cache.get(doc)).map((x) => x.code)).toEqual(['ok']);
  });

  it('lints again when a neighbour changes while a result is in flight', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cache = new LintCache(async () => {
      const n = ++runs;
      if (n === 1) await gate;
      return [d(`run${n}`)];
    });
    const seen: string[] = [];
    const pending = cache.whenCurrent(fakeDoc(), (ds) => seen.push(ds[0].code));
    cache.invalidate(); // a POSCAR changed on disk while run 1 was waiting
    release();
    await pending;
    expect(seen).toEqual(['run2']);
  });

  it('drops a result for text that was edited meanwhile, and swallows errors', async () => {
    const cache = new LintCache(async () => [d('x')]);
    const doc = { uri: { toString: () => 'file:///a' }, version: 1, isClosed: false };
    const seen: string[] = [];
    const pending = cache.whenCurrent(doc as never, (ds) => seen.push(ds[0].code));
    doc.version = 2;
    await pending;
    expect(seen).toEqual([]);
    const failing = new LintCache(async () => {
      throw new Error('boom');
    });
    await expect(failing.whenCurrent(fakeDoc(), () => seen.push('used'))).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });
});
