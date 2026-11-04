import { describe, expect, it } from 'vitest';
import { setVariables } from '../../src/core/qe/edit';
import { qeCompletions } from '../../src/core/qe/hover';
import { parseQe } from '../../src/core/qe/parse';
import { qeCell } from '../../src/core/qe/structure';
import { cardsOf } from '../../src/core/qe/tags';
import { functionalKey } from '../../src/core/qe/upf';
import { validateQe } from '../../src/core/qe/validate';

const parse = (t: string) => parseQe(t, { cards: cardsOf('pw') });
const codes = (t: string) => validateQe(parse(t), 'pw').map((d) => d.code);
const set = (t: string, name: string, value: string | null, nl = 'SYSTEM') => setVariables(t, 'pw', [{ namelist: nl, name, value }]);

describe('namelists closed with &END', () => {
  it('inserts before the &END, not inside it', () => {
    const out = set('&SYSTEM\n ibrav=1, nat=2 &END\n', 'ntyp', '1');
    expect(out).toContain('&END');
    expect(out).not.toMatch(/&EN\b/);
    expect(parse(out).issues).toEqual([]);
    expect(parse(out).namelists[0].entries.map((e) => e.name)).toEqual(['ibrav', 'nat', 'ntyp']);
    const empty = set('&ELECTRONS &END\n', 'conv_thr', '1.0d-8', 'ELECTRONS');
    expect(parse(empty).issues).toEqual([]);
    expect(parse(empty).namelists[0].entries.map((e) => e.name)).toEqual(['conv_thr']);
    const onOwnLine = set('&SYSTEM\n ibrav=1\n&END\n', 'nat', '2');
    expect(onOwnLine).toBe('&SYSTEM\n ibrav=1\n nat = 2\n&END\n');
  });

  it('applies the fixes of the checks to such a namelist', () => {
    const text = "&CONTROL\n/\n&SYSTEM\n ibrav=2, celldm(1)=10, nat=1, ntyp=1, ecutwfc=25, nspin=2, starting_magnetization(1)=0.5 &END\n&ELECTRONS\n/\nATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\nK_POINTS gamma\n";
    const d = validateQe(parse(text), 'pw').find((x) => x.code === 'qe-spin-occupations')!;
    const fixed = text.slice(0, d.fix!.edit.start) + d.fix!.edit.text + text.slice(d.fix!.edit.end);
    expect(parse(fixed).issues).toEqual([]);
    expect(codes(fixed)).toEqual([]);
  });
});

describe('arrays set in one go', () => {
  const sys = (celldm: string) => `&CONTROL\n/\n&SYSTEM\n ibrav=4, ${celldm}, nat=1, ntyp=1, ecutwfc=25\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nX 1 x.UPF\nATOMIC_POSITIONS crystal\nX 0 0 0\nK_POINTS gamma\n`;
  it('reads celldm = a, b, c as celldm(1), celldm(2), celldm(3)', () => {
    expect(codes(sys('celldm = 10.0, 0, 1.6'))).toEqual([]);
    expect(codes(sys('celldm(1) = 10.0, 0, 1.6'))).toEqual([]);
    expect(codes(sys('celldm(1) = 10.0, celldm(3) = 1.6'))).toEqual([]);
    expect(codes(sys('celldm = 10.0'))).toEqual(['qe-celldm-missing']);
    const cell = qeCell(parse(sys('celldm = 10.0, 0, 1.6')))!;
    expect('volume' in cell && cell.volume).toBeCloseTo((Math.sqrt(3) / 2) * (10 * 0.529177210903) ** 3 * 1.6, 6);
  });

  it('reads repeats', () => {
    expect(codes(sys('celldm = 10.0, 0, 1.6, 3*0'))).toEqual([]);
  });
});

describe('cards with unusual options', () => {
  it('recognizes ATOMIC_VELOCITIES {a.u} and SOLVENTS options with / and ^', () => {
    const text = '&CONTROL\n/\nK_POINTS gamma\nATOMIC_VELOCITIES {a.u}\nSi 0 0 0\nSOLVENTS {mol/L}\n1\nH2O 1 water.xml\nSOLVENTS {g/cm^3}\n';
    const doc = parse(text);
    expect(doc.cards.map((c) => [c.name, c.option])).toEqual([['K_POINTS', 'gamma'], ['ATOMIC_VELOCITIES', 'a.u'], ['SOLVENTS', 'mol/l'], ['SOLVENTS', 'g/cm^3']]);
    expect(doc.cards[0].lines).toEqual([]);
  });
});

describe('completion in unclosed namelists', () => {
  it('offers the variables of the namelist the cursor is in', () => {
    const text = '&CONTROL\n calculation = "scf"\n&SYSTEM\n ibrav = 1\n ecutw\n&ELECTRONS\n conv\n';
    const at = text.indexOf('conv') + 4;
    const labels = qeCompletions(parse(text), 'pw', at).map((c) => c.label);
    expect(labels).toContain('conv_thr');
    expect(labels).not.toContain('disk_io');
    expect(labels).not.toContain('ecutwfc');
    const inSystem = qeCompletions(parse(text), 'pw', text.indexOf('ecutw') + 5).map((c) => c.label);
    expect(inSystem).toContain('ecutwfc');
  });
});

describe('functional spellings', () => {
  it('treats UPF 1 and UPF 2 spellings of one functional as one', () => {
    for (const pbe of ['PBE', 'SLA PW PBX PBC', 'SLA  PW   PBE  PBE', 'SLA PW PBX PBC PBE', 'pbe-gga']) expect(functionalKey(pbe), pbe).toBe('PBE');
    for (const sol of ['PBESOL', 'SLA PW PSX PSC', 'SLA PW PSX PSC PSE']) expect(functionalKey(sol), sol).toBe('PBESOL');
    for (const pz of ['SLA PZ NOGX NOGC', 'SLA PZ', 'LDA', 'PZ']) expect(functionalKey(pz), pz).toBe('PZ');
    expect(functionalKey('SLA PW NOGX NOGC')).toBe('PW');
    expect(functionalKey('SLA LYP B88 BLYP')).toBe('BLYP');
    expect(functionalKey('PBE')).not.toBe(functionalKey('SLA PZ NOGX NOGC'));
    expect(functionalKey('PBE')).not.toBe(functionalKey('PBESOL'));
  });
});
