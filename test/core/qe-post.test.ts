import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatQe } from '../../src/core/qe/format';
import { parseQe } from '../../src/core/qe/parse';
import { cardsOf, type QeProgram } from '../../src/core/qe/tags';
import { validateQe } from '../../src/core/qe/validate';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'qe', name), 'utf8');
const parse = (t: string, program: QeProgram) => parseQe(t, { cards: cardsOf(program) });
const check = (program: QeProgram, text: string, pw?: string) => validateQe(parse(text, program), program, { pw: pw ? parse(pw, 'pw') : undefined });
const codes = (program: QeProgram, text: string, pw?: string) => check(program, text, pw).map((d) => d.code);

const pw = (extra: { control?: string; system?: string; kpoints?: string; calc?: string } = {}) =>
  `&CONTROL\ncalculation = '${extra.calc ?? 'nscf'}'${extra.control ? ', ' + extra.control : ''}\nprefix = 'si'\noutdir = './tmp'\n/\n&SYSTEM\nibrav = 2, celldm(1) = 10.2, nat = 2, ntyp = 1, ecutwfc = 25${extra.system ? ', ' + extra.system : ''}\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\nSi 0.25 0.25 0.25\n${extra.kpoints ?? 'K_POINTS automatic\n8 8 8 0 0 0\n'}`;

describe('the post-processing fixtures', () => {
  it('are accepted, also against a matching pw.x run', () => {
    for (const [program, file] of [['dos', 'dos.in'], ['projwfc', 'projwfc.in'], ['bands', 'bands.pp.in']] as const) {
      expect(codes(program, fixture(file)), file).toEqual([]);
      expect(codes(program, fixture(file), pw({ calc: program === 'bands' ? 'bands' : 'nscf' })), file).toEqual([]);
    }
  });

  it('know the variables of each program, and accept the ones QE reads but does not document', () => {
    expect(codes('dos', '&DOS\n prefix = "x"\n bz_sum = "tetrahedra"\n ecutwfc = 30\n/\n')).toEqual(['qe-unknown-variable']);
    expect(codes('projwfc', "&PROJWFC\n prefix = 'x'\n lforcet = .false.\n/\n")).toEqual([]);
    expect(codes('bands', "&BANDS\n prefix = 'x'\n filband = 'b.dat'\n lp = .true.\n/\n")).toEqual([]);
  });

  it('format like every namelist input', () => {
    expect(formatQe("&dos\nprefix='si',Emin=-5.0,Emax=15\n/\n")).toBe("&DOS\n  prefix = 'si'\n  Emin   = -5.0\n  Emax   = 15\n/\n");
    for (const f of ['dos.in', 'projwfc.in', 'bands.pp.in']) {
      const once = formatQe(fixture(f))!;
      expect(formatQe(once), f).toBe(once);
    }
  });
});

describe('projwfc.x', () => {
  const p = (body: string) => `&PROJWFC\n prefix = 'si', outdir = './tmp'\n ${body}\n/\n`;
  it('refuses the combinations QE refuses', () => {
    expect(codes('projwfc', p('pawproj = .true., lforcet = .true., lsym = .false.'))).toEqual(['qe-post-incompatible']);
    expect(codes('projwfc', p('pawproj = .true., tdosinboxes = .true.'))).toEqual(['qe-post-incompatible']);
    expect(codes('projwfc', p('lforcet = .true., tdosinboxes = .true., lsym = .false.'))).toEqual(['qe-post-incompatible']);
    expect(codes('projwfc', p('diag_basis = .true., pawproj = .true.'))).toEqual(['qe-post-incompatible']);
  });

  it('needs lsym = .false. for lforcet, which is true unless said otherwise', () => {
    expect(codes('projwfc', p('lforcet = .true.'))).toEqual(['qe-post-incompatible']);
    expect(codes('projwfc', p('lforcet = .true., lsym = .true.'))).toEqual(['qe-post-incompatible']);
    expect(codes('projwfc', p('lforcet = .true., lsym = .false.'))).toEqual([]);
  });

  it('notes lbinary_data', () => {
    expect(check('projwfc', p('lbinary_data = .true.')).map((d) => `${d.code}:${d.severity}`)).toEqual(['qe-post-binary:info']);
  });

  it('is compared with the pw.x run', () => {
    expect(codes('projwfc', p(''), pw({ control: "disk_io = 'nowf'" }))).toEqual(['qe-projwfc-wfc']);
    expect(codes('projwfc', p(''), pw({ control: "disk_io = 'low'" }))).toEqual([]);
    expect(codes('projwfc', p('pawproj = .true.'), pw({ system: 'noncolin = .true.' }))).toEqual(['qe-post-incompatible']);
    expect(codes('projwfc', p('diag_basis = .true.'), pw({ kpoints: 'K_POINTS gamma\n' }))).toEqual(['qe-post-incompatible']);
  });
});

describe('bands.x', () => {
  const b = (body: string) => `&BANDS\n prefix = 'si', outdir = './tmp'\n ${body}\n/\n`;
  it('needs spin_component 1 or 2', () => {
    expect(codes('bands', b('spin_component = 3'))).toEqual(['qe-bands-spin']);
    expect(codes('bands', b('spin_component = 2'))).toEqual([]);
  });

  it('is compared with the pw.x run', () => {
    expect(codes('bands', b(''), pw({ calc: 'bands' }))).toEqual([]);
    expect(codes('bands', b(''), pw({ calc: 'bands', kpoints: 'K_POINTS gamma\n' }))).toEqual(['qe-bands-gamma']);
    expect(codes('bands', b('lsigma = .true.'), pw({ calc: 'bands' }))).toEqual(['qe-bands-lsigma']);
    expect(codes('bands', b('lsigma = .true.'), pw({ calc: 'bands', system: 'noncolin = .true.' }))).toEqual([]);
    expect(codes('bands', b('spin_component = 2'), pw({ calc: 'bands' }))).toEqual(['qe-bands-spin']);
    expect(codes('bands', b('spin_component = 2'), pw({ calc: 'bands', system: 'nspin = 2' }))).toEqual([]);
    expect(check('bands', b(''), pw({ calc: 'scf' })).map((d) => `${d.code}:${d.severity}`)).toEqual(['qe-bands-scf:info']);
  });
});

describe('dos.x', () => {
  const d = (body: string) => `&DOS\n prefix = 'si', outdir = './tmp'\n ${body}\n/\n`;
  it('needs an automatic grid for tetrahedra', () => {
    const list = 'K_POINTS crystal\n1\n0 0 0 1\n';
    expect(codes('dos', d("bz_sum = 'tetrahedra_opt'"), pw())).toEqual([]);
    expect(codes('dos', d("bz_sum = 'tetrahedra_opt'"), pw({ kpoints: list }))).toEqual(['qe-dos-tetra']);
    expect(codes('dos', d("bz_sum = 'tetrahedra_lin'"), pw({ kpoints: list }))).toEqual(['qe-dos-tetra']);
    // With a broadening (degauss), the grid is not needed.
    expect(codes('dos', d("bz_sum = 'smearing', degauss = 0.02"), pw({ kpoints: list }))).toEqual([]);
    expect(codes('dos', d(''), pw({ kpoints: list }))).toEqual([]);
  });

  it('compares prefix and outdir', () => {
    expect(codes('dos', d('').replace("prefix = 'si'", "prefix = 'ge'"), pw())).toEqual(['qe-post-prefix']);
    expect(codes('dos', d('').replace("'./tmp'", "'/scratch'"), pw())).toEqual(['qe-post-outdir']);
  });
});
