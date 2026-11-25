import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMolgw } from '../../src/core/molgw/format';
import { molgwCompletions, molgwHover } from '../../src/core/molgw/hover';
import { parseMolgw } from '../../src/core/molgw/parse';
import { isMolgwInput, lookupMolgw, molgwKeywords, MOLGW_POSTSCF } from '../../src/core/molgw/tags';
import { MOLGW_SCF_FUNCTIONALS, MOLGW_ELEMENTS } from '../../src/core/molgw/keywords.generated';
import { validateMolgw, type MolgwContext } from '../../src/core/molgw/validate';

const root = join(__dirname, '..', 'fixtures', 'molgw');
const fixtures = readdirSync(root)
  .filter((f) => f.endsWith('.in'))
  .map((f) => ({ name: f, text: readFileSync(join(root, f), 'utf8') }));

const check = (text: string, ctx?: MolgwContext) => validateMolgw(parseMolgw(text), ctx);
const codes = (text: string, ctx?: MolgwContext) => check(text, ctx).map((d) => d.code);
const apply = (text: string, d: { fix?: { edit: { start: number; end: number; text: string } } }) => text.slice(0, d.fix!.edit.start) + d.fix!.edit.text + text.slice(d.fix!.edit.end);
const H2 = "&molgw\n scf='pbe'\n basis='cc-pVDZ'\n natom=2\n/\nH 0.0 0.0 0.0\nH 0.0 0.0 0.74\n";

describe('the keyword table', () => {
  it('has every variable of the namelist, with type, section, default and the mandatory ones', () => {
    expect(molgwKeywords()).toHaveLength(249);
    expect(lookupMolgw('SCF')).toMatchObject({ type: 'string', mandatory: true });
    expect(lookupMolgw('basis')).toMatchObject({ mandatory: true, section: 'General input variables' });
    expect(lookupMolgw('nspin')).toMatchObject({ type: 'integer', default: '1', section: 'Physical system setup input variables' });
    expect(lookupMolgw('print_wfn')).toMatchObject({ type: 'yesno', default: 'no' });
    expect(lookupMolgw('a1')).toMatchObject({ type: 'vector3' });
    expect(lookupMolgw('nonsense')).toBeUndefined();
    expect(molgwKeywords().filter((k) => k.mandatory).map((k) => k.name)).toEqual(['basis', 'scf']);
  });

  it('reads the accepted values from the Fortran source', () => {
    expect(lookupMolgw('scf')).toMatchObject({ valuesAre: 'strict' });
    expect(lookupMolgw('scf')!.values).toEqual(expect.arrayContaining(['hf', 'lda', 'pbe0', 'hse06', 'qsgw', 'none']));
    expect(MOLGW_SCF_FUNCTIONALS).toContain('cam-b3lyp');
    expect(Object.keys(MOLGW_POSTSCF)).toEqual(expect.arrayContaining(['gw', 'g0w0', 'evgw', 'gnw0', 'bse', 'td', 'mp2', 'real_time', 'g0w0_pade']));
    expect(MOLGW_POSTSCF['evgw']).toContain('technique:EVSC');
    expect(lookupMolgw('mixing_scheme')!.values).toEqual(['simple', 'pulay', 'diis', 'adiis', 'ediis']);
    expect(lookupMolgw('gaussian_type')).toMatchObject({ valuesAre: 'listed', values: ['cart', 'pure'] });
    expect(lookupMolgw('pt_density_matrix')!.values).toEqual(expect.arrayContaining(['no', 'pt2', 'one-ring', 'gw']));
    expect(MOLGW_ELEMENTS).toHaveLength(103);
  });

  it('recognizes MolGW inputs by name and by a first namelist', () => {
    expect(['molgw.in', 'h2o.molgw', 'h2o.molgw.in', '/a/b/Molgw.in'].map((f) => isMolgwInput(f))).toEqual([true, true, true, true]);
    expect(isMolgwInput('run.in', '! my run\n\n  &MolGW\n scf="hf"\n/\n')).toBe(true);
    expect(isMolgwInput('scf.in', '&control\n calculation="scf"\n/\n')).toBe(false);
    expect(isMolgwInput('run.in', 'scf = 1\n&molgw\n/\n')).toBe(false);
  });
});

describe('parseMolgw', () => {
  it('reads a namelist: any case, several items per line, quotes, comments, vectors, the closing slash', () => {
    const text = "! a comment\n&MolGW\n SCF = 'HF', basis=\"cc-pVDZ\" ! trailing\n natom=1 a1= 5., 0., 0. comment='it''s'\n/ ignored\nHe 0 0 0\n";
    const doc = parseMolgw(text);
    expect(doc.issues).toEqual([]);
    expect(doc.entries.map((e) => [e.key, e.values.map((v) => v.text)])).toEqual([
      ['SCF', ['HF']],
      ['basis', ['cc-pVDZ']],
      ['natom', ['1']],
      ['a1', ['5.', '0.', '0.']],
      ['comment', ["it's"]],
    ]);
    expect(doc.entries[1].values[0].quoted).toBe(true);
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0]).toMatchObject({ trailing: true });
    expect(doc.group).toMatchObject({ firstLine: 1, lastLine: 4 });
    // The atoms start on the line after the slash; the rest of the slash line is not read.
    expect(doc.atoms.map((a) => a.fields.map((f) => f.text))).toEqual([['He', '0', '0', '0']]);
  });

  it('keeps the spans of names, values and atom fields', () => {
    const text = "&molgw\n scf='hf'\n/\nH 1.5 0 0\n";
    const doc = parseMolgw(text);
    const e = doc.entries[0];
    expect(text.slice(e.keySpan.start, e.keySpan.end)).toBe('scf');
    expect(text.slice(e.valueSpan.start, e.valueSpan.end)).toBe("'hf'");
    expect(text.slice(doc.atoms[0].fields[1].start, doc.atoms[0].fields[1].end)).toBe('1.5');
  });

  it('stops the group at &end and takes `/` in a string as part of it', () => {
    const doc = parseMolgw("&molgw\n xyz_file='a/b.xyz'\n&end\n");
    expect(doc.issues).toEqual([]);
    expect(doc.entries[0].values[0].text).toBe('a/b.xyz');
    expect(doc.group!.end).toBeDefined();
  });

  it('reports a missing group, an open string and an open group', () => {
    expect(parseMolgw('scf="hf"\n').issues.map((i) => i.code)).toEqual(['molgw-no-namelist']);
    expect(parseMolgw("&molgw\n scf='hf\n/\n").issues.map((i) => i.code)).toContain('molgw-quote');
    expect(parseMolgw("&molgw\n scf='hf'\n").issues.map((i) => i.code)).toEqual(['molgw-unterminated']);
  });

  it('does not take # as a comment, and does not let it swallow the item before it', () => {
    const doc = parseMolgw("&molgw\n# note\n scf='hf'\n/\n");
    expect(doc.issues.map((i) => i.code)).toEqual(['molgw-hash']);
    expect(doc.entries).toHaveLength(1);
    expect(apply("&molgw\n# note\n scf='hf'\n/\n", doc.issues[0])).toContain('\n! note\n');
  });
});

describe('validateMolgw: what MolGW rejects', () => {
  it('accepts a plain input', () => {
    expect(check(H2)).toEqual([]);
  });

  it('flags unknown variables with a did-you-mean, in any case', () => {
    const text = H2.replace('natom=2', 'natoms=2');
    const d = check(text).find((x) => x.code === 'molgw-unknown-keyword')!;
    expect(d.severity).toBe('error');
    expect(d.message).toMatch(/Did you mean natom\?/);
    expect(apply(text, d)).toContain('natom=2');
    expect(codes(H2.replace('scf=', 'SCF='))).toEqual([]);
    expect(codes(H2.replace(' natom=2', ' natom=2\n qwerty=1'))).toContain('molgw-unknown-keyword');
  });

  it('checks the type of a value', () => {
    const bad = (line: string) => check(H2.replace(' natom=2', ` natom=2\n ${line}`)).filter((d) => d.severity === 'error').map((d) => d.code);
    expect(bad('nspin=1.5')).toEqual(['molgw-value']);
    expect(bad("nspin='1'")).toEqual(['molgw-value']);
    expect(bad('tolscf=abc')).toEqual(['molgw-value']);
    expect(bad('tolscf=1.0d-8')).toEqual([]);
    expect(bad('tolscf=1e-8')).toEqual([]);
    expect(bad('eta=.5')).toEqual([]);
    expect(bad('nscf=10 20')).toEqual(['molgw-value']);
    expect(bad('a1=1. 2. 3.')).toEqual([]);
    expect(bad('a1=1. 2. 3. 4.')).toEqual(['molgw-value']);
    expect(bad('a1=1. x 3.')).toEqual(['molgw-value']);
    expect(bad('a1=3*0.0')).toEqual([]);
  });

  it('checks yes/no words the way yesno_to_logical does (three characters, any case)', () => {
    const yn = (v: string) => check(H2.replace(' natom=2', ` natom=2\n print_wfn=${v}`)).filter((d) => d.severity === 'error').map((d) => d.code);
    for (const ok of ["'yes'", "'NO'", "'.true.'", "'.false.'", "'true'", "'y'", "'N'", "'t'", "'yess'"]) expect(yn(ok), ok).toEqual([]);
    for (const bad of ["'maybe'", "'1'", "''", "'ye'"]) expect(yn(bad), bad).toEqual(['molgw-yesno']);
  });

  it('checks scf and postscf against the names MolGW knows, with LIBXC:', () => {
    const scf = (v: string) => check(H2.replace("scf='pbe'", `scf=${v}`)).filter((d) => d.severity === 'error').map((d) => d.code);
    for (const ok of ["'hf'", "'LDA'", "'pbe0'", "'HSE06'", "'qsgw'", "'none'", "'LIBXC:101+130'", "'cam-b3lyp'"]) expect(scf(ok), ok).toEqual([]);
    expect(scf("'pbee'")).toEqual(['molgw-option']);
    const typo = check(H2.replace("scf='pbe'", "scf='lad'")).find((d) => d.code === 'molgw-option')!;
    expect(apply(H2.replace("scf='pbe'", "scf='lad'"), typo)).toContain("scf='lda'");
    const post = (v: string) => check(H2.replace(' natom=2', ` natom=2\n postscf=${v}`)).filter((d) => d.severity === 'error').map((d) => d.code);
    for (const ok of ["'gw'", "'G0W0'", "'bse'", "'td'", "'mp2'", "'real_time'", "''"]) expect(post(ok), ok).toEqual([]);
    expect(post("'gww'")).toEqual(['molgw-option']);
    expect(post("'rpa+'")).toEqual([]);
  });

  it('checks the other strict character variables; move_nuclei is case-sensitive', () => {
    const opt = (line: string) => check(H2.replace(' natom=2', ` natom=2\n ${line}`)).filter((d) => d.severity === 'error').map((d) => d.code);
    expect(opt("mixing_scheme='Pulay'")).toEqual([]);
    expect(opt("mixing_scheme='broyden'")).toEqual(['molgw-option']);
    expect(opt("pt3_a_diagrams='only'")).toEqual([]);
    expect(opt("pt3_a_diagrams='maybe'")).toEqual(['molgw-option']);
    expect(opt("length_unit='bohr'")).toEqual([]);
    expect(opt("length_unit='au'")).toEqual([]);
    expect(opt("length_unit='nm'")).toEqual(['molgw-option']);
    expect(opt("move_nuclei='relax'")).toEqual([]);
    expect(opt("move_nuclei='RELAX'")).toEqual(['molgw-option']);
    expect(opt("excit_name='ion'")).toContain('molgw-ion');
    expect(opt("excit_name='laser'")).toContain('molgw-option');
    const text = H2.replace(' natom=2', " natom=2\n move_nuclei='RELAX'");
    expect(apply(text, check(text).find((d) => d.code === 'molgw-option')!)).toContain("move_nuclei='relax'");
  });

  it('only warns about values the manual lists but the reader does not check', () => {
    const d = check(H2.replace(' natom=2', " natom=2\n frozencore='some'")).find((x) => x.code === 'molgw-listed')!;
    expect(d.severity).toBe('warning');
    expect(check(H2.replace(' natom=2', " natom=2\n gaussian_type='cartesian'")).map((x) => x.code)).toEqual([]);
    expect(check(H2.replace(' natom=2', " natom=2\n grid_quality='very high'")).map((x) => x.code)).toEqual([]);
    expect(check(H2.replace(' natom=2', " natom=2\n grid_quality='ultra'")).map((x) => x.code)).toEqual(['molgw-listed']);
  });

  it('warns about bare strings and offers the quotes; duplicates keep the last value', () => {
    const text = H2.replace("scf='pbe'", 'scf=pbe');
    const d = check(text).find((x) => x.code === 'molgw-unquoted')!;
    expect(d.severity).toBe('warning');
    expect(apply(text, d)).toContain("scf='pbe'");
    expect(codes(H2.replace(' natom=2', " natom=2\n scf='hf'"))).toEqual(['molgw-duplicate']);
  });

  it('requires scf and a basis', () => {
    expect(codes(H2.replace(" scf='pbe'\n", ''))).toEqual(['molgw-required']);
    expect(codes(H2.replace(" scf='pbe'", " scf=''"))).toEqual(['molgw-required']);
    expect(codes(H2.replace(" basis='cc-pVDZ'\n", ''))).toEqual(['molgw-required']);
    // ecp_basis, or a basis on every atom line, stands in for basis
    expect(codes(H2.replace(" basis='cc-pVDZ'", " ecp_basis='cc-pVDZ-PP'"))).toEqual([]);
    expect(codes(H2.replace(" basis='cc-pVDZ'\n", '').replace('0.0 0.0 0.0', '0.0 0.0 0.0 cc-pVDZ').replace('0.74', '0.74 cc-pVDZ'))).toEqual([]);
    expect(codes('scf="hf"\n')).toEqual(['molgw-no-namelist']);
  });

  it('applies the die() checks of the reader', () => {
    const set = (line: string) => check(H2.replace(' natom=2', ` natom=2\n ${line}`)).filter((d) => d.severity === 'error').map((d) => d.code);
    expect(set('nspin=3')).toEqual(['molgw-spin']);
    expect(set('magnetization=-1.0')).toEqual(['molgw-spin']);
    expect(set('magnetization=1.0')).toEqual(['molgw-spin']);
    expect(set('magnetization=1.0\n nspin=2')).toEqual([]);
    expect(set('alpha_mixing=1.5')).toEqual(['molgw-range']);
    expect(set('ncoreg=-1')).toEqual(['molgw-range']);
    expect(set('nvirtualg=3\n ncoreg=5')).toEqual(['molgw-range']);
    expect(set('auto_auxil_fsam=1.0')).toEqual(['molgw-range']);
    expect(set("print_w='yes'")).toEqual([]);
    expect(set("print_w='yes'\n auxil_basis='cc-pVDZ-RI'")).toEqual(['molgw-print-w']);
    expect(set("x2c='yes'")).toEqual(['molgw-x2c', 'molgw-x2c']); // nspin and auxil_basis
  });

  it('knows which post-scf methods need what', () => {
    const set = (line: string) => check(H2.replace(' natom=2', ` natom=2\n ${line}`)).filter((d) => d.severity === 'error').map((d) => d.code);
    expect(set("postscf='gw'\n nexcitation=5")).toEqual(['molgw-gw-davidson']);
    expect(set("postscf='td'\n nexcitation=5")).toEqual([]);
    expect(set("postscf='evgw'\n nstep_gw=4")).toEqual([]);
    expect(set("postscf='gw'\n nstep_gw=4")).toEqual(['molgw-nstep-gw']);
    expect(set("postscf='gw_pade'")).toEqual(['molgw-pade']);
    expect(set("postscf='gw_pade'\n nomega_chi_imag=12")).toEqual([]);
    expect(check(H2.replace(' natom=2', " natom=2\n postscf='gw_pade'\n nomega_chi_imag=12")).map((d) => d.code)).toEqual(['molgw-pade']); // warning: one sigma frequency
  });

  it('warns that nstep only counts for relaxations', () => {
    expect(codes(H2.replace(' natom=2', ' natom=2\n nstep=10'))).toEqual(['molgw-nstep']);
    expect(codes(H2.replace(' natom=2', " natom=2\n nstep=10\n move_nuclei='relax'"))).toEqual([]);
  });
});

describe('validateMolgw: the geometry', () => {
  it('needs natom, or a geometry file', () => {
    expect(codes(H2.replace(' natom=2\n', ''))).toEqual(['molgw-natom']);
    expect(codes(H2.replace(' natom=2\n', " xyz_file='h2.xyz'\n"))).toEqual(['molgw-atoms-ignored']);
  });

  it('counts the atom lines after the slash', () => {
    const few = check(H2.replace('natom=2', 'natom=3'));
    expect(few.map((d) => [d.severity, d.code])).toEqual([['error', 'molgw-natom']]);
    expect(few[0].message).toMatch(/only 2 follow/);
    const many = check(H2.replace('natom=2', 'natom=1'));
    expect(many.map((d) => [d.severity, d.code])).toEqual([['warning', 'molgw-natom']]);
    // ghost atoms and a projectile are read from the same lines
    expect(codes(H2.replace('natom=2', 'natom=1\n nghost=1'))).toEqual([]);
    expect(codes(H2.replace('natom=2', "natom=1\n excit_name='nucleus'\n postscf='real_time'"))).toEqual([]);
  });

  it('checks the natom of an xyz file when the extension could read it', () => {
    const text = H2.replace(' natom=2\n', " natom=2\n xyz_file='h2.xyz'\n").split('/\n')[0] + '/\n';
    expect(codes(text, { xyzAtoms: 3 })).toEqual(['molgw-natom']);
    expect(codes(text, { xyzAtoms: 2 })).toEqual([]);
    expect(codes(text)).toEqual([]);
    expect(codes(text.replace("xyz_file='h2.xyz'", "xyz_file='h2.xyz'\n length_unit='bohr'"), { xyzAtoms: 2 })).toEqual(['molgw-length-unit']);
  });

  it('reads the atom lines the way list-directed input does', () => {
    const atoms = (lines: string) => check(`&molgw\n scf='hf'\n basis='cc-pVDZ'\n natom=1\n/\n${lines}`).map((d) => [d.severity, d.code]);
    expect(atoms('1 0 0 0\n')).toEqual([]); // an atomic number
    expect(atoms('H, 0.0, 0.0, 0.0\n')).toEqual([]);
    expect(atoms("'He' 0 0 0 cc-pVTZ cc-pVTZ-RI\n")).toEqual([]);
    expect(atoms('H 0 0 0 none\n')).toEqual([]);
    expect(atoms('H 0 0\n')).toEqual([['error', 'molgw-atom']]);
    expect(atoms('H 0 0 x\n')).toEqual([['error', 'molgw-atom']]);
    expect(atoms('\nH 0 0 0\n')).toEqual([['error', 'molgw-atom'], ['warning', 'molgw-natom']]); // a blank line is read as an atom, so the real atom is one too many
    expect(atoms('! first atom\nH 0 0 0\n')).toEqual([['error', 'molgw-atom'], ['warning', 'molgw-natom']]);
    expect(atoms('H 0 0 0 ! comment\n')).toEqual([['warning', 'molgw-atom']]);
    expect(atoms('H 0 0 0\n\n! more\n')).toEqual([]); // after the last atom nothing is read
  });

  it('knows the elements, case-sensitively, and offers the symbol', () => {
    const text = "&molgw\n scf='hf'\n basis='cc-pVDZ'\n natom=1\n/\ncl 0 0 0\n";
    const d = check(text).find((x) => x.code === 'molgw-element')!;
    expect(d.severity).toBe('error');
    expect(d.message).toMatch(/Did you mean Cl\?/);
    expect(apply(text, d)).toContain('\nCl 0 0 0');
    expect(codes(text.replace('cl', 'Xx'))).toEqual(['molgw-element']);
    expect(codes(text.replace('cl', 'Lr'))).toEqual([]);
    expect(codes(text.replace('cl', 'Uuo'))).toEqual(['molgw-element']);
  });
});

describe('the real testsuite inputs (copied fixtures)', () => {
  it.each(fixtures.map((f) => [f.name, f.text]))('%s raises nothing, and formats idempotently', (_name, text) => {
    expect(check(text, { xyzAtoms: undefined })).toEqual([]);
    const once = formatMolgw(text)!;
    expect(once).toBeDefined();
    expect(formatMolgw(once)).toBe(once);
    expect(check(once)).toEqual([]);
  });
});

describe('formatMolgw', () => {
  it('puts one variable per line with aligned equal signs, keeps comments, and never touches a value', () => {
    const text = "! header\n&molgw scf='hf'  basis = 'cc-pVDZ'\n\n\n\n natom=2   !  two atoms  \n eta=1.0d-3\n tolscf = 1e-10 ! tight\n  ! a full-line comment\n/   \nH 0.0 0.0 0.0\nH 0.0 0.0 0.74\n";
    expect(formatMolgw(text)).toBe(
      "! header\n&molgw\n  scf    = 'hf'\n  basis  = 'cc-pVDZ'\n\n  natom  = 2  !  two atoms\n  eta    = 1.0d-3\n  tolscf = 1e-10  ! tight\n  ! a full-line comment\n/\nH  0.0  0.0  0.0\nH  0.0  0.0  0.74\n",
    );
  });

  it('lines the atoms up on the decimal point and keeps the basis columns', () => {
    const text = "&molgw\n scf='hf'\n natom=3\n/\nO 0.0 -1.25 0\nH   10.5 0.0 1.0 cc-pVDZ\nHe 0 0 0 cc-pVDZ cc-pVDZ-RI\n";
    expect(formatMolgw(text)).toBe("&molgw\n  scf   = 'hf'\n  natom = 3\n/\nO    0.0  -1.25  0\nH   10.5   0.0   1.0  cc-pVDZ\nHe   0     0     0    cc-pVDZ  cc-pVDZ-RI\n");
  });

  it('keeps an item that spans lines, and leaves comma-separated or commented atom lines alone', () => {
    const multi = "&molgw\n scf='hf'\n a1= 1. 0. 0.\n 2.\n/\nH 0 0 0\n";
    expect(formatMolgw(multi)).toBe(multi.replace('H 0 0 0', 'H  0  0  0')); // the group is kept, the atoms are lined up
    const commas = "&molgw\n natom=1\n/\nH,0.0,0.0,0.0\n";
    expect(formatMolgw(commas)).toBe("&molgw\n  natom = 1\n/\nH,0.0,0.0,0.0\n");
  });

  it('does not format while the input cannot be read', () => {
    expect(formatMolgw('scf="hf"\n')).toBeUndefined();
    expect(formatMolgw("&molgw\n scf='hf\n/\n")).toBeUndefined();
    expect(formatMolgw("&molgw\n scf='hf'\n")).toBeUndefined();
  });

  it('keeps Windows line endings', () => {
    expect(formatMolgw("&molgw\r\n scf='hf'\r\n/\r\nH 0 0 0\r\n")).toBe("&molgw\r\n  scf = 'hf'\r\n/\r\nH  0  0  0\r\n");
  });
});

describe('molgwHover', () => {
  const text = "&molgw\n scf='hf'\n nspin=1\n natom=1\n/\nHe 0 0 0\n";
  const at = (s: string) => text.indexOf(s) + 1;
  it('describes a variable, in any case', () => {
    const h = molgwHover(parseMolgw(text), at('nspin'))!;
    expect(h.markdown).toContain('**nspin**');
    expect(h.markdown).toContain('Sets the number of spin channels');
    expect(h.markdown).toContain('default: `1`');
    expect(h.markdown).toContain('Physical system setup input variables');
    expect(text.slice(h.start, h.end)).toBe('nspin');
    const s = molgwHover(parseMolgw(text), at('scf'))!;
    expect(s.markdown).toContain('mandatory');
    expect(s.markdown).toContain('accepted values');
    const upper = text.replace('nspin', 'NSPIN');
    expect(molgwHover(parseMolgw(upper), upper.indexOf('NSPIN') + 1)!.markdown).toContain('**nspin**');
  });
  it('names the element in an atom line, and nothing for unknown words', () => {
    expect(molgwHover(parseMolgw(text), at('He 0'))!.markdown).toContain('element 2');
    expect(molgwHover(parseMolgw(text.replace('natom', 'natoms')), at('natoms'))).toBeUndefined();
  });
});

describe('molgwCompletions', () => {
  const run = (text: string) => {
    const offset = text.indexOf('|');
    const clean = text.replace('|', '');
    return molgwCompletions(parseMolgw(clean), offset);
  };
  it('offers the variables not yet set, the mandatory ones first', () => {
    const c = run("&molgw\n scf='hf'\n |\n/\n");
    expect(c.map((x) => x.label)).toContain('basis');
    expect(c.map((x) => x.label)).not.toContain('scf');
    expect(c.sort((a, b) => a.sortText.localeCompare(b.sortText))[0].label).toBe('basis');
    expect(c.find((x) => x.label === 'nspin')!.insertText).toBe('nspin = ${1:1}');
    expect(c.find((x) => x.label === 'print_wfn')!.insertText).toBe("print_wfn = '${1|yes,no|}'");
    expect(c.find((x) => x.label === 'postscf')!.insertText).toBe("postscf = '${1:}'");
  });
  it('offers the accepted words after name =, quoted unless already in quotes', () => {
    const c = run('&molgw\n postscf=|\n/\n');
    expect(c.map((x) => x.label)).toEqual(expect.arrayContaining(['gw', 'bse', 'td']));
    expect(c.find((x) => x.label === 'gw')!.insertText).toBe("'gw'");
    const q = run("&molgw\n postscf='g|'\n/\n");
    expect(q.find((x) => x.label === 'gw')!.insertText).toBe('gw');
    expect(run("&molgw\n print_wfn='|'\n/\n").map((x) => x.label)).toEqual(['yes', 'no']);
    expect(run('&molgw\n natom=|\n/\n')).toEqual([]);
  });
  it('offers element symbols in the atom lines only', () => {
    expect(run("&molgw\n natom=1\n/\nC|\n").map((x) => x.label)).toEqual(MOLGW_ELEMENTS);
    expect(run("&molgw\n natom=1\n/ |\n")).toEqual([]);
    expect(run("&molgw\n natom=1\n/\nH 0 0 |\n")).toEqual([]);
    expect(run("&molgw\n natom=1 ! |\n/\n")).toEqual([]);
  });
});
