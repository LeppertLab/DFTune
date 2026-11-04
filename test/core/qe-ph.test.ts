import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatQe } from '../../src/core/qe/format';
import { parseQe } from '../../src/core/qe/parse';
import { cardsOf } from '../../src/core/qe/tags';
import { validateQe } from '../../src/core/qe/validate';

const dir = join(__dirname, '..', 'fixtures', 'qe');
const fixture = (name: string) => readFileSync(join(dir, name), 'utf8');
const parse = (t: string, program: 'pw' | 'ph' = 'ph') => parseQe(t, { cards: cardsOf(program) });
const check = (text: string, pw?: string) => validateQe(parse(text), 'ph', { pw: pw ? parse(pw, 'pw') : undefined });
const codes = (text: string, pw?: string) => check(text, pw).map((d) => d.code);
const apply = (text: string, code: string) => {
  const d = check(text).find((x) => x.code === code);
  expect(d?.fix, `${code} has a fix`).toBeDefined();
  return text.slice(0, d!.fix!.edit.start) + d!.fix!.edit.text + text.slice(d!.fix!.edit.end);
};
const ph = (namelist: string, tail = '', title = 'phonons') => `${title}\n&inputph\n${namelist}\n/\n${tail}`;

describe('ph.x input', () => {
  it('accepts the fixtures', () => {
    expect(check(fixture('ph.in'))).toEqual([]);
    expect(check(fixture('ph.grid.in'))).toEqual([]);
  });

  it('knows the variables of ph.x and reports unknown ones', () => {
    expect(codes(ph("prefix = 'x', ldisp = .true., nq1 = 2, nq2 = 2, nq3 = 2, epsil = .false.", ''))).toEqual([]);
    expect(codes(ph("prefix = 'x', ldispp = .true.", '0 0 0\n'))).toEqual(['qe-unknown-variable']);
    expect(codes(ph("prefix = 'x', ecutwfc = 30", '0 0 0\n'))).toEqual(['qe-unknown-variable']);
  });

  it('requires the title line', () => {
    const noTitle = '&inputph\n prefix = "x"\n/\n0 0 0\n';
    expect(codes(noTitle)).toEqual(['qe-ph-title']);
    const fixed = apply(noTitle, 'qe-ph-title');
    expect(fixed.split('\n')[0]).toBe('phonons of x');
    expect(codes(fixed)).not.toContain('qe-ph-title');
    expect(codes('! a comment is a title too\n&inputph\n/\n0 0 0\n')).toEqual([]);
  });

  it('needs the q point after the namelist unless ldisp', () => {
    expect(codes(ph("prefix = 'x'"))).toEqual(['qe-ph-xq']);
    expect(codes(apply(ph("prefix = 'x'"), 'qe-ph-xq'))).toEqual([]);
    expect(codes(ph("prefix = 'x'", '0.5 0 0\n'))).toEqual([]);
    expect(codes(ph("prefix = 'x'", '0.5 0\n'))).toEqual(['qe-ph-xq']);
    expect(codes(ph("prefix = 'x'", 'gamma\n'))).toEqual(['qe-ph-xq']);
    expect(codes(ph("prefix = 'x', ldisp = .true., nq1 = 2, nq2 = 2, nq3 = 2", '0 0 0\n'))).toEqual(['qe-ph-xq-ignored']);
  });

  it('checks q-point paths (qplot)', () => {
    const base = "prefix = 'x', qplot = .true., ldisp = .true., nq1 = 2, nq2 = 2, nq3 = 2";
    expect(codes(ph(base, '2\n0 0 0 10\n0.5 0 0 1\n'))).toEqual([]);
    expect(codes(ph(base, '3\n0 0 0 10\n0.5 0 0 1\n'))).toEqual(['qe-ph-xq']);
    expect(codes(ph(base, '1\n0 0 0\n'))).toEqual(['qe-ph-xq']);
    expect(codes(ph(base, ''))).toEqual(['qe-ph-xq']);
  });

  it('requires nq1, nq2, nq3 for ldisp', () => {
    expect(codes(ph("prefix = 'x', ldisp = .true.", ''))).toEqual(['qe-ph-nq']);
    expect(codes(ph("prefix = 'x', ldisp = .true., nq1 = 4, nq2 = 4", ''))).toEqual(['qe-ph-nq']);
    expect(codes(ph("prefix = 'x', ldisp = .true., nq1 = 4, nq2 = 4, nq3 = 0", ''))).toEqual(['qe-ph-nq']);
  });

  it('needs Γ for the electric-field options', () => {
    expect(codes(ph("prefix = 'x', epsil = .true.", '0 0 0\n'))).toEqual([]);
    expect(codes(ph("prefix = 'x', epsil = .true.", '0.5 0 0\n'))).toEqual(['qe-ph-gamma']);
    expect(codes(ph("prefix = 'x', epsil = .true., ldisp = .true., nq1 = 2, nq2 = 2, nq3 = 2", ''))).toEqual([]);
  });

  it('checks combinations that QE refuses', () => {
    expect(codes(ph("prefix = 'x', zue = .true., trans = .false.", '0 0 0\n'))).toEqual(['qe-ph-zue']);
    expect(codes(ph("prefix = 'x', modenum = 2, ldisp = .true., nq1 = 2, nq2 = 2, nq3 = 2", ''))).toEqual(['qe-ph-modenum']);
    expect(codes(ph("prefix = 'x', only_init = .true., only_wfc = .true.", '0 0 0\n'))).toContain('qe-ph-only');
    expect(codes(ph("prefix = 'x', tr2_ph = 0", '0 0 0\n'))).toEqual(['qe-ph-tr2']);
    expect(codes(ph("prefix = 'x', start_q = 0", '0 0 0\n'))).toEqual(['qe-ph-start']);
    expect(check(ph("prefix = 'x', tr2_ph = 1.0d-6", '0 0 0\n')).find((d) => d.code === 'qe-ph-tr2')?.severity).toBe('info');
  });

  it('formats like the other inputs, leaving the title and the q point', () => {
    expect(formatQe("my title\n&inputph\nprefix='si',outdir='./tmp'\n/\n0.0 0.0 0.0\n")).toBe("my title\n&INPUTPH\n  prefix = 'si'\n  outdir = './tmp'\n/\n0.0 0.0 0.0\n");
    for (const f of readdirSync(dir).filter((n) => n.startsWith('ph'))) {
      const once = formatQe(fixture(f))!;
      expect(formatQe(once), f).toBe(once);
    }
  });
});

describe('ph.x against the pw.x input', () => {
  const pw = (control = '', electrons = '', system = '') =>
    `&CONTROL\ncalculation = 'scf'${control ? ', ' + control : ''}\nprefix = 'si'\noutdir = './tmp'\n/\n&SYSTEM\nibrav = 2, celldm(1) = 10.2, nat = 2, ntyp = 1, ecutwfc = 25${system ? ', ' + system : ''}\n/\n&ELECTRONS\nconv_thr = ${electrons || '1.0d-14'}\n/\nATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\nSi 0.25 0.25 0.25\nK_POINTS gamma\n`;

  it('accepts a matching pair', () => {
    expect(codes(fixture('ph.in'), pw())).toEqual([]);
    expect(codes(fixture('ph.in'), fixture('si.scf.in').replace("prefix = 'si'          ! the prefix", "prefix = 'si'").replace("outdir = './tmp/'", "outdir = './tmp'").replace('conv_thr =  1.0d-8', 'conv_thr = 1.0d-12'))).toEqual([]);
  });

  it('compares prefix and outdir', () => {
    expect(codes(fixture('ph.in'), pw().replace("prefix = 'si'", "prefix = 'ge'"))).toEqual(['qe-post-prefix']);
    expect(codes(fixture('ph.in'), pw().replace("outdir = './tmp'", "outdir = '/scratch/si'"))).toEqual(['qe-post-outdir']);
    // The defaults are the same on both sides, and spellings of the same directory agree.
    expect(codes("t\n&inputph\n/\n0 0 0\n", "&CONTROL\n/\n&SYSTEM\n/\n&ELECTRONS\nconv_thr = 1d-14\n/\n")).toEqual([]);
    expect(codes(fixture('ph.in'), pw().replace("outdir = './tmp'", "outdir = 'tmp/'"))).toEqual([]);
  });

  it('wants an scf run with a tight convergence', () => {
    expect(codes(fixture('ph.in'), pw().replace("'scf'", "'nscf'"))).toEqual(['qe-ph-pw-calc']);
    expect(codes(fixture('ph.in'), pw('', '1.0d-6'))).toEqual(['qe-ph-conv']);
  });

  it('refuses the electric field for metals', () => {
    const epsil = fixture('ph.in').replace('tr2_ph', "epsil = .true.\n  tr2_ph");
    expect(codes(epsil, pw())).toEqual([]);
    expect(codes(epsil, pw('', '', "occupations = 'smearing', degauss = 0.02"))).toEqual(['qe-ph-metal']);
  });
});
