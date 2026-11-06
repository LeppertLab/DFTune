import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBgw } from '../../src/core/bgw/format';
import { bgwCompletions, bgwHover } from '../../src/core/bgw/hover';
import { parseBgw } from '../../src/core/bgw/parse';
import { BGW_PROGRAMS, detectBgwProgram, keywordsOf, lookupKeyword, isAcceptedUndocumented, type BgwProgram } from '../../src/core/bgw/tags';
import { validateBgw } from '../../src/core/bgw/validate';

const root = join(__dirname, '..', 'fixtures', 'bgw');
const fixtures = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(join(root, d.name)).map((f) => ({ name: `${d.name}/${f}`, file: f, text: readFileSync(join(root, d.name, f), 'utf8') })));

const check = (program: BgwProgram, text: string) => validateBgw(parseBgw(text), program);
const codes = (program: BgwProgram, text: string) => check(program, text).map((d) => d.code);
const apply = (text: string, d: { fix?: { edit: { start: number; end: number; text: string } } }) => text.slice(0, d.fix!.edit.start) + d.fix!.edit.text + text.slice(d.fix!.edit.end);
const EPS = 'epsilon_cutoff 10.0\nnumber_bands 20\n\nbegin qpoints\n  0.0 0.0 0.001 1.0 1\n  0.0 0.0 0.5 1.0 0\nend\n';

describe('the keyword tables', () => {
  it('cover the documented keywords of the five programs', () => {
    expect(BGW_PROGRAMS.map((p) => keywordsOf(p).length)).toEqual([77, 98, 38, 106, 13]);
    expect(lookupKeyword('epsilon', 'epsilon_cutoff')).toMatchObject({ type: 'float', unit: 'Ry', required: true });
    expect(lookupKeyword('epsilon', 'qpoints')).toMatchObject({ kind: 'block', required: true });
    expect(lookupKeyword('epsilon', 'frequency_dependence')?.options.map((o) => o.value)).toEqual(['0', '2', '3']);
    expect(lookupKeyword('sigma', 'band_index_min')).toMatchObject({ type: 'integer', required: true });
    expect(lookupKeyword('epsilon', 'do_rpa')).toMatchObject({ type: 'toggle' });
  });

  it('are case-sensitive, and know the keywords the readers accept without documenting them', () => {
    expect(lookupKeyword('epsilon', 'Epsilon_cutoff')).toBeUndefined();
    expect(isAcceptedUndocumented('epsilon', 'number_qpoints')).toBe(true);
    expect(isAcceptedUndocumented('kernel', 'patched_sampling_co')).toBe(true);
    expect(isAcceptedUndocumented('inteqp', 'use_symmetries_shifted_grid')).toBe(true); // inteqp shares the absorption reader
    expect(isAcceptedUndocumented('epsilon', 'nonsense')).toBe(false);
  });
});

describe('detectBgwProgram', () => {
  it('goes by the file name, with the testsuite spellings', () => {
    expect(['epsilon.inp', 'eps_cd.inp', 'epsilon_0.inp', '/a/b/eps.inp'].map((f) => detectBgwProgram(f))).toEqual(Array(4).fill('epsilon'));
    expect(['sigma.inp', 'sig_GPP.inp', 'sig.inp'].map((f) => detectBgwProgram(f))).toEqual(Array(3).fill('sigma'));
    expect(['kernel.inp', 'kernel_finiteq.inp'].map((f) => detectBgwProgram(f))).toEqual(['kernel', 'kernel']);
    expect(['absorption.inp', 'absp_haydock.inp'].map((f) => detectBgwProgram(f))).toEqual(['absorption', 'absorption']);
    expect(detectBgwProgram('inteqp.inp')).toBe('inteqp');
  });

  it('falls back to keywords only one program has, and never guesses for other tools', () => {
    expect(detectBgwProgram('run.inp', 'epsilon_cutoff 5\n')).toBe('epsilon');
    expect(detectBgwProgram('run.inp', 'band_index_min 1\n')).toBe('sigma');
    expect(detectBgwProgram('run.inp', 'number_val_bands 4\n')).toBe('kernel');
    expect(detectBgwProgram('run.inp', 'number_val_bands_fine 4\n')).toBe('absorption');
    expect(detectBgwProgram('nonlinearoptics.inp', 'number_val_bands_fine 4\n')).toBeUndefined();
    expect(detectBgwProgram('plotxct.inp', 'number_val_bands_fine 4\n')).toBeUndefined();
    expect(detectBgwProgram('sig2wan.inp', '')).toBeUndefined();
    expect(detectBgwProgram('INCAR', '')).toBeUndefined();
  });
});

describe('parseBgw', () => {
  it('reads keywords, flags and blocks the way the Fortran reader does', () => {
    const doc = parseBgw('# comment\nepsilon_cutoff 10.0  # trailing\ndo_rpa\n\nbegin qpoints\n 0 0 0 1 1\nend\n');
    expect(doc.entries.map((e) => [e.keyword, e.value])).toEqual([['epsilon_cutoff', '10.0  # trailing'], ['do_rpa', '']]);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ name: 'qpoints', closed: true });
    expect(doc.blocks[0].rows.map((r) => r.text)).toEqual([' 0 0 0 1 1']);
    expect(doc.issues).toEqual([]);
  });

  it('reports an indented keyword or comment, which stops BerkeleyGW', () => {
    const doc = parseBgw('  epsilon_cutoff 10.0\n  # comment\n');
    expect(doc.issues.map((i) => i.code)).toEqual(['bgw-indent', 'bgw-indent']);
    expect(doc.issues[0].message).toMatch(/first column/);
    expect(doc.issues[1].message).toMatch(/comment must start with #/);
    expect(apply('  epsilon_cutoff 10.0\n', doc.issues[0])).toBe('epsilon_cutoff 10.0\n');
  });

  it('only ends a block at a line that is exactly "end"', () => {
    expect(parseBgw('begin qpoints\n 0 0 0 1 1\n  end\n').blocks[0].closed).toBe(false);
    expect(parseBgw('begin qpoints\n 0 0 0 1 1\nend   \n').blocks[0].closed).toBe(true);
    expect(parseBgw('begin qpoints\n').blocks[0].closed).toBe(false);
  });

  it('warns about lines longer than 256 characters', () => {
    expect(parseBgw(`number_bands 10 # ${'x'.repeat(300)}\n`).issues.map((i) => i.code)).toEqual(['bgw-long-line']);
  });
});

describe('validateBgw: real inputs', () => {
  it('accepts every fixture from the BerkeleyGW testsuite', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    for (const f of fixtures) {
      const program = detectBgwProgram(f.file, f.text);
      expect(program, f.name).toBeDefined();
      expect(check(program!, f.text), f.name).toEqual([]);
    }
  });
});

describe('validateBgw: problems', () => {
  it('stops on unknown keywords, with a fix for typos and wrong case', () => {
    const typo = check('epsilon', EPS.replace('number_bands', 'number_bandz'));
    expect(typo.map((d) => d.code)).toEqual(['bgw-unknown-keyword']);
    expect(typo[0].message).toMatch(/Did you mean number_bands\?/);
    expect(apply(EPS.replace('number_bands', 'number_bandz'), typo[0])).toBe(EPS);
    const wrongCase = check('epsilon', EPS + 'rpa_insulator\n');
    expect(wrongCase[0].message).toMatch(/Did you mean RPA_insulator\?/);
    expect(codes('epsilon', EPS + 'qwertyuiop 1\n')).toEqual(['bgw-unknown-keyword']);
    // A keyword of another program is unknown here.
    expect(codes('epsilon', EPS + 'band_index_min 1\n')).toEqual(['bgw-unknown-keyword']);
  });

  it('checks the values', () => {
    expect(codes('epsilon', EPS + 'number_bands 20.5\n')).toEqual(['bgw-duplicate', 'bgw-value']);
    expect(codes('epsilon', EPS.replace('10.0', 'ten'))).toEqual(['bgw-value']);
    expect(codes('epsilon', EPS.replace('number_bands 20', 'number_bands'))).toEqual(['bgw-value']);
    expect(codes('epsilon', EPS.replace('10.0', '1.0d1'))).toEqual([]);
    expect(codes('epsilon', EPS + 'frequency_dependence 1\n')).toEqual(['bgw-eps-frequency']); // the specific rule replaces the generic note
    expect(codes('epsilon', EPS + 'number_bands 5\n')).toEqual(['bgw-duplicate']);
    expect(codes('epsilon', EPS + 'frequency_dependence 2\n')).toEqual([]);
    expect(codes('epsilon', EPS + 'cvfit 0.0 0.0 0.0\n')).toEqual(['bgw-value']);
    expect(codes('epsilon', EPS + 'cvfit 0.0 0.0 0.0 0.0 0.0 0.0\n')).toEqual([]);
  });

  it('wants the required keywords and blocks', () => {
    expect(codes('epsilon', 'number_bands 20\n')).toEqual(['bgw-required', 'bgw-required']);
    expect(check('epsilon', EPS.replace('epsilon_cutoff 10.0\n', '')).map((d) => d.message)).toEqual(['epsilon_cutoff is required in epsilon.inp.']);
    expect(check('sigma', 'number_bands 20\n').map((d) => d.message).sort()).toEqual(['band_index_max is required in sigma.inp.', 'band_index_min is required in sigma.inp.', 'begin kpoints … end is required in sigma.inp.']);
  });

  it('reports a duplicate keyword', () => {
    expect(codes('epsilon', EPS + 'number_bands 30\n')).toEqual(['bgw-duplicate']);
  });

  it('checks blocks: name, end, rows', () => {
    expect(codes('epsilon', EPS.replace('qpoints', 'kpoints'))).toContain('bgw-block');
    expect(codes('absorption', 'begin qpoints\nend\n')).toContain('bgw-block');
    expect(check('absorption', 'begin qpoints\nend\n').find((d) => d.code === 'bgw-block')?.message).toMatch(/this input has no blocks/);
    expect(codes('epsilon', EPS.replace('end\n', ''))).toContain('bgw-unterminated');
    expect(codes('epsilon', EPS.replace('end\n', '  end\n'))).toContain('bgw-unterminated');
    expect(codes('epsilon', EPS.replace('  0.0 0.0 0.001 1.0 1', '  0.0 0.0 0.001 1.0'))).toEqual(['bgw-block-row']);
    expect(codes('epsilon', EPS.replace('1.0 1\n', '1.0 x\n'))).toEqual(['bgw-block-row']);
    expect(codes('epsilon', EPS.replace('1.0 1\n', '1.0 1.5\n'))).toEqual(['bgw-block-row']);
    expect(codes('epsilon', EPS.replace('1.0 1\n', '1.0 3\n'))).toEqual(['bgw-block-row']);
    expect(codes('epsilon', EPS.replace('0.0 0.0 0.001 1.0 1', '0.0 0.0 0.001 0 1'))).toEqual(['bgw-block-row']);
    // blank lines and comments in a block are read as rows
    const blank = EPS.replace('  0.0 0.0 0.001 1.0 1\n', '  0.0 0.0 0.001 1.0 1\n\n');
    expect(codes('epsilon', blank)).toEqual(['bgw-block-row']);
    expect(codes('epsilon', apply(blank, check('epsilon', blank)[0]))).toEqual([]);
    expect(codes('epsilon', EPS.replace('  0.0 0.0 0.5', '# a comment\n  0.0 0.0 0.5'))).toEqual(['bgw-block-row']);
  });

  it('needs do_rpa before the q-points and a weight on every row', () => {
    const rpa = 'do_rpa\n' + EPS;
    expect(codes('epsilon', rpa)).toEqual(['bgw-block-row', 'bgw-block-row']);
    expect(codes('epsilon', rpa.replace(/ 1\n/, ' 1 0.5\n').replace(/ 0\n/, ' 0 0.5\n'))).toEqual([]);
    expect(codes('epsilon', EPS + 'do_rpa\n').sort()).toEqual(['bgw-block-row', 'bgw-block-row', 'bgw-rpa-order']);
  });

  it('checks the blocks of sigma.inp', () => {
    const sigma = 'band_index_min 1\nband_index_max 4\n\nbegin kpoints\n  0.0 0.0 0.0 1.0\nend\n';
    expect(codes('sigma', sigma)).toEqual([]);
    expect(codes('sigma', sigma + 'begin diag\n  1\n  2\nend\n')).toEqual([]);
    expect(codes('sigma', sigma + 'begin diag\n  1.5\nend\n')).toEqual(['bgw-block-row']);
    expect(codes('sigma', sigma + 'begin offdiag\n  1 2 3\nend\n')).toEqual([]);
    expect(codes('sigma', sigma + 'begin offdiag\n  1 2\nend\n')).toEqual(['bgw-block-row']);
    expect(codes('sigma', sigma + 'begin qpoints\n  0 0 0 1 1\nend\n')).toEqual(['bgw-sig-qpoints']); // only used for Hartree–Fock
  });

  it('says that a block keyword needs begin … end', () => {
    expect(codes('epsilon', EPS + 'qpoints 0 0 0 1 1\n')).toEqual(['bgw-block-keyword']);
  });
});

describe('hover and completion', () => {
  it('describes a keyword with its type, unit, documentation and the chosen value', () => {
    const doc = parseBgw(EPS + 'frequency_dependence 2\n');
    const h = bgwHover(doc, 'epsilon', 3)!;
    expect(h.markdown).toMatch(/^\*\*epsilon_cutoff\*\* · epsilon\.inp · float \(Ry\) · \*\*required\*\*/);
    expect(h.markdown).toMatch(/Energy cutoff for the dielectric matrix/);
    expect(h.markdown).toMatch(/manual\.berkeleygw\.org\/4\.0\/epsilon-keywords\/#epsilon_cutoff/);
    const freq = bgwHover(doc, 'epsilon', EPS.length + 3)!;
    expect(freq.markdown).toMatch(/\*\*2\*\*: compute the full frequency dependent inverse dielectric matrix/);
    expect(bgwHover(doc, 'epsilon', EPS.indexOf('qpoints') + 2)!.markdown).toMatch(/begin qpoints … end/);
    expect(bgwHover(doc, 'epsilon', EPS.indexOf('20'))).toBeUndefined();
  });

  it('completes keywords at the start of a line, required first, and the values of integer keywords', () => {
    const doc = parseBgw('epsilon_cutoff 10\nnum');
    const items = bgwCompletions(doc, 'epsilon', doc.text.length);
    expect(items.map((i) => i.label)).toContain('number_bands');
    expect(items.map((i) => i.label)).not.toContain('epsilon_cutoff');
    expect(items.find((i) => i.label === 'begin qpoints')?.insertText).toBe('begin qpoints\n  $0\nend');
    expect(items.find((i) => i.label === 'do_rpa')?.insertText).toBe('do_rpa');
    expect(items.find((i) => i.label === 'number_bands')?.insertText).toBe('number_bands ${1:1000}');
    expect(bgwCompletions(parseBgw(''), 'epsilon', 0).find((i) => i.label === 'begin qpoints')?.sortText).toBe('0qpoints');
    expect(bgwCompletions(parseBgw(''), 'epsilon', 0).find((i) => i.label === 'number_bands')?.sortText).toBe('1number_bands');
    const values = bgwCompletions(parseBgw('frequency_dependence '), 'epsilon', 'frequency_dependence '.length);
    expect(values.map((v) => v.label)).toEqual(['0', '2', '3']);
    expect(bgwCompletions(parseBgw('begin qpoints\n 0 0\nend\n'), 'epsilon', 16)).toEqual([]);
    expect(bgwCompletions(parseBgw('# comment'), 'epsilon', 5)).toEqual([]);
  });
});

describe('formatBgw', () => {
  it('aligns the values of consecutive keyword lines and keeps everything else', () => {
    expect(formatBgw('epsilon_cutoff 10.0\nnumber_bands   20 # bands\n\n\n\n# comment\ndo_rpa   \nbegin qpoints\n 0 0 0 1 1   \nend\n')).toBe(
      'epsilon_cutoff 10.0\nnumber_bands   20 # bands\n\n# comment\ndo_rpa\nbegin qpoints\n 0 0 0 1 1\nend\n',
    );
    expect(formatBgw('a 1\nlonger_name 2\n'.replace('a 1', 'number_bands 5').replace('longer_name', 'epsilon_cutoff'))).toBe('number_bands   5\nepsilon_cutoff 2\n');
  });

  it('refuses a file whose layout BerkeleyGW would stop on', () => {
    expect(formatBgw('  epsilon_cutoff 10.0\n')).toBeUndefined();
  });

  it('is idempotent and keeps every word, on all the fixtures', () => {
    const words = (t: string) => t.split(/\s+/).filter(Boolean);
    for (const f of fixtures) {
      const once = formatBgw(f.text)!;
      expect(once, f.name).toBeDefined();
      expect(formatBgw(once), f.name).toBe(once);
      expect(words(once), f.name).toEqual(words(f.text));
      expect(check(detectBgwProgram(f.file, f.text)!, once), f.name).toEqual([]);
    }
  });

  it('keeps CRLF line endings', () => {
    expect(formatBgw('number_bands   5\r\nepsilon_cutoff 2\r\n')).toBe('number_bands   5\r\nepsilon_cutoff 2\r\n');
  });
});
