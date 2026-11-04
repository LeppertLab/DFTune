import { describe, expect, it } from 'vitest';
import { setVariables, type QeChange } from '../../src/core/qe/edit';
import { parseQe } from '../../src/core/qe/parse';
import { cardsOf } from '../../src/core/qe/tags';

const set = (text: string, ...changes: QeChange[]) => setVariables(text, 'pw', changes);
const c = (namelist: string, name: string, value: string | null, index?: string): QeChange => ({ namelist, name, value, index });
const entries = (text: string) => parseQe(text, { cards: cardsOf('pw') }).namelists.flatMap((n) => n.entries.map((e) => `${n.name}/${e.name}${e.index ? `(${e.index})` : ''}=${e.value}`));
const issues = (text: string) => parseQe(text, { cards: cardsOf('pw') }).issues;

const BASE = "&CONTROL\n  calculation = 'scf'  ! task\n  prefix = 'si'\n/\n&SYSTEM\n  ibrav = 2\n  ecutwfc = 25\n/\n&ELECTRONS\n/\nK_POINTS gamma\n";

describe('setVariables: setting values', () => {
  it('replaces a value and keeps the comment and everything else', () => {
    expect(set(BASE, c('CONTROL', 'calculation', "'relax'"))).toBe(BASE.replace("'scf'", "'relax'"));
    expect(set(BASE, c('SYSTEM', 'ECUTWFC', '40'))).toBe(BASE.replace('ecutwfc = 25', 'ecutwfc = 40'));
  });

  it('fills in `name =` without a value', () => {
    const out = set('&SYSTEM\n  nat =\n/\n', c('SYSTEM', 'nat', '2'));
    expect(out).toBe('&SYSTEM\n  nat = 2\n/\n');
  });

  it('adds a variable after the last one, with the same indent', () => {
    expect(set(BASE, c('SYSTEM', 'nat', '2'))).toBe(BASE.replace('  ecutwfc = 25\n', '  ecutwfc = 25\n  nat = 2\n'));
    const tabs = '&SYSTEM\n\tibrav = 2\n/\n';
    expect(set(tabs, c('SYSTEM', 'nat', '2'))).toBe('&SYSTEM\n\tibrav = 2\n\tnat = 2\n/\n');
  });

  it('adds to an empty namelist, on its own line', () => {
    expect(set(BASE, c('ELECTRONS', 'conv_thr', '1.0d-8'))).toBe(BASE.replace('&ELECTRONS\n/', '&ELECTRONS\n  conv_thr = 1.0d-8\n/'));
    expect(set('&ELECTRONS /\n', c('ELECTRONS', 'conv_thr', '1.0d-8'))).toBe('&ELECTRONS /\n'.replace('/', '\n  conv_thr = 1.0d-8\n/'));
  });

  it('adds to a namelist whose slash shares the last line', () => {
    const out = set('&SYSTEM ibrav=2, nat=2 /\n', c('SYSTEM', 'ntyp', '1'));
    expect(entries(out)).toEqual(['SYSTEM/ibrav=2', 'SYSTEM/nat=2', 'SYSTEM/ntyp=1']);
    expect(issues(out)).toEqual([]);
  });

  it('sets array elements separately', () => {
    const text = '&SYSTEM\n  starting_magnetization(1) = 0.5\n/\n';
    expect(set(text, c('SYSTEM', 'starting_magnetization', '-0.5', '2'))).toBe('&SYSTEM\n  starting_magnetization(1) = 0.5\n  starting_magnetization(2) = -0.5\n/\n');
    expect(set(text, c('SYSTEM', 'starting_magnetization', '0.7', '1'))).toBe('&SYSTEM\n  starting_magnetization(1) = 0.7\n/\n');
  });

  it('applies several changes in order', () => {
    const out = set(BASE, c('SYSTEM', 'nat', '2'), c('SYSTEM', 'ntyp', '1'), c('SYSTEM', 'nat', '3'));
    expect(entries(out)).toEqual(['CONTROL/calculation=\'scf\'', "CONTROL/prefix='si'", 'SYSTEM/ibrav=2', 'SYSTEM/ecutwfc=25', 'SYSTEM/nat=3', 'SYSTEM/ntyp=1']);
  });

  it('keeps CRLF line endings', () => {
    const crlf = BASE.replace(/\n/g, '\r\n');
    const out = set(crlf, c('SYSTEM', 'nat', '2'), c('ELECTRONS', 'conv_thr', '1.0d-8'));
    expect(out).not.toMatch(/[^\r]\n/);
    expect(entries(out)).toContain('SYSTEM/nat=2');
    expect(entries(out)).toContain('ELECTRONS/conv_thr=1.0d-8');
  });
});

describe('setVariables: namelists that are not there yet', () => {
  it('adds &IONS after &ELECTRONS and &CELL after &IONS', () => {
    const withIons = set(BASE, c('IONS', 'ion_dynamics', "'bfgs'"));
    expect(withIons).toBe(BASE.replace('&ELECTRONS\n/\n', "&ELECTRONS\n/\n&IONS\n  ion_dynamics = 'bfgs'\n/\n"));
    const withCell = set(withIons, c('CELL', 'cell_dynamics', "'bfgs'"));
    expect(withCell).toContain("&IONS\n  ion_dynamics = 'bfgs'\n/\n&CELL\n  cell_dynamics = 'bfgs'\n/\nK_POINTS");
    expect(issues(withCell)).toEqual([]);
  });

  it('adds a namelist that must come first or in the middle', () => {
    expect(set('&SYSTEM\n  ibrav = 2\n/\nK_POINTS gamma\n', c('CONTROL', 'prefix', "'x'"))).toBe("&CONTROL\n  prefix = 'x'\n/\n&SYSTEM\n  ibrav = 2\n/\nK_POINTS gamma\n");
    expect(set("&CONTROL\n/\n&ELECTRONS\n/\n", c('SYSTEM', 'nat', '1'))).toBe('&CONTROL\n/\n&SYSTEM\n  nat = 1\n/\n&ELECTRONS\n/\n');
  });

  it('adds a namelist to a file without any, before the cards', () => {
    expect(set('ATOMIC_SPECIES\nSi 28 Si.UPF\n', c('CONTROL', 'calculation', "'scf'"))).toBe("&CONTROL\n  calculation = 'scf'\n/\nATOMIC_SPECIES\nSi 28 Si.UPF\n");
    expect(set('', c('CONTROL', 'calculation', "'scf'"))).toBe("&CONTROL\n  calculation = 'scf'\n/\n");
  });

  it('adds after the last line when the previous namelist ends the file without a newline', () => {
    expect(set('&ELECTRONS\n/', c('IONS', 'ion_dynamics', "'bfgs'"))).toBe("&ELECTRONS\n/\n&IONS\n  ion_dynamics = 'bfgs'\n/\n");
  });

  it('keeps a comment after the closing slash of the previous namelist', () => {
    expect(set('&ELECTRONS\n/ ! done\nK_POINTS gamma\n', c('IONS', 'ion_dynamics', "'bfgs'"))).toBe("&ELECTRONS\n/ ! done\n&IONS\n  ion_dynamics = 'bfgs'\n/\nK_POINTS gamma\n");
  });
});

describe('setVariables: removing', () => {
  it('removes a variable alone on its line, with its comment', () => {
    expect(set(BASE, c('CONTROL', 'calculation', null))).toBe(BASE.replace("  calculation = 'scf'  ! task\n", ''));
  });

  it('removes one of several on a line, with its comma', () => {
    expect(set('&SYSTEM\n  ibrav = 2, nat = 2, ntyp = 1\n/\n', c('SYSTEM', 'nat', null))).toBe('&SYSTEM\n  ibrav = 2, ntyp = 1\n/\n');
    expect(set('&SYSTEM\n  ibrav = 2, nat = 2\n/\n', c('SYSTEM', 'nat', null))).toBe('&SYSTEM\n  ibrav = 2\n/\n');
    expect(set('&SYSTEM\n  ibrav = 2, nat = 2,  ! note\n/\n', c('SYSTEM', 'nat', null))).toBe('&SYSTEM\n  ibrav = 2  ! note\n/\n');
    expect(entries(set('&SYSTEM ibrav=2, nat=2 /\n', c('SYSTEM', 'nat', null)))).toEqual(['SYSTEM/ibrav=2']);
  });

  it('removes every occurrence of a repeated variable and only the right array element', () => {
    expect(entries(set('&SYSTEM\n nat = 1\n nat = 2\n ibrav = 1\n/\n', c('SYSTEM', 'nat', null)))).toEqual(['SYSTEM/ibrav=1']);
    expect(entries(set('&SYSTEM\n starting_magnetization(1) = 1\n starting_magnetization(2) = 2\n/\n', c('SYSTEM', 'starting_magnetization', null, '1')))).toEqual(['SYSTEM/starting_magnetization(2)=2']);
  });

  it('does nothing when the variable is not there', () => {
    expect(set(BASE, c('SYSTEM', 'nbnd', null))).toBe(BASE);
    expect(set(BASE, c('IONS', 'ion_dynamics', null))).toBe(BASE);
  });

  it('leaves a valid input', () => {
    for (const change of [c('CONTROL', 'prefix', null), c('SYSTEM', 'ecutwfc', null), c('SYSTEM', 'nat', '5')]) expect(issues(set(BASE, change)), change.name).toEqual([]);
  });
});
