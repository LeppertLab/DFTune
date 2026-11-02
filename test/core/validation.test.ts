import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIncar } from '../../src/core/incar/parse';
import { describeKpoints, meshSize, readKpoints, type KpointsInfo } from '../../src/core/kpoints/read';
import { readPoscar, type PoscarInfo } from '../../src/core/poscar/read';
import { TAG_DEFS } from '../../src/core/tags/definitions';
import { wikiValueType } from '../../src/core/tags/known';
import { WIKI_TAGS } from '../../src/core/tags/wikiTags.generated';
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

describe('KPOINTS', () => {
  it('reads the common formats', () => {
    expect(readKpoints(fixture('KPOINTS'))).toEqual({ mode: 'mesh', centering: 'gamma', subdivisions: [4, 4, 4] });
    expect(readKpoints('mp\n0\nMonkhorst-pack\n 6 6 1\n')).toEqual({ mode: 'mesh', centering: 'monkhorst-pack', subdivisions: [6, 6, 1] });
    expect(readKpoints('auto\n0\nAuto\n  30\n')).toEqual({ mode: 'auto', length: 30 });
    expect(readKpoints(fixture('KPOINTS.bands'))).toEqual({ mode: 'line', points: 40 });
    expect(readKpoints('ibz\n2\nReciprocal\n0 0 0 1\n0.5 0 0 1\nTetrahedra\n')).toEqual({ mode: 'explicit', nkpts: 2, tetrahedra: true });
    expect(readKpoints('not a KPOINTS file\nabc\n')).toBeUndefined();
  });

  it('summarizes and sizes meshes', () => {
    const k = readKpoints(fixture('KPOINTS'))!;
    expect(describeKpoints(k)).toBe('Γ-centred 4×4×4 mesh');
    expect(meshSize(k)).toBe(64);
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
    expect(codes('NSW = ten\nLWAVE = yes\nISPIN = 3\n').filter((c) => c === 'bad-value')).toHaveLength(2);
    expect(codes('ISPIN = 3\n')).toContain('unknown-option');
    expect(codes('NSW = 1\nNSW = 2\n')).toContain('duplicate');
    expect(codes('MAGMOM = x*1\n')).toContain('bad-value');
  });

  it('suggests a known tag for typos', () => {
    const ds = validate(parseIncar('ENCTU = 400\nLWANNIER90 = .TRUE.\n'));
    expect(ds.filter((d) => d.code === 'unknown-tag').map((d) => d.message)).toEqual(['Unknown tag ENCTU. Did you mean ENCUT?']);
  });

  it('accepts valid but uncommon tags', () => {
    const text = [
      'POMASS = 2.014 15.999', // deuterated water
      'LVTOT = .TRUE.',
      'LIBXC1_P3 = 0.5', // numbered family documented as LIBXC1_Pn
      'XC2_P1 = 0.2',
      'KERNEL_TRUNCATION/LTRUNCATE = .TRUE.', // grouped tag, VASP 6.5
      'IOPT = 3', // VTST
      'LCLIMB = .TRUE.',
      'LSOL = .TRUE.', // VASPsol
      'EB_K = 78.4',
      '',
    ].join('\n');
    const doc = parseIncar(text);
    expect(doc.issues).toEqual([]);
    expect(validate(doc).filter((d) => d.code === 'unknown-tag')).toEqual([]);
    // The same grouped tags written as a block.
    const block = validate(parseIncar('KERNEL_TRUNCATION {\n  LTRUNCATE = T\n  IDIMENSIONALITY = 2\n}\n'));
    expect(block.filter((d) => ['syntax', 'unknown-tag', 'bad-value'].includes(d.code))).toEqual([]);
  });

  it('notes undocumented tags and prefers common tags for suggestions', () => {
    const ds = validate(parseIncar('MY_CUSTOM_FLAG = 1\nISMAER = 0\n'));
    expect(ds.filter((d) => d.code === 'unknown-tag').map((d) => [d.severity, d.message])).toEqual([
      ['info', 'MY_CUSTOM_FLAG is not a documented VASP tag; VASP ignores tags it does not know.'],
      ['warning', 'Unknown tag ISMAER. Did you mean ISMEAR?'],
    ]);
  });

  it('warns about deprecated tags', () => {
    const ds = validate(parseIncar('ML_ISTART = 0\nENAUG = 600\n'));
    expect(ds.filter((d) => d.code === 'deprecated').map((d) => d.message)).toEqual([
      expect.stringMatching(/^ML_ISTART is deprecated: .*ML_MODE/),
      expect.stringMatching(/^ENAUG is deprecated/),
    ]);
  });

  it('checks values of uncurated tags against the wiki type', () => {
    expect(codes('LSCK = yes\n')).toContain('bad-value'); // logical
    expect(codes('NOMEGA = 50.5\n')).toContain('bad-value'); // integer
    expect(codes('ENCUTGW = high\n')).toContain('bad-value'); // real
    expect(codes('LSCK = .TRUE.\nNOMEGA = 50\nENCUTGW = 300\n')).not.toContain('bad-value');
  });

  it('accepts the wiki defaults of uncurated tags', () => {
    for (const [name, [, type, def]] of Object.entries(WIKI_TAGS)) {
      const t = wikiValueType(type);
      // Only literal defaults; many are prose ("set in accordance with PREC").
      if (!t || !/^(-?[\d.]+([eEdD][-+]?\d+)?|\.(TRUE|FALSE)\.)$/i.test(def)) continue;
      expect(checkValue({ name, type: t, category: 'general', summary: '' }, def), `${name} = ${def}`).toBeUndefined();
    }
  });

  it('recognizes older tag names', () => {
    const ds = validate(parseIncar('ML_FF_LMLFF = .TRUE.\nLVDW = .TRUE.\n'));
    expect(ds.filter((d) => d.code === 'unknown-tag')).toEqual([]);
    expect(ds.filter((d) => d.code === 'alias').map((d) => d.message)).toEqual([
      'ML_FF_LMLFF is an older or alternative name for ML_LMLFF; check that your VASP version still reads it.',
      'LVDW is an older or alternative name for IVDW; check that your VASP version still reads it.',
    ]);
  });

  it('checks phonon and linear-response setups', () => {
    expect(codes('IBRION = 6\nISIF = 3\n')).toContain('phonon-ediff');
    expect(codes('IBRION = 6\nISIF = 3\nEDIFF = 1E-7\n')).not.toContain('phonon-ediff');
    expect(codes('IBRION = 6\nISIF = 3\nEDIFF = 1E-7\n')).not.toContain('isif-static');
    expect(codes('IBRION = 7\nEDIFF = 1E-7\n')).toContain('phonon-symmetry');
    expect(codes('LEPSILON = .TRUE.\nLHFCALC = .TRUE.\n')).toContain('lepsilon-hybrid');
    expect(codes('LEPSILON = .TRUE.\nLOPTICS = .TRUE.\n')).toContain('lepsilon-loptics');
    expect(codes('LOPTICS = .TRUE.\nISMEAR = -2\n')).toContain('loptics-ismear');
  });

  it('checks the INCAR against the KPOINTS file', () => {
    const kcodes = (text: string, kpoints: KpointsInfo | null) => validate(parseIncar(text), { kpoints }).map((d) => d.code);
    const gamma = readKpoints(fixture('KPOINTS'))!;
    const mp = readKpoints('mp\n0\nMonkhorst-Pack\n6 6 6\n')!;
    const single = readKpoints('gamma only\n0\nGamma\n1 1 1\n')!;
    const line = readKpoints(fixture('KPOINTS.bands'))!;

    expect(kcodes('KSPACING = 0.3\n', gamma)).toContain('kspacing-ignored');
    expect(kcodes('KSPACING = 0.3\n', null)).not.toContain('kspacing-ignored');
    expect(kcodes('ISMEAR = 0\n', null)).toContain('no-kpoints');
    expect(kcodes('ISMEAR = 0\n', undefined as never)).not.toContain('no-kpoints');
    expect(kcodes('ISMEAR = 0\n', line)).toContain('line-mode-scf');
    expect(kcodes('ISMEAR = 0\nICHARG = 11\n', line)).not.toContain('line-mode-scf');

    expect(kcodes('ISMEAR = -5\n', mp)).toContain('tetra-mesh');
    expect(kcodes('ISMEAR = -5\nKGAMMA = .FALSE.\n', null)).toContain('tetra-mesh');
    expect(kcodes('ISMEAR = -5\n', gamma)).not.toContain('tetra-mesh');
    expect(kcodes('ISMEAR = -5\n', single)).toContain('tetra-few-k');
    expect(kcodes('ISMEAR = 0\n', single)).not.toContain('tetra-few-k');
  });

  it('keeps errors for what stops VASP', () => {
    const severities = (text: string) => validate(parseIncar(text), { poscar }).map((d) => `${d.code}:${d.severity}`);
    // Too few values stop VASP while reading; extra values are ignored (POSCAR: Fe, O).
    expect(severities('LANGEVIN_GAMMA = 10\n')).toContain('species-length:error');
    expect(severities('LANGEVIN_GAMMA = 10 10 10\n')).toContain('species-length:warning');
    expect(severities('ISPIN = 2\nMAGMOM = 20*1\n')).toContain('magmom-length:warning');
    expect(severities('ISPIN = 2\nMAGMOM = 2*1\n')).toContain('magmom-length:error');
    // VASP skips lines without '=', so the tag is just not set.
    expect(severities('ENCUT 400\n')).toContain('syntax:warning');
  });

  it('checks POMASS against the POSCAR species', () => {
    expect(codes('POMASS = 55.8 16.0\n', poscar)).not.toContain('species-length');
    expect(codes('POMASS = 55.8\n', poscar)).toContain('species-length');
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
