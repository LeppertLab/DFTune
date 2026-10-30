import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIncar } from '../../src/core/incar/parse';
import { readPoscar, type PoscarInfo } from '../../src/core/poscar/read';
import { TAG_DEFS } from '../../src/core/tags/definitions';
import { checkValue, validate } from '../../src/core/validation/rules';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');
const poscar = readPoscar(fixture('POSCAR'))!;
const codes = (text: string, p?: PoscarInfo) => validate(parseIncar(text), { poscar: p }).map((d) => d.code);

describe('POSCAR', () => {
  it('reads species and counts', () => {
    expect(poscar).toEqual({ comment: 'Fe3O4 primitive', species: ['Fe', 'O'], counts: [6, 8], nions: 14 });
  });

  it('reads VASP 4 files and hashed species names', () => {
    const lines = fixture('POSCAR').split('\n');
    const vasp4 = [...lines.slice(0, 5), ...lines.slice(6)].join('\n');
    expect(readPoscar(vasp4)).toMatchObject({ species: undefined, counts: [6, 8], nions: 14 });
    lines[5] = 'Fe_pv/1a2b3c O/4d5e6f';
    expect(readPoscar(lines.join('\n'))?.species).toEqual(['Fe', 'O']);
  });
});

describe('validation', () => {
  it('finds nothing to complain about in the fixtures', () => {
    for (const name of ['INCAR', 'INCAR.hse_bands', 'INCAR.mlff_train']) {
      const ds = validate(parseIncar(fixture(name)), { poscar: name === 'INCAR' ? poscar : undefined });
      expect(ds.filter((d) => d.severity === 'error' || d.severity === 'warning'), name).toEqual([]);
    }
  });

  it('flags syntax errors, bad values and duplicates', () => {
    expect(codes('ENCUT 400\n')).toContain('syntax');
    expect(codes('NSW = ten\nLWAVE = yes\nISPIN = 3\n').filter((c) => c === 'bad-value')).toHaveLength(3);
    expect(codes('NSW = 1\nNSW = 2\n')).toContain('duplicate');
    expect(codes('MAGMOM = x*1\n')).toContain('bad-value');
  });

  it('suggests a known tag for typos but ignores unknown tags otherwise', () => {
    const ds = validate(parseIncar('ENCTU = 400\nLWANNIER90 = .TRUE.\n'));
    expect(ds.filter((d) => d.code === 'unknown-tag').map((d) => d.message)).toEqual(['Unknown tag ENCTU. Did you mean ENCUT?']);
  });

  it('accepts equivalent spellings', () => {
    expect(codes('LREAL = A\nLWAVE = F\nEDIFF = 1d-6\n')).not.toContain('bad-value');
  });

  it.each([
    ['nsw-without-ibrion', 'NSW = 10\n'],
    ['md-potim', 'IBRION = 0\nNSW = 10\n'],
    ['md-tebeg', 'IBRION = 0\nNSW = 10\nPOTIM = 1\n'],
    ['md-isym', 'IBRION = 0\nNSW = 10\nPOTIM = 1\nTEBEG = 300\n'],
    ['md-langevin', 'IBRION = 0\nNSW = 10\nMDALGO = 3\n'],
    ['isif-static', 'ISIF = 3\n'],
    ['pulay', 'IBRION = 2\nNSW = 10\nISIF = 3\n'],
    ['tetra-forces', 'IBRION = 2\nNSW = 10\nISMEAR = -5\n'],
    ['default-mp', 'ENCUT = 400\n'],
    ['large-sigma', 'ISMEAR = 1\nSIGMA = 0.5\n'],
    ['metagga-lasph', 'METAGGA = R2SCAN\n'],
    ['gga-and-metagga', 'GGA = PE\nMETAGGA = SCAN\nLASPH = T\n'],
    ['hybrid-off', 'HFSCREEN = 0.2\n'],
    ['hybrid-algo', 'LHFCALC = .TRUE.\nALGO = VeryFast\n'],
    ['magmom-unused', 'MAGMOM = 14*1\n'],
    ['soc-ispin', 'LSORBIT = .TRUE.\nISPIN = 2\n'],
    ['magmom-length', 'ISPIN = 2\nMAGMOM = 13*1\n'],
    ['species-length', 'LDAU = .TRUE.\nLDAUL = 2\nLDAUU = 4\nLMAXMIX = 4\n'],
    ['ldau-off', 'LDAUU = 4 0\n'],
    ['ldau-incomplete', 'LDAU = .TRUE.\n'],
    ['ldau-lmaxmix', 'LDAU = .TRUE.\nLDAUL = 2 -1\nLDAUU = 4 0\n'],
    ['nonscf-ionic', 'ICHARG = 11\nIBRION = 2\nNSW = 5\n'],
    ['ncore-npar', 'NCORE = 4\nNPAR = 2\n'],
  ])('rule %s', (code, text) => {
    expect(codes(text, poscar)).toContain(code);
  });

  it('checks noncollinear MAGMOM length (3 per atom)', () => {
    expect(codes('LNONCOLLINEAR = .TRUE.\nMAGMOM = 42*0\n', poscar)).not.toContain('magmom-length');
    expect(codes('LNONCOLLINEAR = .TRUE.\nMAGMOM = 14*0\n', poscar)).toContain('magmom-length');
  });

  it('suggests LREAL = Auto only for large cells', () => {
    const big = { ...poscar, counts: [30], nions: 30 };
    expect(codes('ISMEAR = 0\n', big)).toContain('lreal-large');
    expect(codes('ISMEAR = 0\n', poscar)).not.toContain('lreal-large');
  });
});

describe('tag definitions', () => {
  it('have unique names and valid defaults', () => {
    const names = TAG_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const def of TAG_DEFS) {
      expect(def.name).toBe(def.name.toUpperCase());
      if (def.default !== undefined) expect(checkValue({ ...def, open: true }, def.default), def.name).toBeUndefined();
      for (const opt of def.options ?? []) expect(checkValue(def, opt.value), `${def.name}=${opt.value}`).toBeUndefined();
    }
  });
});
