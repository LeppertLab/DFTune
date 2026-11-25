import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatCastep } from '../../src/core/castep/format';
import { castepCompletions, castepHover } from '../../src/core/castep/hover';
import { parseCastep } from '../../src/core/castep/parse';
import { canonicalCastepName, castepFileOf, castepKeywordsOf, castepSeed, lookupCastepKeyword, type CastepFile } from '../../src/core/castep/tags';
import { validateCastep } from '../../src/core/castep/validate';

const root = join(__dirname, '..', 'fixtures', 'castep');
const fixtures = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(join(root, d.name)).map((f) => ({ name: `${d.name}/${f}`, file: castepFileOf(f)!, text: readFileSync(join(root, d.name, f), 'utf8') })));

const check = (file: CastepFile, text: string, neighbor?: string) => validateCastep(parseCastep(text), file, { neighbor: neighbor === undefined ? undefined : parseCastep(neighbor) });
const codes = (file: CastepFile, text: string, neighbor?: string) => check(file, text, neighbor).map((d) => d.code);
const apply = (text: string, d: { fix?: { edit: { start: number; end: number; text: string } } }) => text.slice(0, d.fix!.edit.start) + d.fix!.edit.text + text.slice(d.fix!.edit.end);
const CELL = '%BLOCK LATTICE_CART\n3 0 0\n0 3 0\n0 0 3\n%ENDBLOCK LATTICE_CART\n%BLOCK POSITIONS_FRAC\nSi 0 0 0\n%ENDBLOCK POSITIONS_FRAC\n';

describe('the keyword tables', () => {
  it('come from the documentation, with types, defaults and values', () => {
    expect(castepKeywordsOf('cell').length).toBeGreaterThan(50);
    expect(castepKeywordsOf('param').length).toBeGreaterThan(150);
    expect(lookupCastepKeyword('param', 'cut_off_energy')).toMatchObject({ type: 'physical', unit: 'eV' });
    expect(lookupCastepKeyword('param', 'GEOM_METHOD')).toMatchObject({ type: 'string', default: 'LBFGS', options: ['LBFGS', 'BFGS', 'TPSD', 'DAMPEDMD', 'FIRE'] });
    expect(lookupCastepKeyword('param', 'phonon_method')?.options).toEqual(['DFPT', 'LINEARRESPONSE', 'FINITEDISPLACEMENT']);
    expect(lookupCastepKeyword('cell', 'lattice_cart')).toMatchObject({ kind: 'block' });
    expect(lookupCastepKeyword('cell', 'kpoint_mp_grid')).toMatchObject({ type: 'integer-vector' });
  });

  it('are case-insensitive and resolve the documented synonyms', () => {
    expect(canonicalCastepName('KPOINTS_MP_GRID')).toBe('kpoint_mp_grid');
    expect(canonicalCastepName('BS_KPOINT_PATH')).toBe('spectral_kpoint_path');
    expect(canonicalCastepName('optics_kpoints_mp_spacing')).toBe('spectral_kpoint_mp_spacing');
    expect(lookupCastepKeyword('param', 'spin_polarized')?.name).toBe('spin_polarised');
    expect(lookupCastepKeyword('param', 'cutoff_energy')?.name).toBe('cut_off_energy');
    expect(lookupCastepKeyword('cell', 'phonon_kpoints_path')?.name).toBe('PHONON_KPOINT_PATH');
  });

  it('know the files and seeds', () => {
    expect(castepFileOf('/x/Si2.CELL')).toBe('cell');
    expect(castepFileOf('a.param')).toBe('param');
    expect(castepFileOf('a.in')).toBeUndefined();
    expect(castepSeed('/x/y/Si2.param')).toBe('Si2');
  });
});

describe('parseCastep', () => {
  it('reads the three separators, case-insensitive blocks and all comment characters', () => {
    const doc = parseCastep('Task : energy\ncut_off_energy = 500 eV ! cut\nxc_functional pbe # c\n; whole line\n%Block Lattice_Cart\nbohr\n1 0 0 ; c\n%EndBlock LATTICE_CART\n');
    expect(doc.entries.map((e) => [e.keyword, e.sep, e.value])).toEqual([
      ['Task', ':', 'energy'],
      ['cut_off_energy', '=', '500 eV'],
      ['xc_functional', ' ', 'pbe'],
    ]);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ name: 'Lattice_Cart', closed: true });
    expect(doc.blocks[0].rows.map((r) => r.text.trim())).toEqual(['bohr', '1 0 0']);
    expect(doc.issues).toEqual([]);
  });

  it('records spans', () => {
    const text = 'task : energy\n';
    const e = parseCastep(text).entries[0];
    expect(text.slice(e.keySpan.start, e.keySpan.end)).toBe('task');
    expect(text.slice(e.valueSpan.start, e.valueSpan.end)).toBe('energy');
    expect(text.slice(e.sepSpan.start, e.sepSpan.end)).toBe(' : ');
  });

  it('accepts the key glued to the colon and a flag without value', () => {
    const doc = parseCastep('kpoints_mp_grid: 4 4 4\nsymmetry_generate\n');
    expect(doc.entries.map((e) => [e.keyword, e.value])).toEqual([
      ['kpoints_mp_grid', '4 4 4'],
      ['symmetry_generate', ''],
    ]);
  });

  it('reports an unterminated block as an error', () => {
    const doc = parseCastep('%BLOCK LATTICE_CART\n1 0 0\n');
    expect(doc.issues).toMatchObject([{ severity: 'error', code: 'castep-unterminated' }]);
    expect(doc.blocks[0].closed).toBe(false);
  });
});

describe('validateCastep', () => {
  it('finds no problem in the fixtures, alone or together', () => {
    for (const f of fixtures) expect(check(f.file, f.text), f.name).toEqual([]);
    for (const dir of ['si', 'fe']) {
      const cell = fixtures.find((f) => f.name.startsWith(`${dir}/`) && f.file === 'cell')!;
      const param = fixtures.find((f) => f.name.startsWith(`${dir}/`) && f.file === 'param')!;
      expect(check('cell', cell.text, param.text), `${dir} cell`).toEqual([]);
      expect(check('param', param.text, cell.text), `${dir} param`).toEqual([]);
    }
  });

  it('warns about an unknown keyword, with a did-you-mean fix, but does not call it an error', () => {
    const text = 'cut_of_energy : 500 eV\n';
    const [d] = check('param', text);
    expect(d).toMatchObject({ severity: 'warning', code: 'castep-unknown-keyword' });
    expect(d.message).toContain('Did you mean cut_off_energy?');
    expect(apply(text, d)).toBe('cut_off_energy : 500 eV\n');
    expect(check('param', 'some_future_keyword 1\n')[0].severity).toBe('warning');
  });

  it('says when a keyword belongs to the other file', () => {
    expect(codes('param', 'kpoint_mp_grid 3 3 3\n')).toEqual(['castep-wrong-file']);
    expect(codes('cell', CELL + 'cut_off_energy 300 eV\n')).toEqual(['castep-wrong-file']);
  });

  it('errors on blocks that are not closed and on a missing lattice or positions', () => {
    expect(check('cell', '%BLOCK LATTICE_CART\n3 0 0\n').map((d) => [d.severity, d.code])).toContainEqual(['error', 'castep-unterminated']);
    const missing = check('cell', 'kpoint_mp_grid 2 2 2\n');
    expect(missing.filter((d) => d.code === 'castep-required').map((d) => d.severity)).toEqual(['error', 'error']);
    expect(codes('cell', 'unit_cell Si2\n')).toEqual([]);
    expect(codes('cell', 'unit_cell Si2\n' + CELL)).toContain('castep-exclusive');
  });

  it('errors on a wrong value type', () => {
    expect(check('param', 'geom_max_iter : many\n')[0]).toMatchObject({ severity: 'error', code: 'castep-value' });
    expect(check('param', 'cut_off_energy : lots eV\n')[0]).toMatchObject({ severity: 'error', code: 'castep-value' });
    expect(check('param', 'fix_occupancy : maybe\n')[0]).toMatchObject({ severity: 'error', code: 'castep-value' });
    expect(codes('cell', CELL + 'kpoint_mp_grid 4 4\n')).toEqual(['castep-value']);
    expect(codes('cell', CELL + 'kpoint_mp_offset 0 0 x\n')).toEqual(['castep-value']);
    for (const ok of ['cut_off_energy : 500 eV', 'cut_off_energy 5e2', 'cut_off_energy = 0.5*1000', 'fix_occupancy T', 'fix_occupancy = .true.', 'geom_max_iter 30']) expect(codes('param', `${ok}\n`), ok).toEqual([]);
  });

  it('errors on basis_precision values, but only warns about the other documented lists', () => {
    expect(check('param', 'basis_precision : extreme\n')[0]).toMatchObject({ severity: 'error', code: 'castep-option' });
    expect(check('param', 'geom_method : MAGIC\n')[0]).toMatchObject({ severity: 'warning', code: 'castep-option' });
    expect(codes('param', 'geom_method : lbfgs\nmd_thermostat nose-hoover\n')).toEqual([]);
  });

  it('checks the rows of the lattice, positions and k-point blocks', () => {
    expect(codes('cell', CELL.replace('3 0 0', '3 0'))).toEqual(['castep-block-row']);
    expect(codes('cell', CELL.replace('Si 0 0 0', 'Si 0 0'))).toEqual(['castep-block-row']);
    expect(codes('cell', CELL.replace('%BLOCK LATTICE_CART\n', '%BLOCK LATTICE_CART\nbohr\n'))).toEqual([]);
    expect(codes('cell', CELL.replace('3 0 0\n0 3 0\n0 0 3\n', '3 0 0\n0 3 0\n'))).toContain('castep-block-rows');
    expect(codes('cell', CELL.replace('Si 0 0 0', 'Si 0 0 0 SPIN=up'))).toEqual(['castep-value']);
    const kp = CELL + '%BLOCK KPOINT_LIST\n0 0 0 0.5\n0.5 0 0 0.25\n%ENDBLOCK KPOINT_LIST\n';
    expect(check('cell', kp)[0]).toMatchObject({ severity: 'warning', code: 'castep-kpoint-weights' });
  });

  it('knows the lattice angle limits and CELL_CONSTRAINTS', () => {
    const abc = '%BLOCK LATTICE_ABC\n3 3 3\n90 90 190\n%ENDBLOCK LATTICE_ABC\n%BLOCK POSITIONS_FRAC\nSi 0 0 0\n%ENDBLOCK POSITIONS_FRAC\n';
    expect(check('cell', abc)).toMatchObject([{ severity: 'warning', code: 'castep-lattice' }]);
    expect(codes('cell', CELL + '%BLOCK CELL_CONSTRAINTS\n1 1 1\n0 0 0\n%ENDBLOCK CELL_CONSTRAINTS\n')).toEqual([]);
    expect(codes('cell', CELL + '%BLOCK CELL_CONSTRAINTS\n1 1 1\n1 0 0\n%ENDBLOCK CELL_CONSTRAINTS\n')).toEqual(['castep-constraint']);
  });

  it('applies the exclusive groups: errors for lattice and positions, warnings for the k-point sets', () => {
    const both = CELL + '%BLOCK LATTICE_ABC\n3 3 3\n90 90 90\n%ENDBLOCK LATTICE_ABC\n';
    expect(check('cell', both)[0]).toMatchObject({ severity: 'error', code: 'castep-exclusive' });
    expect(check('cell', CELL + 'kpoint_mp_grid 2 2 2\nkpoints_mp_spacing 0.1\n')[0]).toMatchObject({ severity: 'warning', code: 'castep-exclusive' });
    expect(codes('cell', CELL + 'kpoint_mp_grid 2 2 2\nkpoint_mp_offset 0.5 0.5 0.5\n')).toEqual([]);
  });

  it('warns about a duplicate keyword, also under a synonym', () => {
    expect(codes('cell', CELL + 'kpoint_mp_grid 2 2 2\nKPOINTS_MP_GRID 3 3 3\n')).toContain('castep-duplicate');
  });

  it('warns about a species that is no element when no mass and potential are given', () => {
    expect(codes('cell', CELL.replace('Si 0 0 0', 'Xx 0 0 0'))).toEqual(['castep-species']);
    expect(codes('cell', CELL.replace('Si 0 0 0', 'Xx 0 0 0') + '%BLOCK SPECIES_MASS\nXx 12.0\n%ENDBLOCK SPECIES_MASS\n%BLOCK SPECIES_POT\nXx x.usp\n%ENDBLOCK SPECIES_POT\n')).toEqual([]);
    expect(codes('cell', CELL + '%BLOCK SPECIES_MASS\nGe 72.6\n%ENDBLOCK SPECIES_MASS\n')).toEqual(['castep-species']);
    expect(codes('cell', CELL + '%BLOCK SPECIES_POT\nNCP\n%ENDBLOCK SPECIES_POT\n')).toEqual([]);
  });

  it('warns about preliminary basis precision and the delta-SCF restrictions', () => {
    expect(check('param', 'basis_precision : coarse\n')[0]).toMatchObject({ severity: 'warning', code: 'castep-basis-precision' });
    expect(codes('param', 'calculate_deltascf : true\nmetals_method : edft\nspin_treatment : vector\n')).toEqual(['castep-deltascf', 'castep-deltascf']);
    expect(codes('param', 'calculate_deltascf : true\nmetals_method : dm\n')).toEqual([]);
  });

  it('hints at writing the structure after a geometry optimisation', () => {
    expect(check('param', 'task : geomopt\n')[0]).toMatchObject({ severity: 'hint', code: 'castep-geom-write' });
    expect(codes('param', 'task : geomopt\nwrite_cif_structure : true\n')).toEqual([]);
  });
});

describe('across the two files of a seed', () => {
  const fe = fixtures.filter((f) => f.name.startsWith('fe/'));
  const [cell, param] = [fe.find((f) => f.file === 'cell')!.text, fe.find((f) => f.file === 'param')!.text];

  it('asks for an initial spin when spin_polarised is true and neither file has one', () => {
    const noSpin = cell.replace(' SPIN=2', '');
    expect(check('param', param, noSpin)[0]).toMatchObject({ severity: 'warning', code: 'castep-spin' });
    expect(codes('param', param, cell)).toEqual([]);
    expect(codes('param', param + 'spin : 1\n', noSpin)).toEqual([]);
    expect(codes('param', param)).toEqual([]); // no cell file found: nothing is guessed
  });

  it('notes SPIN= in the cell file when the param file turns spin polarisation off', () => {
    expect(codes('cell', cell, param.replace('spin_polarised : true', 'spin_polarised : false'))).toEqual(['castep-spin']);
  });

  it('wants spectral k-points for a band structure', () => {
    const si = fixtures.filter((f) => f.name.startsWith('si/'));
    const siCell = si.find((f) => f.file === 'cell')!.text;
    const siParam = si.find((f) => f.file === 'param')!.text;
    const noPath = siCell.replace(/%block spectral_kpoint_path[\s\S]*%endblock spectral_kpoint_path\n/i, '');
    expect(check('param', siParam, noPath)[0]).toMatchObject({ severity: 'warning', code: 'castep-bands-kpoints' });
    expect(check('cell', noPath, siParam)[0]).toMatchObject({ severity: 'warning', code: 'castep-bands-kpoints' });
    // The BS_ prefix is the same keyword.
    expect(codes('param', siParam, siCell.replace(/spectral_kpoint_path/gi, 'BS_KPOINT_PATH'))).toEqual([]);
  });

  it('notices a geometry optimisation with everything fixed', () => {
    const fixed = cell + 'fix_all_ions : true\nfix_all_cell : true\n';
    expect(codes('cell', fixed, param)).toEqual(['castep-fixed']);
    expect(codes('param', param, fixed)).toEqual(['castep-fixed']);
    expect(codes('cell', cell + 'fix_all_cell : true\n', param)).toEqual([]);
  });
});

describe('formatCastep', () => {
  const messy = 'task=energy\ncut_off_energy   :   500 eV   !  note\nxc_functional pbe  \n\n\n\n# a comment\nspin_polarised true\n%block positions_frac\n  Si   0.1  0.2  0.3   spin=1 ! row\n\n  Si 0.5 0.5 0.5\n%endblock positions_frac\nsymmetry_generate\nkpoints_mp_grid 3 3 3';

  it('normalises the separator, aligns the values and keeps comments and block rows', () => {
    expect(formatCastep(messy)).toBe(
      'task           : energy\ncut_off_energy : 500 eV   !  note\nxc_functional  : pbe\n\n# a comment\nspin_polarised : true\n%block positions_frac\n  Si   0.1  0.2  0.3   spin=1 ! row\n\n  Si 0.5 0.5 0.5\n%endblock positions_frac\nsymmetry_generate\nkpoints_mp_grid : 3 3 3\n',
    );
  });

  it('is idempotent, on the messy input and on the fixtures, and never changes a value', () => {
    for (const text of [messy, ...fixtures.map((f) => f.text)]) {
      const once = formatCastep(text)!;
      expect(formatCastep(once)).toBe(once);
      const strip = (t: string) => t.replace(/[\s:=]+/g, ' ').trim();
      expect(strip(once)).toBe(strip(text));
    }
  });

  it('refuses a file with a block that is not closed, and keeps CRLF', () => {
    expect(formatCastep('%BLOCK X\n1 2 3\n')).toBeUndefined();
    expect(formatCastep('task=energy\r\ncut_off_energy=1\r\n')).toBe('task           : energy\r\ncut_off_energy : 1\r\n');
  });
});

describe('hover and completion', () => {
  it('describes a keyword with its type, default and values', () => {
    const text = 'geom_method : lbfgs\n';
    const h = castepHover(parseCastep(text), 'param', 3)!;
    expect(h.markdown).toContain('**geom_method** · .param · string');
    expect(h.markdown).toContain('default: `LBFGS`');
    expect(h.markdown).toContain('`LBFGS`, `BFGS`, `TPSD`');
    expect(text.slice(h.start, h.end)).toBe('geom_method');
    expect(castepHover(parseCastep(text), 'param', 15)).toBeUndefined();
  });

  it('describes a block from its %BLOCK line, whatever the case', () => {
    const text = '%block Lattice_Cart\n1 0 0\n%endblock Lattice_Cart\n';
    expect(castepHover(parseCastep(text), 'cell', 10)!.markdown).toContain('%BLOCK LATTICE_CART');
  });

  it('completes keywords not yet set, block names and values', () => {
    const text = 'task : energy\nbasis';
    const labels = castepCompletions(parseCastep(text), 'param', text.length).map((c) => c.label);
    expect(labels).toContain('basis_precision');
    expect(labels).not.toContain('task');
    const v = 'basis_precision : ';
    expect(castepCompletions(parseCastep(v), 'param', v.length).map((c) => c.label)).toEqual(['coarse', 'medium', 'fine', 'precise']);
    const l = 'fix_occupancy ';
    expect(castepCompletions(parseCastep(l), 'param', l.length).map((c) => c.label)).toEqual(['TRUE', 'FALSE']);
    const b = '%BLOCK ';
    expect(castepCompletions(parseCastep(b), 'cell', b.length).map((c) => c.label)).toContain('LATTICE_CART');
    const top = castepCompletions(parseCastep(''), 'cell', 0).find((c) => c.label === '%BLOCK LATTICE_ABC')!;
    expect(top.insertText).toBe('%BLOCK LATTICE_ABC\n  $0\n%ENDBLOCK LATTICE_ABC');
  });

  it('offers nothing inside a block or a comment', () => {
    const text = '%BLOCK LATTICE_CART\n1 0 0\n';
    expect(castepCompletions(parseCastep(text), 'cell', text.length)).toEqual([]);
    const c = 'task : energy ! cut';
    expect(castepCompletions(parseCastep(c), 'param', c.length)).toEqual([]);
  });
});
