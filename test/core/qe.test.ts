import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQe } from '../../src/core/qe/parse';
import { cardsOf, detectProgram, lookupVar, namelistsDefining, namelistsOf, varsOf } from '../../src/core/qe/tags';
import { validateQe } from '../../src/core/qe/validate';
import { checkItem, parseLogical, valueItems } from '../../src/core/qe/values';

const dir = join(__dirname, '..', 'fixtures', 'qe');
const fixtures = readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
const parse = (text: string) => parseQe(text, { cards: cardsOf('pw') });
const check = (text: string) => validateQe(parse(text), 'pw');
const codes = (text: string) => check(text).map((d) => d.code);

/** A pw.x input with the given extra lines in &CONTROL / &SYSTEM / &ELECTRONS. */
const input = (control = '', system = '', electrons = '', tail = '') =>
  `&CONTROL\n${control}\n/\n&SYSTEM\nibrav = 2, celldm(1) = 10.2, nat = 2, ntyp = 1, ecutwfc = 25\n${system}\n/\n&ELECTRONS\n${electrons}\n/\nATOMIC_SPECIES\nSi 28.08 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\nSi 0.25 0.25 0.25\nK_POINTS automatic\n4 4 4 0 0 0\n${tail}`;

describe('QE tag table', () => {
  it('knows the namelists, cards and variables of pw.x', () => {
    expect(namelistsOf('pw')).toEqual(['CONTROL', 'SYSTEM', 'ELECTRONS', 'IONS', 'CELL', 'FCP', 'RISM']);
    expect(cardsOf('pw')).toContain('K_POINTS');
    expect(varsOf('pw', 'SYSTEM').length).toBeGreaterThan(100);
    expect(lookupVar('pw', 'SYSTEM', 'ECUTWFC')).toMatchObject({ name: 'ecutwfc', type: 'real', required: true });
    expect(lookupVar('pw', 'SYSTEM', 'celldm')).toMatchObject({ dim: '1:6', type: 'real' });
    expect(lookupVar('pw', 'CONTROL', 'calculation')?.options.map((o) => o.value)).toContain('vc-relax');
    expect(namelistsDefining('pw', 'ecutwfc')).toEqual(['SYSTEM']);
  });

  it('detects the program from the first namelist', () => {
    expect(detectProgram('! x\n&CONTROL\n/')).toBe('pw');
    expect(detectProgram('title\n &inputph\n/')).toBe('ph');
    expect(detectProgram('&DOS\n/')).toBe('dos');
    expect(detectProgram('nothing here')).toBeUndefined();
  });
});

describe('Fortran values', () => {
  it('reads logicals, numbers and lists', () => {
    expect(['.true.', '.T.', 't', 'True', '.FALSE.', 'f', 'x'].map(parseLogical)).toEqual([true, true, true, true, false, false, undefined]);
    expect(valueItems("'a b', 'c' 3*0.5 2.0")).toEqual(["'a b'", "'c'", '3*0.5', '2.0']);
    expect(checkItem('real', '1.d-6')).toBeUndefined();
    expect(checkItem('real', '.5')).toBeUndefined();
    expect(checkItem('integer', '4.0')).toMatch(/integer/);
    expect(checkItem('logical', 'yes')).toMatch(/\.true\./);
  });
});

describe('parseQe', () => {
  it('reads namelists, entries and cards of the fixtures', () => {
    const doc = parse(fixtures.find(([n]) => n === 'si.scf.in')![1]);
    expect(doc.namelists.map((n) => [n.name, n.closed, n.entries.length])).toEqual([['CONTROL', true, 5], ['SYSTEM', true, 5], ['ELECTRONS', true, 4]]);
    expect(doc.cards.map((c) => [c.name, c.option, c.lines.length])).toEqual([['ATOMIC_SPECIES', undefined, 1], ['ATOMIC_POSITIONS', 'alat', 2], ['K_POINTS', 'automatic', 1]]);
    expect(doc.issues).toEqual([]);
    const system = doc.namelists[1].entries;
    expect(system.map((e) => e.name)).toEqual(['ibrav', 'celldm', 'nat', 'ntyp', 'ecutwfc']);
    expect(system[1]).toMatchObject({ name: 'celldm', index: '1', value: '10.26' });
  });

  it('gives spans that point at the text', () => {
    const text = input('calculation = "scf"');
    const doc = parse(text);
    const e = doc.namelists[0].entries[0];
    expect(text.slice(e.keySpan.start, e.keySpan.end)).toBe('calculation');
    expect(text.slice(e.valueSpan.start, e.valueSpan.end)).toBe('"scf"');
  });

  it('handles comments, strings with special characters and several entries per line', () => {
    const doc = parse("&CONTROL\n title = 'a ! b / c', prefix='x' ! trailing\n/\n");
    expect(doc.namelists[0].entries.map((e) => [e.name, e.value])).toEqual([['title', "'a ! b / c'"], ['prefix', "'x'"]]);
  });

  it('accepts &END, option spellings of cards and ignores comments in cards', () => {
    const doc = parse('&CONTROL\n&END\nK_POINTS (gamma)\n! c\n# c\nATOMIC_POSITIONS{bohr}\n Si 0 0 0 ! first\n');
    expect(doc.namelists[0].closed).toBe(true);
    expect(doc.cards.map((c) => [c.name, c.option, c.lines.map((l) => l.text.trim())])).toEqual([['K_POINTS', 'gamma', []], ['ATOMIC_POSITIONS', 'bohr', ['Si 0 0 0']]]);
  });

  it('reports syntax problems', () => {
    const issues = (t: string) => parse(t).issues.map((i) => i.code);
    expect(issues('&CONTROL\n calculation = "scf\n/\n')).toEqual(['qe-string']);
    expect(issues('&CONTROL\n calculation "scf"\n/\n')).toEqual(['qe-syntax', 'qe-syntax']);
    expect(issues('&CONTROL\n prefix = "x"\n&SYSTEM\n/\n')).toEqual(['qe-unterminated']);
    expect(issues('&CONTROL\n prefix = "x"\nATOMIC_SPECIES\n')).toEqual(['qe-unterminated']);
  });
});

describe('validateQe', () => {
  it('accepts the fixtures', () => {
    for (const [name, text] of fixtures) expect(check(text).filter((d) => d.severity === 'error'), name).toEqual([]);
    expect(check(fixtures.find(([n]) => n === 'si.scf.in')![1])).toEqual([]);
  });

  it('knows array variables and the Fortran spellings VASP-style checks would trip over', () => {
    expect(codes(input("calculation = 'scf'", "celldm(2) = 1.0, starting_magnetization(1) = 0.5, nspin = 2, occupations = 'smearing', degauss = 0.02", 'conv_thr = 1.D-8'))).toEqual([]);
    expect(codes(input('', 'occupations = "smearing", smearing = "mv", degauss = 0.01, input_dft = "pbe"'))).toEqual([]);
  });

  it('reports unknown and misplaced variables, with a fix for typos', () => {
    const typo = check(input('', 'ecutwfx = 30'));
    const d = typo.find((x) => x.code === 'qe-unknown-variable')!;
    expect(d.message).toMatch(/Did you mean ecutwfc\?/);
    expect(d.fix?.edit.text).toBe('ecutwfc');
    expect(check(input('ecutrho = 100')).find((x) => x.code === 'qe-misplaced')?.message).toMatch(/belongs in &SYSTEM, not &CONTROL/);
    expect(check(input('', 'qwertyuiop = 1')).find((x) => x.code === 'qe-unknown-variable')?.message).toMatch(/not a variable of &SYSTEM/);
  });

  it('checks values: type, count, index, empty', () => {
    expect(check(input('', 'nbnd = 4.5')).find((d) => d.code === 'qe-value')?.message).toMatch(/expected an integer/);
    expect(check(input('', 'degauss = abc')).find((d) => d.code === 'qe-value')?.message).toMatch(/expected a number/);
    expect(check(input('', 'nosym = yes')).find((d) => d.code === 'qe-value')?.message).toMatch(/\.true\./);
    expect(check(input('', 'nbnd = 4 5')).find((d) => d.code === 'qe-value')?.message).toMatch(/single value/);
    expect(check(input('', 'celldm(7) = 1')).find((d) => d.code === 'qe-index')?.message).toMatch(/between 1 and 6/);
    expect(check(input('', 'nbnd(1) = 4')).find((d) => d.code === 'qe-index')?.message).toMatch(/not an array/);
    expect(check(input('', 'nbnd =')).find((d) => d.code === 'qe-value')?.message).toMatch(/missing value/);
  });

  it('checks strings and allowed values', () => {
    const unquoted = check(input('prefix = si')).find((d) => d.code === 'qe-unquoted')!;
    expect(unquoted.fix?.edit.text).toBe("'si'");
    const opt = check(input("calculation = 'relx'")).find((d) => d.code === 'qe-option')!;
    expect(opt.message).toMatch(/not one of/);
    expect(opt.fix?.edit.text).toBe("'relax'");
    expect(codes(input("calculation = 'SCF'"))).toEqual([]);
    expect(codes(input("calculation = 'vc-relax'")).filter((c) => c === 'qe-option')).toEqual([]);
  });

  it('checks namelists: order, duplicates, unknown, missing, required variables', () => {
    expect(codes('&SYSTEM\n/\n&CONTROL\n/\n&ELECTRONS\n/\n')).toContain('qe-namelist-order');
    expect(codes(input() + '&ELECTRONS\n/\n')).toContain('qe-namelist-twice');
    expect(check(input() + '&CONTRL\n/\n').find((d) => d.code === 'qe-namelist')?.fix?.edit.text).toBe('&CONTROL');
    expect(codes('&CONTROL\n/\n&SYSTEM\n/\n').filter((c) => c === 'qe-namelist-missing')).toHaveLength(1);
    const required = check('&CONTROL\n/\n&SYSTEM\nnat = 1\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nATOMIC_POSITIONS\nK_POINTS\n').filter((d) => d.code === 'qe-required');
    expect(required.map((d) => d.message.split(' ')[0]).sort()).toEqual(['ecutwfc', 'ibrav', 'ntyp']);
    // ibrav is not needed with a space group.
    expect(check('&CONTROL\n/\n&SYSTEM\nspace_group = 227, nat = 1, ntyp = 1, ecutwfc = 20, a = 5\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nATOMIC_POSITIONS\nK_POINTS\n').some((d) => d.code === 'qe-required')).toBe(false);
  });

  it('flags a repeated variable and missing cards', () => {
    expect(codes(input('', 'nbnd = 4, nbnd = 6'))).toContain('qe-duplicate');
    expect(codes(input('', '', '', 'K_POINTS gamma\n'))).toContain('qe-card-twice');
    expect(codes('&CONTROL\n/\n&SYSTEM\nibrav=2,celldm(1)=1,nat=1,ntyp=1,ecutwfc=1\n/\n&ELECTRONS\n/\n').filter((c) => c === 'qe-card-missing')).toHaveLength(3);
  });
});

describe('the generated table is self-consistent', () => {
  const sample = (v: NonNullable<ReturnType<typeof lookupVar>>) => {
    if (v.type === 'integer') return '1';
    if (v.type === 'real') return '1.0';
    if (v.type === 'logical') return '.true.';
    if (v.type === 'character') return `'${v.options[0]?.value ?? 'x'}'`;
    return '1';
  };

  it('accepts a valid value for every variable of every namelist of pw.x', () => {
    for (const nl of namelistsOf('pw')) {
      for (const v of varsOf('pw', nl)) {
        const key = v.dim ? `${v.name}(1)` : v.name;
        const text = `&${nl}\n ${key} = ${sample(v)}\n/\n`;
        // Only the per-variable checks: whole-input rules (a lone degauss is "ignored" …) need a complete input.
        const own = ['qe-unknown-variable', 'qe-misplaced', 'qe-value', 'qe-index', 'qe-option', 'qe-unquoted', 'qe-syntax', 'qe-string'];
        const problems = validateQe(parseQe(text, { cards: cardsOf('pw') }), 'pw').filter((d) => own.includes(d.code));
        expect(problems.map((d) => d.message), `${nl}/${v.name}`).toEqual([]);
      }
    }
  });

  it('knows the variables the QE examples use', () => {
    const known = ['calculation', 'prefix', 'pseudo_dir', 'outdir', 'tprnfor', 'tstress', 'forc_conv_thr', 'etot_conv_thr', 'ecutwfc', 'ecutrho', 'occupations', 'smearing', 'degauss', 'nspin', 'starting_magnetization', 'nbnd', 'input_dft', 'vdw_corr', 'noncolin', 'lspinorb', 'nosym', 'tot_charge', 'assume_isolated', 'conv_thr', 'mixing_beta', 'electron_maxstep', 'startingwfc', 'diagonalization', 'ion_dynamics', 'cell_dynamics', 'press', 'cell_dofree', 'nr1', 'degauss'];
    const missing = known.filter((n) => namelistsDefining('pw', n).length === 0);
    expect(missing).toEqual([]);
  });
});

describe('variables the source accepts but the documentation omits', () => {
  it('warns about obsolete DFT+U input instead of rejecting it', () => {
    const d = check(input('', "lda_plus_u = .true., Hubbard_U(1) = 4.0, U_projection_type = 'atomic'"));
    expect(d.map((x) => `${x.code}:${x.severity}`)).toEqual(['qe-obsolete:warning', 'qe-obsolete:warning', 'qe-obsolete:warning']);
    expect(d[1].message).toMatch(/Hubbard_U is obsolete/i);
  });

  it('accepts undocumented variables without an index check', () => {
    expect(codes(input('ndr = 50', 'nr1b = 20, hubbard_v(1,1,1) = 0.5')).filter((c) => c !== 'qe-obsolete')).toEqual([]);
  });

  it('does not offer them in completion', () => {
    expect(varsOf('pw', 'SYSTEM').map((v) => v.name)).not.toContain('lda_plus_u');
    expect(lookupVar('pw', 'SYSTEM', 'lda_plus_u')?.status).toBe('obsolete');
  });
});
