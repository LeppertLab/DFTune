import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIncar } from '../../src/core/incar/parse';
import { lintKpoints } from '../../src/core/kpoints/context';
import { parsePoscar, type Structure } from '../../src/core/poscar/parse';
import { readPoscar } from '../../src/core/poscar/read';
import { readPotcar } from '../../src/core/potcar/read';
import { validate, type Diagnostic, type ValidationContext } from '../../src/core/validation/rules';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');
const apply = (text: string, d: Diagnostic) => text.slice(0, d.fix!.edit.start) + d.fix!.edit.text + text.slice(d.fix!.edit.end);

/** Applies the quick fix of the diagnostic `code` and returns the new text; the problem must be gone. */
function fixIncar(text: string, code: string, ctx: ValidationContext = {}) {
  const d = validate(parseIncar(text), ctx).find((x) => x.code === code);
  expect(d?.fix, `${code} has a fix`).toBeDefined();
  const out = apply(text, d!);
  expect(validate(parseIncar(out), ctx).map((x) => x.code), `${code} is resolved`).not.toContain(code);
  return out;
}

describe('INCAR quick fixes', () => {
  const poscar = readPoscar(fixture('POSCAR'))!;
  const potcar = readPotcar(fixture('POTCAR.headers'));

  it('renames typos and old names', () => {
    expect(fixIncar('ENCTU = 400\n', 'unknown-tag')).toBe('ENCUT = 400\n');
    expect(fixIncar('ISMEAR = 0\nML_FF_LMLFF = .TRUE.\n', 'alias')).toMatch(/^ML_LMLFF = \.TRUE\.$/m);
  });

  it('sets or removes tags', () => {
    expect(fixIncar('NSW = 10\nISMEAR = 0\n', 'nsw-without-ibrion')).toMatch(/^IBRION = 2$/m);
    expect(fixIncar('METAGGA = SCAN\nISMEAR = 0\n', 'metagga-lasph')).toMatch(/^LASPH = \.TRUE\.$/m);
    expect(fixIncar('ENCUT = 520\nISMEAR = 0\nNCORE = 4\nNPAR = 2\n', 'ncore-npar')).not.toMatch(/NPAR/);
    expect(fixIncar('ENCUT = 400\n', 'default-mp')).toMatch(/^ISMEAR = 0$[^]*^SIGMA = 0\.05$/m);
    expect(fixIncar('ISMEAR = 0\nSIGMA = 0.1\nLDAU = .TRUE.\nLDAUL = 2 -1\nLDAUU = 4 0\n', 'ldau-lmaxmix')).toMatch(/^LMAXMIX = 4$/m);
    expect(fixIncar('ISMEAR = 0\nIBRION = 5\nEDIFF = 1E-7\n', 'phonon-symmetry')).toMatch(/^IBRION = 6$/m);
  });

  it('uses the POTCAR for the cutoff', () => {
    expect(fixIncar('ENCUT = 300\nISMEAR = 0\n', 'encut-below-enmax', { poscar, potcar })).toMatch(/^ENCUT = 520$/m);
    expect(fixIncar('ISMEAR = 0\nIBRION = 2\nNSW = 10\nISIF = 3\n', 'pulay', { poscar, potcar })).toMatch(/^ENCUT = 520$/m);
    // Without a POTCAR there is no number to write.
    expect(validate(parseIncar('ISMEAR = 0\nIBRION = 2\nNSW = 10\nISIF = 3\n'), {}).find((d) => d.code === 'pulay')?.fix).toBeUndefined();
  });
});

describe('KPOINTS and POSCAR quick fixes', () => {
  const cell = (text: string) => parsePoscar(text).structure as Structure;
  const HEX = cell('hex\n1\n3.2 0 0\n-1.6 2.7712812921 0\n0 0 5.2\nC\n1\nDirect\n0 0 0\n');
  const SLAB = cell('slab\n1\n3 0 0\n0 3 0\n0 0 30\nH\n1\nDirect\n0 0 0\n');

  it('switches to a Γ-centred mesh', () => {
    const text = 'k\n0\nMonkhorst-Pack\n6 6 4\n';
    expect(apply(text, lintKpoints(text, HEX)[0])).toBe('k\n0\nGamma\n6 6 4\n');
    expect(apply(text, lintKpoints(text)[0])).toBe('k\n0\nGamma\n6 6 4\n');
  });

  it('balances an uneven mesh', () => {
    const text = 'k\n0\nGamma\n8 8 8  ! dense\n';
    const fixed = apply(text, lintKpoints(text, SLAB)[0]);
    expect(fixed).toBe('k\n0\nGamma\n8 8 1  ! dense\n');
    expect(lintKpoints(fixed, SLAB)).toEqual([]);
  });

  it('switches Direct to Cartesian', () => {
    const text = 't\n1\n5 0 0\n0 5 0\n0 0 5\nH\n2\nDirect\n0 0 0\n3 2.5 2.5\n';
    const d = parsePoscar(text).diagnostics.find((x) => x.code === 'poscar-mode-mismatch')!;
    expect(apply(text, d)).toMatch(/\nCartesian\n/);
  });
});

describe('meshKpoints', async () => {
  const { meshKpoints } = await import('../../src/core/kpoints/generate');
  const { formatKpoints } = await import('../../src/core/kpoints/format');
  it('writes a valid, formatted Γ-centred mesh', () => {
    const si = parsePoscar('Si\n5.43\n0 0.5 0.5\n0.5 0 0.5\n0.5 0.5 0\nSi\n2\nDirect\n0 0 0\n0.25 0.25 0.25\n').structure!;
    const text = meshKpoints(si, 0.3);
    expect(text.split('\n').slice(1, 5)).toEqual(['0', 'Gamma', '7 7 7', '0 0 0']);
    expect(lintKpoints(text, si)).toEqual([]);
    expect(formatKpoints(text)).toBe(text);
  });
});
