import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatAbinit } from '../../src/core/abinit/format';
import { abinitCompletions, abinitHover } from '../../src/core/abinit/hover';
import { parseAbinit } from '../../src/core/abinit/parse';
import { ABINIT_UNIT_WORDS, abinitVariableNames, abinitVariables, lookupAbinitVariable, parseAbinitSuffix, splitAbinitWord } from '../../src/core/abinit/tags';
import { closestAbinitName, validateAbinit } from '../../src/core/abinit/validate';
import { readAbinitValue } from '../../src/core/abinit/values';

const root = join(__dirname, '..', 'fixtures', 'abinit');
const fixtures = readdirSync(root)
  .filter((f) => f.endsWith('.abi'))
  .map((f) => ({ name: f, text: readFileSync(join(root, f), 'utf8') }));

const BASE = 'acell 3*10.18\nntypat 1\nznucl 14\nnatom 2\ntypat 1 1\nxred 0 0 0  1/4 1/4 1/4\necut 12\ntolvrs 1d-10\nkptopt 1\nngkpt 2 2 2\n';
const check = (text: string) => validateAbinit(parseAbinit(text));
const codes = (text: string) => check(text).map((d) => d.code);
const errors = (text: string) => check(text).filter((d) => d.severity === 'error');
const apply = (text: string, d: { fix?: { edit: { start: number; end: number; text: string } } }) => text.slice(0, d.fix!.edit.start) + d.fix!.edit.text + text.slice(d.fix!.edit.end);

describe('the variable table', () => {
  it('holds the documented variables with type, dimension, default and allowed values', () => {
    expect(abinitVariables().length).toBeGreaterThan(1000);
    expect(lookupAbinitVariable('ECUT')).toMatchObject({ type: 'real', dims: [], characteristics: ['energy'] });
    expect(lookupAbinitVariable('acell')).toMatchObject({ type: 'real', dims: ['3'], default: '1 1 1' });
    expect(lookupAbinitVariable('xred')?.dims).toEqual(['3', 'min(natom,natrd)']);
    expect(lookupAbinitVariable('ixc')?.options.map((o) => o.value)).toContain('1');
    expect(lookupAbinitVariable('optdriver')?.options.map((o) => o.value)).toEqual(expect.arrayContaining(['0', '1', '3', '4', '99']));
    expect(lookupAbinitVariable('geoopt')?.options.map((o) => o.value)).toEqual(expect.arrayContaining(['none', 'bfgs']));
    expect(lookupAbinitVariable('ndtset')?.characteristics).toContain('no_multi');
  });

  it('takes the type from the reader where the documentation is wrong, and knows the names the documentation lacks', () => {
    expect(lookupAbinitVariable('td_scthr')?.type).toBe('real');
    expect(lookupAbinitVariable('use_rcpaw')).toMatchObject({ documented: false, type: 'integer' });
    expect(lookupAbinitVariable('spinpolarized')?.type).toBe('logical');
    expect(lookupAbinitVariable('nonsense')).toBeUndefined();
    expect(abinitVariableNames()).toContain('natom');
  });

  it('splits a word the way chkvars_in_string does', () => {
    expect(splitAbinitWord('ecut?1')).toEqual({ base: 'ecut', suffix: '?1' });
    expect(splitAbinitWord('xred2')).toEqual({ base: 'xred', suffix: '2' });
    expect(splitAbinitWord('f4of2_sla3')).toEqual({ base: 'f4of2_sla', suffix: '3' });
    expect(parseAbinitSuffix('12')).toEqual({ kind: 'dataset', index: 12 });
    expect(parseAbinitSuffix('?3')).toEqual({ kind: 'wild', unit: 3 });
    expect(parseAbinitSuffix('2?')).toEqual({ kind: 'wild', tens: 2 });
    expect(parseAbinitSuffix(':?')).toEqual({ kind: 'series', op: ':', where: 'tens' });
    expect(parseAbinitSuffix('?+')).toEqual({ kind: 'series', op: '+', where: 'units' });
    expect(parseAbinitSuffix('12345').kind).toBe('invalid');
  });
});

describe('readAbinitValue', () => {
  it('reads repeats, fractions and square roots like inarray and inread', () => {
    expect(readAbinitValue('3*10.2', 'real')).toEqual({ count: 3, value: 10.2 });
    expect(readAbinitValue('*0.0', 'real')).toMatchObject({ count: Infinity, value: 0 });
    expect(readAbinitValue('1/4', 'real').value).toBe(0.25);
    expect(readAbinitValue('-sqrt(3)/2', 'real').error).toBeDefined(); // only whole sqrt(x) words are read
    expect(readAbinitValue('sqrt(3/4)', 'real').value).toBeCloseTo(0.866025, 5);
    expect(readAbinitValue('-sqrt(2)', 'real').value).toBeCloseTo(-1.41421, 4);
    expect(readAbinitValue('1.0d-3', 'real').value).toBe(0.001);
    expect(readAbinitValue('1/0', 'real').error).toMatch(/denominator/);
    expect(readAbinitValue('sqrt(-1)', 'real').error).toMatch(/negative/);
    expect(readAbinitValue('3', 'int')).toEqual({ count: 1, value: 3 });
    expect(readAbinitValue('3.0', 'int').error).toBeDefined();
    expect(readAbinitValue('2*1', 'int')).toEqual({ count: 2, value: 1 });
    expect(readAbinitValue('abc', 'real').error).toBeDefined();
  });
});

describe('parseAbinit', () => {
  it('reads one stream of words: several variables per line, values on later lines', () => {
    const doc = parseAbinit('acell 3*10 Bohr  ecut 270 eV\nxred 0 0 0\n  1/4 1/4 1/4 # c\nntypat=1\n');
    expect(doc.entries.map((e) => e.word)).toEqual(['acell', 'ecut', 'xred', 'ntypat']);
    expect(doc.entries[0].args.map((a) => a.text)).toEqual(['3*10']);
    expect(doc.entries[0].units.map((u) => u.text)).toEqual(['Bohr']);
    expect(doc.entries[1].units.map((u) => u.text)).toEqual(['eV']);
    expect(doc.entries[2].args).toHaveLength(6);
    expect(doc.entries[3].args.map((a) => a.text)).toEqual(['1']); // = is a blank
  });

  it('keeps spans on the text', () => {
    const text = 'ecut 20 Ha\n';
    const e = parseAbinit(text).entries[0];
    expect(text.slice(e.keySpan.start, e.keySpan.end)).toBe('ecut');
    expect(text.slice(e.args[0].start, e.args[0].end)).toBe('20');
    expect(text.slice(e.units[0].start, e.units[0].end)).toBe('Ha');
    expect(text.slice(e.span.start, e.span.end)).toBe('ecut 20 Ha');
  });

  it('ends a line at # or !, and is case-insensitive', () => {
    const doc = parseAbinit('ECUT 10 # ecut 20\nNatom 2 ! natom 3\n');
    expect(doc.entries.map((e) => [e.variable?.name, e.args[0].text])).toEqual([
      ['ecut', '10'],
      ['natom', '2'],
    ]);
  });

  it('knows dataset suffixes, wildcards and series', () => {
    const kinds = parseAbinit('ecut1 5 ecut?2 5 ecut3? 5 ecut: 5 ecut+ 1 ecut*? 2\n').entries.map((e) => e.kind);
    expect(kinds.map((k) => k.kind)).toEqual(['dataset', 'wild', 'wild', 'series', 'series', 'series']);
  });

  it('takes the word after a string variable whatever it is, and T or F for logicals', () => {
    const doc = parseAbinit('xyzfile t10.in.xyz\npp_dirpath "$ABI_PSPDIR"\nSpinPolarized3 T\n');
    expect(doc.entries.map((e) => [e.word, e.args[0].text])).toEqual([
      ['xyzfile', 't10.in.xyz'],
      ['pp_dirpath', '"$ABI_PSPDIR"'],
      ['SpinPolarized3', 'T'],
    ]);
    expect(doc.entries.every((e) => e.variable)).toBe(true);
  });

  it('records quoted strings with spaces as one token, and include statements', () => {
    const doc = parseAbinit('pseudos "a.psp8, b.psp8"\ninclude "common.abi"\n');
    expect(doc.entries[0].args.map((a) => a.text)).toEqual(['"a.psp8, b.psp8"']);
    expect(doc.includes.map((i) => i.text)).toEqual(['"common.abi"']);
  });

  it('reports what ABINIT refuses while reading the file', () => {
    expect(parseAbinit('ecut\t10\n').issues.map((i) => i.code)).toEqual(['abinit-tab']);
    const minus = parseAbinit('xred 0 0 - 0.5\n');
    expect(minus.issues.map((i) => i.code)).toEqual(['abinit-minus-blank']);
    expect(parseAbinit('pseudos "a.psp8\n').issues.map((i) => i.code)).toEqual(['abinit-quote']);
    expect(parseAbinit('ecut 10 # a tab\there\n').issues).toEqual([]); // comments may hold anything
  });
});

describe('validateAbinit', () => {
  it('accepts a complete input', () => {
    expect(check(BASE)).toEqual([]);
  });

  it('knows units, repeats, expressions and comments without complaint', () => {
    const text = BASE.replace('acell 3*10.18', 'acell 3*7.5 Angstrom').replace('ecut 12', 'ecut 20 Ry   # cutoff\n! comment\nrprim 1 0 0  0 1 0  0 0 1\ntsmear 300 K').replace('xred 0 0 0  1/4 1/4 1/4', 'xcart 0 0 0  sqrt(2) sqrt(3/4) 0.1 Bohr');
    expect(check(text)).toEqual([]);
  });

  describe('errors that ABINIT raises', () => {
    it('an unknown variable, with did-you-mean', () => {
      const text = BASE.replace('ecut 12', 'ecutt 12').replace('znucl', 'znul');
      const d = check(text).filter((x) => x.code === 'abinit-unknown-variable');
      expect(d).toHaveLength(2);
      expect(d.map((x) => x.fix?.edit.text)).toEqual(['znucl', 'ecut']);
      expect(apply(text, d[1])).toContain('\necut 12');
      expect(check(BASE.replace('ecut 12', 'ecut 12 Hartree'))).toEqual([]);
      expect(closestAbinitName('ecu')).toBe('ecut');
    });

    it('a malformed number or unit word', () => {
      expect(errors(BASE.replace('ecut 12', 'ecut 12x')).map((d) => d.code)).toEqual(['abinit-value']);
      expect(errors(BASE.replace('natom 2', 'natom 2.0')).map((d) => d.message.includes('Integer variables'))).toEqual([true]);
      expect(errors(BASE.replace('ecut 12', 'ecut 12 Hartre')).map((d) => d.code)).toEqual(['abinit-unknown-variable']);
      expect(errors(BASE.replace('ecut 12', 'ecut'))[0].message).toMatch(/no value/);
      expect(errors(BASE.replace('ecut 12', 'ecut 1/0')).map((d) => d.code)).toEqual(['abinit-value']);
    });

    it('a string variable without quotes', () => {
      expect(errors(`${BASE}geoopt bfgs\n`).map((d) => d.code)).toEqual(['abinit-string']);
      expect(errors(`${BASE}geoopt "bfgs"\n`)).toEqual([]);
    });

    it('mandatory variables', () => {
      expect(codes('ntypat 1\n')).toEqual(['abinit-required', 'abinit-required', 'abinit-required', 'abinit-required', 'abinit-tolerance']); // natom, znucl, ecut, xred/xcart, and a criterion
      expect(errors(BASE.replace('ecut 12\n', '')).map((d) => d.message)).toEqual([expect.stringMatching(/^ecut is not set/)]);
      expect(errors(BASE.replace('natom 2\n', ''))[0].message).toMatch(/natom is not set/);
      expect(errors(BASE.replace('znucl 14\n', ''))[0].message).toMatch(/znucl is not set/);
      expect(errors(BASE.replace('xred 0 0 0  1/4 1/4 1/4\n', ''))[0].message).toMatch(/Neither xred nor xcart/);
      // not needed: acell and rprim have defaults, wavelets have no ecut, structure and include bring their own
      expect(errors(BASE.replace('ecut 12', 'usewvl 1'))).toEqual([]);
      expect(errors('structure "abifile:x.nc"\necut 10\ntolvrs 1d-8\n')).toEqual([]);
      expect(errors('include "common.abi"\n')).toEqual([]);
    });

    it('xred together with xcart', () => {
      expect(errors(`${BASE}xcart 0 0 0 1 1 1\n`).map((d) => d.code)).toEqual(['abinit-xred-xcart']);
    });

    it('lengths of typat, znucl and xred against natom and ntypat: too few stops ABINIT, extra values are ignored', () => {
      expect(errors(BASE.replace('typat 1 1', 'typat 1'))[0]).toMatchObject({ code: 'abinit-count', message: expect.stringContaining('typat needs 2 values') });
      expect(errors(BASE.replace('natom 2', 'natom 3'))[0].message).toMatch(/typat needs 3 values/);
      expect(errors(BASE.replace('znucl 14', 'znucl 14 8'))).toEqual([]);
      expect(check(BASE.replace('znucl 14', 'znucl 14 8')).map((d) => d.code)).toEqual(['abinit-extra-values']);
      expect(errors(BASE.replace('ntypat 1', 'ntypat 2'))[0].message).toMatch(/znucl needs 2 values/);
      expect(errors(BASE.replace('xred 0 0 0  1/4 1/4 1/4', 'xred 0 0 0  1/4 1/4'))[0].message).toMatch(/xred needs 6 values/);
      expect(errors(BASE.replace('acell 3*10.18', 'acell 10.18 10.18'))[0].message).toMatch(/acell needs 3 values/);
      expect(check(BASE.replace('typat 1 1', 'typat 1 1 1'))[0]).toMatchObject({ severity: 'warning', code: 'abinit-extra-values' });
      // repeats count
      expect(check(BASE.replace('xred 0 0 0  1/4 1/4 1/4', 'xred 6*0.1'))).toEqual([]);
      expect(check(BASE.replace('typat 1 1', 'typat 2*1'))).toEqual([]);
      expect(check(BASE.replace('xred 0 0 0  1/4 1/4 1/4', 'xred *0.0'))).toEqual([]);
      // natrd: only that many atoms are read
      expect(errors(`${BASE.replace('typat 1 1', 'typat 1').replace('xred 0 0 0  1/4 1/4 1/4', 'xred 0 0 0')}natrd 1\n`)).toEqual([]);
    });

    it('typat entries outside 1 … ntypat', () => {
      expect(errors(BASE.replace('typat 1 1', 'typat 1 2'))[0]).toMatchObject({ code: 'abinit-typat-range' });
      expect(errors(BASE.replace('typat 1 1', 'typat 0 1'))[0]).toMatchObject({ code: 'abinit-typat-range' });
    });

    it('natom and ntypat must be positive', () => {
      expect(codes(BASE.replace('natom 2', 'natom 0'))).toContain('abinit-natom');
    });

    it('pseudos must list npsp files', () => {
      expect(errors(`${BASE}pseudos "a.psp8, b.psp8"\n`)[0].message).toMatch(/lists 2 files but npsp \(ntypat\) is 1/);
      expect(errors(`${BASE}pseudos "a.psp8"\n`)).toEqual([]);
      expect(errors(`${BASE.replace('ntypat 1', 'ntypat 2').replace('znucl 14', 'znucl 14 8').replace('typat 1 1', 'typat 1 2')}pseudos "a.psp8"\n`)[0].message).toMatch(/lists 1 file but npsp/);
    });

    it('only one SCF convergence criterion, and at least one', () => {
      expect(errors(BASE.replace('tolvrs 1d-10', 'tolvrs 1d-10\ntoldfe 1d-8'))[0]).toMatchObject({ code: 'abinit-tolerance', message: expect.stringContaining('More than one') });
      expect(errors(BASE.replace('tolvrs 1d-10\n', ''))[0]).toMatchObject({ code: 'abinit-tolerance', message: expect.stringContaining('No SCF convergence criterion') });
      // tolwfr can be coupled with one of them, and is the only one for a non-SCF run
      expect(errors(`${BASE}tolwfr 1d-12\n`)).toEqual([]);
      expect(errors(BASE.replace('tolvrs 1d-10', 'tolwfr 1d-12\niscf -2'))).toEqual([]);
      expect(errors(BASE.replace('tolvrs 1d-10', 'toldfe 1d-8\niscf -2'))[0].message).toMatch(/tolwfr > 0/);
      // zero means unused; accuracy sets tolvrs; other drivers have their own rules
      expect(errors(BASE.replace('tolvrs 1d-10', 'tolvrs 1d-10\ntoldfe 0.0'))).toEqual([]);
      expect(errors(BASE.replace('tolvrs 1d-10', 'accuracy 3'))).toEqual([]);
      expect(errors(BASE.replace('tolvrs 1d-10', 'optdriver 3'))).toEqual([]);
    });

    it('the k-point rules of m_inkpts', () => {
      expect(errors(`${BASE}kptrlatt 2 0 0 0 2 0 0 0 2\n`)[0].message).toMatch(/ngkpt and kptrlatt cannot both/);
      expect(errors(BASE.replace('ngkpt 2 2 2', 'ngkpt 2 0 2'))[0].message).toMatch(/ngkpt must be strictly positive/);
      expect(errors(`${BASE}nshiftk 2\n`)[0].message).toMatch(/shiftk must be defined/);
      expect(errors(`${BASE}nshiftk 2\nshiftk 0.5 0.5 0.5 0 0 0\n`)).toEqual([]);
      expect(errors(BASE.replace('kptopt 1', 'kptopt 5'))[0].message).toMatch(/kptopt = 5 is not allowed/);
      const band = BASE.replace('kptopt 1\nngkpt 2 2 2', 'kptopt -1\nkptbounds 0 0 0 0.5 0 0\nndivk 10');
      expect(errors(band)[0].message).toMatch(/iscf = -2/);
      expect(errors(`${band}iscf -2\ntolwfr 1d-12\n`.replace('tolvrs 1d-10\n', ''))).toEqual([]);
      expect(errors(band.replace('kptbounds 0 0 0 0.5 0 0\n', '') + 'iscf -2\n').some((d) => /kptbounds/.test(d.message))).toBe(true);
      expect(errors(`${band}iscf -2\nndivsm 4\n`).some((d) => /mutually exclusive/.test(d.message))).toBe(true);
      // kptopt 0 reads kpt: 3 values per k point
      expect(errors(BASE.replace('kptopt 1\nngkpt 2 2 2', 'kptopt 0\nnkpt 2\nkpt 0 0 0  0.5 0 0'))).toEqual([]);
      expect(errors(BASE.replace('kptopt 1\nngkpt 2 2 2', 'kptopt 0\nnkpt 2\nkpt 0 0 0  0.5 0'))[0].message).toMatch(/kpt needs 6 values/);
    });

    it('ionmov and optcell', () => {
      expect(errors(`${BASE}ionmov 27\n`)[0].message).toMatch(/ionmov = 27 is not an allowed value/);
      expect(errors(`${BASE}ionmov 2\noptcell 2\n`)).toEqual([]);
      expect(errors(`${BASE}ionmov 1\noptcell 2\n`)[0].message).toMatch(/optcell = 2 optimizes the cell/);
      expect(errors(`${BASE}optcell 2\n`)[0].message).toMatch(/ionmov is 0 \(the default\)/);
      expect(errors(`${BASE}geoopt "bfgs"\noptcell 2\n`)).toEqual([]);
    });

    it('a tab, a minus followed by a blank and an unmatched quote come from the reader', () => {
      expect(errors(BASE.replace('ecut 12', 'ecut\t12')).map((d) => d.code)).toEqual(['abinit-tab']);
      const text = BASE.replace('xred 0 0 0', 'xred 0 0 - 0.1');
      const d = errors(text)[0];
      expect(d.code).toBe('abinit-minus-blank');
      expect(apply(text, d)).toContain('xred 0 0 -0.1');
    });
  });

  describe('datasets', () => {
    const DS = `ndtset 2\n${BASE}`;
    it('accepts dataset indices, wildcards and series with ndtset', () => {
      expect(check(`${DS}ecut1 10\necut2 20\n`.replace('ecut 12\n', ''))).toEqual([]);
      expect(check(`${DS}ecut?1 10\n`)).toEqual([]);
      expect(check(`${DS}ecut: 10 ecut+ 5\n`.replace('ecut 12\n', ''))).toEqual([]);
      expect(check(`${DS}ecut: 10 ecut* 2\n`.replace('ecut 12\n', ''))).toEqual([]);
      expect(check(`ndtset 3\njdtset 1 2 5\n${BASE}ecut5 30\n`)).toEqual([]);
      expect(check(`ndtset 6\nudtset 2 3\n${BASE}ecut23 30\n`)).toEqual([]);
    });

    it('a dataset index without ndtset stops ABINIT; a variable appended with 0 too', () => {
      expect(errors(`${BASE}ecut1 10\n`)[0]).toMatchObject({ code: 'abinit-no-ndtset' });
      expect(errors(`${BASE}ecut: 10 ecut+ 1\n`)[0]).toMatchObject({ code: 'abinit-no-ndtset' });
      expect(errors(`${DS}ecut0 10\n`)[0]).toMatchObject({ code: 'abinit-dataset-zero' });
      expect(errors('ndtset 10000\n')[0].message).toMatch(/between 0 and 9999/);
    });

    it('an index the datasets do not run is only ignored', () => {
      const d = check(`${DS}ecut3 10\n`);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ severity: 'warning', code: 'abinit-dataset-unused' });
      expect(check(`${DS}ecut?5 10\n`)[0].code).toBe('abinit-dataset-unused');
    });

    it('the same variable twice, also with the wildcard forms for one dataset', () => {
      expect(errors(`${BASE}ecut 13\n`)[0]).toMatchObject({ code: 'abinit-duplicate' });
      expect(errors(`${DS}ecut1 1\necut1 2\n`)[0]).toMatchObject({ code: 'abinit-duplicate' });
      expect(errors(`ndtset 11\n${BASE}ecut?1 1\necut1? 2\n`)[0].message).toMatch(/both apply to dataset 11/);
    });

    it('series need their partner', () => {
      expect(check(`${DS}ecut: 10\n`.replace('ecut 12\n', '')).some((d) => d.code === 'abinit-series')).toBe(true);
      expect(check(`${DS}ecut+ 10\n`).some((d) => d.code === 'abinit-series')).toBe(true);
      expect(errors(`${DS}ecut: 10 ecut+ 1 ecut* 2\n`.replace('ecut 12\n', '')).some((d) => d.code === 'abinit-series')).toBe(true);
    });

    it('jdtset and udtset', () => {
      expect(errors(`ndtset 4\njdtset 1 2 3 4\nudtset 2 2\n${BASE}`)[0].message).toMatch(/cannot both be defined/);
      expect(errors(`ndtset 5\nudtset 2 2\n${BASE}`)[0].message).toMatch(/must be equal to ndtset/);
      expect(errors(`ndtset 2\njdtset 1 10000\n${BASE}`)[0].message).toMatch(/between 1 and 9999/);
      expect(errors(`ndtset 3\njdtset 1 2\n${BASE}`)[0].message).toMatch(/jdtset needs 3 values/);
    });

    it('checks each dataset against its own natom, and shares an array between datasets of different sizes', () => {
      const multi = 'ndtset 2\nntypat 1\nznucl 14\nnatom1 1\nnatom2 2\ntypat 1 1\nxred1 0 0 0\nxred2 0 0 0 0.5 0.5 0.5\necut 10\ntolvrs 1d-8\n';
      expect(check(multi)).toEqual([]);
      expect(errors(multi.replace('typat 1 1', 'typat 1'))[0].message).toMatch(/typat needs 2 values.*dataset 2/);
      expect(errors(multi.replace('natom2 2', 'natom2 3'))[0].message).toMatch(/needs 3 values/);
    });

    it('ntypat must agree between datasets without npsp', () => {
      expect(errors('ndtset 2\nntypat1 1\nntypat2 2\nznucl 14 8\nnatom 2\ntypat 1 2\nxred *0\necut 10\ntolvrs 1d-8\n').some((d) => d.code === 'abinit-ntypat')).toBe(true);
      expect(errors('ndtset 2\nnpsp 2\nntypat1 1\nntypat2 2\nznucl 14 8\nnatom 2\ntypat 1 2\nxred *0\necut 10\ntolvrs 1d-8\n').some((d) => d.code === 'abinit-ntypat')).toBe(false);
    });

    it('image variables are read as name_1img, name_lastimg', () => {
      expect(check(`${BASE}xred_1img 0 0 0 0 0 0\n`.replace('xred 0 0 0  1/4 1/4 1/4\n', '')).filter((d) => d.severity === 'error')).toEqual([]);
      expect(check(`${BASE}xred_img1 0 0 0\n`).some((d) => d.code === 'abinit-suffix')).toBe(true);
    });
  });

  describe('warnings', () => {
    it('k-point variables that kptopt does not read', () => {
      const d = check(BASE.replace('kptopt 1\nngkpt 2 2 2', 'kptopt 0\nnkpt 1\nkpt 0 0 0\nngkpt 2 2 2'));
      expect(d.map((x) => [x.severity, x.code])).toEqual([['warning', 'abinit-kpt-ignored']]);
      // used by one dataset: no warning
      expect(check(`ndtset 2\n${BASE.replace('kptopt 1', 'kptopt1 1\nkptopt2 0\nnkpt2 1\nkpt2 0 0 0')}`)).toEqual([]);
    });

    it('optforces with a force criterion', () => {
      expect(check(`${BASE.replace('tolvrs 1d-10', 'toldff 1d-6')}optforces 2\n`)[0]).toMatchObject({ severity: 'warning', code: 'abinit-optforces' });
      expect(check(`${BASE.replace('tolvrs 1d-10', 'toldff 1d-6')}optforces 1\n`)).toEqual([]);
    });

    it('typat missing for several atoms', () => {
      expect(check(BASE.replace('typat 1 1\n', ''))[0]).toMatchObject({ severity: 'warning', code: 'abinit-typat-missing' });
    });

    it('a suffix ABINIT never reads', () => {
      expect(check(`${BASE}ecut12345 3\n`).map((d) => d.code)).toEqual(['abinit-suffix']);
    });
  });

  it('puts a quick fix only where the edit is safe', () => {
    for (const d of check(`${BASE}ecut 13\nxred 0\n`)) expect(d.fix).toBeUndefined();
  });
});

describe('real ABINIT inputs', () => {
  it('validate without a single diagnostic', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    for (const f of fixtures) expect(check(f.text), f.name).toEqual([]);
  });
});

describe('formatAbinit', () => {
  it('splits variables, aligns the values, keeps comments and numbers', () => {
    const out = formatAbinit('acell 3*10 Bohr   ecut 270 eV   # c\nntypat   1\n\n\n\n! x\nznucl 14.0  \n');
    expect(out).toBe('acell  3*10 Bohr\necut   270 eV   # c\nntypat 1\n\n! x\nznucl 14.0\n');
  });

  it('lines a variable up with its own continuation lines and leaves those alone', () => {
    const t = 'rprim  0.0 0.5 0.5   # fcc\n       0.5 0.0 0.5\n       0.5 0.5 0.0\nxred\n  0.0 0.0 0.0\n  1/4 1/4 1/4\nntypat 1\n';
    expect(formatAbinit(t)).toBe(t);
  });

  it('keeps the comment in its column when the code changes length', () => {
    expect(formatAbinit('ecut 12.0   # a\nnatom 2     # b\n')).toBe('ecut  12.0  # a\nnatom 2     # b\n');
  });

  it('is idempotent, never changes a number or a comment, and keeps line endings', () => {
    const texts = [...fixtures.map((f) => f.text), 'ecut=12 natom 2\r\nxred 0 0 0\r\n  1 1 1 # c\r\n\r\n\r\n', '  ecut 3\n'];
    const words = (t: string) => t.split('\n').map((l) => l.replace(/[#!].*$/, '').replace(/=/g, ' ')).join(' ').split(/\s+/).filter(Boolean);
    for (const text of texts) {
      const once = formatAbinit(text)!;
      expect(once).toBeDefined();
      expect(formatAbinit(once)).toBe(once);
      expect(words(once)).toEqual(words(text));
      expect(once.match(/[#!].*/g)).toEqual(text.match(/[#!].*/g)?.map((c) => c.trimEnd()) ?? null);
      expect(once.endsWith(text.includes('\r\n') ? '\r\n' : '\n')).toBe(true);
    }
    expect(formatAbinit('ecut=12 natom 2\r\n')).toBe('ecut = 12\r\nnatom 2\r\n');
  });

  it('refuses a file ABINIT reads differently from how it looks', () => {
    expect(formatAbinit('ecut\t12\n')).toBeUndefined();
    expect(formatAbinit('xred 0 - 1\n')).toBeUndefined();
  });

  it('leaves include lines alone', () => {
    expect(formatAbinit('include "a.abi"\n  ecut 3\n')).toBe('include "a.abi"\necut 3\n');
  });
});

describe('abinitHover', () => {
  const text = 'ecut 20 Ha\nixc 2\ngeoopt "bfgs"\nndtset 2\necut2 10\n';
  const doc = parseAbinit(text);
  it('describes the variable under the cursor', () => {
    const h = abinitHover(doc, 2)!;
    expect(h.markdown).toContain('**ecut** · real');
    expect(h.markdown).toContain('Energy CUToff');
    expect(h.markdown).toContain('docs.abinit.org/variables/basic/#ecut');
    expect(text.slice(h.start, h.end)).toBe('ecut');
  });
  it('explains a dataset suffix, a unit and a documented value', () => {
    expect(abinitHover(doc, text.indexOf('ecut2') + 2)!.markdown).toContain('the value for dataset 2');
    expect(abinitHover(doc, text.indexOf('Ha') + 1)!.markdown).toContain('unit');
    expect(abinitHover(doc, text.indexOf('ixc 2') + 5)!.markdown).toMatch(/\*\*ixc = 2\*\*: LDA, Perdew-Zunger/);
    expect(abinitHover(doc, text.indexOf('"bfgs"') + 2)!.markdown).toContain('Broyden-Fletcher-Goldfarb-Shanno');
  });
  it('says nothing on numbers and unknown names', () => {
    expect(abinitHover(parseAbinit('foo 1\n'), 1)).toBeUndefined();
    expect(abinitHover(doc, 6)).toBeUndefined();
  });
});

describe('abinitCompletions', () => {
  const at = (text: string) => abinitCompletions(parseAbinit(text), text.length);
  it('offers variable names, those not set yet', () => {
    const c = at('ecut 10\nnat');
    expect(c.some((x) => x.label === 'natom' && x.kind === 'variable')).toBe(true);
    expect(c.some((x) => x.label === 'ecut')).toBe(false);
    expect(c.find((x) => x.label === 'natom')!.detail).toContain('integer');
  });
  it('offers the documented values after an integer or string variable', () => {
    expect(at('optdriver ').map((x) => x.label)).toEqual(expect.arrayContaining(['0', '1', '3', '99']));
    const g = at('geoopt ');
    expect(g.find((x) => x.label === 'bfgs')!.insertText).toBe('"bfgs"');
  });
  it('offers units after the values of an energy or length variable', () => {
    expect(at('ecut 10 ').map((x) => x.label)).toEqual(expect.arrayContaining(['Ha', 'Ry', 'eV'].map((s) => s.toLowerCase())));
    expect(at('acell 3*10 ').map((x) => x.label)).toEqual(expect.arrayContaining(['angstrom', 'bohr']));
    expect(at('natom 2 ').some((x) => x.label === 'ry')).toBe(false);
  });
  it('stays quiet in comments and inside numbers', () => {
    expect(at('ecut 10 # na')).toEqual([]);
    expect(at('ecut 1')).toEqual([]);
  });
  it('knows every unit word of the guide', () => {
    for (const w of ['ha', 'hartree', 'ry', 'rydberg', 'ev', 'mev', 'k', 'kelvin', 'bohr', 'angstrom', 'nm', 'tesla', 'au']) expect(ABINIT_UNIT_WORDS[w]).toBeDefined();
  });
});

describe('review fixes', () => {
  it('keeps an = inside a quoted string and treats it as a blank elsewhere', () => {
    const doc = parseAbinit('pseudos "Pseudos/a=b.psp8"\necut = 20\n');
    expect(doc.entries.find((e) => e.word === 'pseudos')?.args.map((v) => v.text)).toEqual(['"Pseudos/a=b.psp8"']);
    expect(doc.entries.find((e) => e.word === 'ecut')?.args.map((v) => v.text)).toEqual(['20']);
  });
});
