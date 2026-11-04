import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { qeHover } from '../../src/core/qe/hover';
import { parseQe } from '../../src/core/qe/parse';
import type { PseudoFile, PseudoLookup } from '../../src/core/qe/pseudos';
import { cardsOf } from '../../src/core/qe/tags';
import { functionalKey, parseUpf } from '../../src/core/qe/upf';
import { validateQe } from '../../src/core/qe/validate';

const upf = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'upf', name), 'utf8');
const SI = parseUpf(upf('Si.pbe-n-rrkjus_psl.1.0.0.UPF'))!;
const GE = parseUpf(upf('Ge.pz-bhs.UPF'))!;
const FE = parseUpf(upf('Fe.pz-nd-rrkjus.UPF'))!;
const ok = (info: typeof SI): PseudoFile => ({ status: 'ok', dir: '/pp', info });
const lookup = (entries: Record<string, PseudoFile>): PseudoLookup => new Map(Object.entries(entries));

/** A pw.x input with the given species and atoms (label list). */
const input = (opts: { species?: string; atoms?: string[]; system?: string; control?: string } = {}) => {
  const species = opts.species ?? 'Si 28.086 Si.UPF';
  const atoms = opts.atoms ?? ['Si', 'Si'];
  return (
    `&CONTROL\ncalculation = 'scf'${opts.control ? ', ' + opts.control : ''}\n/\n` +
    `&SYSTEM\nibrav = 2, celldm(1) = 10.2, nat = ${atoms.length}, ntyp = ${species.split('\n').length}, ecutwfc = 40, ecutrho = 320${opts.system ? ', ' + opts.system : ''}\n/\n&ELECTRONS\n/\n` +
    `ATOMIC_SPECIES\n${species}\nATOMIC_POSITIONS {alat}\n${atoms.map((a, i) => `${a} ${i * 0.25} 0 0`).join('\n')}\nK_POINTS {gamma}\n`
  );
};
const check = (text: string, files: Record<string, PseudoFile>) => validateQe(parseQe(text, { cards: cardsOf('pw') }), 'pw', { pseudos: lookup(files) });
const codes = (text: string, files: Record<string, PseudoFile>) => check(text, files).map((d) => d.code);

describe('parseUpf', () => {
  it('reads UPF 2 headers', () => {
    expect(SI).toMatchObject({ format: 'upf2', element: 'Si', type: 'US', zValence: 4, coreCorrection: true, spinOrbit: false, suggestedEcutwfc: 30, suggestedEcutrho: 240 });
    expect(GE).toMatchObject({ format: 'upf2', element: 'Ge', type: 'NC', zValence: 4, coreCorrection: false });
    expect(GE.suggestedEcutwfc).toBeUndefined();
  });

  it('reads UPF 1 headers', () => {
    expect(FE).toMatchObject({ format: 'upf1', element: 'Fe', type: 'US', zValence: 8, coreCorrection: true });
    expect(functionalKey(FE.functional)).toBe('PZ');
  });

  it('rejects other formats', () => {
    expect(parseUpf('Si 14 pseudopotential in the old PWscf format\n')).toBeUndefined();
    expect(parseUpf('')).toBeUndefined();
  });

  it('treats equivalent functional spellings as one', () => {
    expect(functionalKey(SI.functional)).toBe('PBE');
    expect(functionalKey('PBE')).toBe('PBE');
    expect(functionalKey('SLA PW PBX PBC')).toBe('PBE');
    expect(functionalKey(GE.functional)).toBe('PZ');
    expect(functionalKey('PBE-GGA')).toBe('PBE');
    expect(functionalKey(undefined)).toBeUndefined();
  });
});

describe('pseudopotential checks', () => {
  it('accepts matching pseudopotentials', () => {
    expect(codes(input(), { 'Si.UPF': ok(SI) })).toEqual([]);
  });

  it('reports a file that is not there', () => {
    const d = check(input(), { 'Si.UPF': { status: 'missing', dir: '/pp' } }).find((x) => x.code === 'qe-pseudo-missing')!;
    expect(d.message).toMatch(/Si\.UPF not found in \/pp/);
    expect(codes(input(), { 'Si.UPF': { status: 'unreadable', dir: '/pp' } })).toEqual([]);
  });

  it('notes the wrong element, by label', () => {
    expect(codes(input({ species: 'Ge 72.6 Si.UPF', atoms: ['Ge', 'Ge'] }), { 'Si.UPF': ok(SI) })).toEqual(['qe-pseudo-element']);
    // Labels with a number (sublattices) still name an element.
    expect(codes(input({ species: 'Si1 28 Si.UPF\nSi2 28 Si.UPF', atoms: ['Si1', 'Si2'] }), { 'Si.UPF': ok(SI) })).toEqual([]);
    expect(codes(input({ species: 'X 28 Si.UPF', atoms: ['X', 'X'] }), { 'Si.UPF': ok(SI) })).toEqual([]);
  });

  it('notes mixed functionals unless input_dft is set', () => {
    const species = 'Si 28 Si.UPF\nGe 72 Ge.UPF';
    const files = { 'Si.UPF': ok(SI), 'Ge.UPF': ok(GE) };
    expect(codes(input({ species, atoms: ['Si', 'Ge'] }), files)).toEqual(['qe-pseudo-functional']);
    expect(check(input({ species, atoms: ['Si', 'Ge'] }), files)[0].message).toMatch(/PBE \(Si\.UPF\) vs\. PZ \(Ge\.UPF\)/);
    expect(codes(input({ species, atoms: ['Si', 'Ge'], system: "input_dft = 'pbe'" }), files)).toEqual([]);
  });

  it('compares the cutoffs with what the generator suggests', () => {
    expect(codes(input({ system: '' }), { 'Si.UPF': ok(SI) })).toEqual([]);
    const low = check(input().replace('ecutwfc = 40, ecutrho = 320', 'ecutwfc = 25, ecutrho = 200'), { 'Si.UPF': ok(SI) });
    expect(low.map((d) => d.code)).toEqual(['qe-cutoff-low', 'qe-cutoff-low']);
    expect(low[0].message).toMatch(/ecutwfc = 25 Ry is below the 30 Ry/);
    expect(low[1].message).toMatch(/ecutrho = 200 Ry is below the 240 Ry/);
    const noRho = check(input().replace(', ecutrho = 320', ''), { 'Si.UPF': ok(SI) });
    expect(noRho.map((d) => d.message)).toEqual([expect.stringMatching(/default ecutrho \(4 × ecutwfc = 160 Ry\) is below the 240/)]);
  });

  it('notes the default ecutrho for ultrasoft pseudopotentials without a suggestion', () => {
    const text = input({ species: 'Fe 55.8 Fe.UPF', atoms: ['Fe'] }).replace(', ecutrho = 320', '');
    const d = check(text, { 'Fe.UPF': ok(FE) });
    expect(d.map((x) => `${x.code}:${x.severity}`)).toEqual(['qe-ecutrho-default:info']);
  });

  it('compares nbnd with the number of electrons', () => {
    const files = { 'Si.UPF': ok(SI) };
    expect(codes(input({ system: 'nbnd = 3' }), files)).toEqual(['qe-nbnd']);
    expect(check(input({ system: 'nbnd = 3' }), files)[0].message).toMatch(/8 valence electrons: at least 4 bands/);
    expect(codes(input({ system: 'nbnd = 4' }), files)).toEqual([]);
    expect(codes(input({ system: 'nbnd = 6, noncolin = .true.' }), files)).toEqual(['qe-nbnd']);
    expect(codes(input({ system: 'nbnd = 3', control: '' }).replace("calculation = 'scf'", "calculation = 'nscf'"), files)).toEqual([]);
  });

  it('notes an odd number of electrons with fixed occupations', () => {
    const files = { 'Si.UPF': ok(SI) };
    expect(codes(input({ system: 'tot_charge = 1' }), files)).toEqual(['qe-odd-electrons']);
    expect(codes(input({ system: "tot_charge = 1, occupations = 'smearing', degauss = 0.02" }), files)).toEqual([]);
    expect(codes(input({ atoms: ['Si'] }).replace('nat = 1', 'nat = 1'), files)).toEqual([]);
  });

  it('notes lspinorb without spin–orbit pseudopotentials', () => {
    expect(codes(input({ system: 'lspinorb = .true., noncolin = .true.' }), { 'Si.UPF': ok(SI) })).toEqual(['qe-pseudo-so']);
    expect(codes(input({ system: 'lspinorb = .true., noncolin = .true.' }), { 'Si.UPF': ok({ ...SI, spinOrbit: true }) })).toEqual([]);
  });

  it('describes the pseudopotential on hover', () => {
    const text = input();
    const doc = parseQe(text, { cards: cardsOf('pw') });
    const h = qeHover(doc, 'pw', text.indexOf('Si 28.086') + 3, { pseudos: lookup({ 'Si.UPF': ok(SI) }) })!;
    expect(h.markdown).toMatch(/element: \*\*Si\*\* · type: ultrasoft · functional: SLA {2}PW {3}PBX {2}PBC · valence electrons: 4/);
    expect(h.markdown).toMatch(/Suggested minimum cutoffs: ecutwfc 30 Ry, ecutrho 240 Ry/);
    expect(qeHover(doc, 'pw', text.indexOf('Si 28.086'))).toBeUndefined();
  });
});
