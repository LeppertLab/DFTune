import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setVariables } from '../../src/core/qe/edit';
import { QE_INTENTS, QE_INTENTS_PH, QE_INTENTS_POST, describeQeChoice, detectQeIntent, intentsFor, qeIntentChanges } from '../../src/core/qe/intents';
import { parseQe } from '../../src/core/qe/parse';
import { Reader } from '../../src/core/qe/reader';
import { cardsOf } from '../../src/core/qe/tags';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'qe', name), 'utf8');
const reader = (text: string) => new Reader(parseQe(text, { cards: cardsOf('pw') }));
const apply = (text: string, kindId: string, choiceId: string) => {
  const kind = QE_INTENTS.find((k) => k.id === kindId)!;
  return setVariables(text, 'pw', qeIntentChanges(kind, choiceId, reader(text)));
};
const detect = (text: string, kindId: string) => detectQeIntent(QE_INTENTS.find((k) => k.id === kindId)!, reader(text));

describe('QE intents', () => {
  const bases = ['si.scf.in', 'fe.relax.in', 'bands.in'];

  it('detects every choice again after applying it, from any starting input', () => {
    for (const base of bases) {
      for (const kind of QE_INTENTS) {
        for (const choice of kind.choices) {
          const text = apply(fixture(base), kind.id, choice.id);
          expect(detect(text, kind.id), `${base}: ${kind.id}/${choice.id}`).toBe(choice.id);
          expect(parseQe(text, { cards: cardsOf('pw') }).issues, `${base}: ${kind.id}/${choice.id}`).toEqual([]);
        }
      }
    }
  });

  it('has choices that do not undo each other: applying several intents keeps them all', () => {
    let text = fixture('si.scf.in');
    text = apply(text, 'calculation', 'vc-relax');
    text = apply(text, 'occupations', 'smearing');
    text = apply(text, 'spin', 'collinear');
    text = apply(text, 'dispersion', 'd3');
    text = apply(text, 'convergence', 'tight');
    for (const [kind, choice] of [['calculation', 'vc-relax'], ['occupations', 'smearing'], ['spin', 'collinear'], ['dispersion', 'd3'], ['convergence', 'tight']]) {
      expect(detect(text, kind), kind).toBe(choice);
    }
  });

  it('adds the namelists a relaxation needs, and removes the dynamics when going back to scf', () => {
    const relax = apply(fixture('si.scf.in'), 'calculation', 'relax');
    expect(relax).toContain("&IONS\n  ion_dynamics = 'bfgs'\n/");
    expect(relax).not.toContain('&CELL');
    const vc = apply(relax, 'calculation', 'vc-relax');
    expect(vc).toContain("&CELL\n  cell_dynamics = 'bfgs'\n/");
    const back = apply(vc, 'calculation', 'scf');
    expect(back).toContain("calculation = 'scf'");
    expect(back).not.toMatch(/ion_dynamics|cell_dynamics/);
  });

  it('removes owned variables that the new choice does not set', () => {
    const smearing = apply(fixture('fe.relax.in'), 'occupations', 'smearing');
    expect(smearing).toContain('degauss = 0.02');
    const fixed = apply(smearing, 'occupations', 'fixed');
    expect(fixed).toContain("occupations = 'fixed'");
    expect(fixed).not.toMatch(/degauss|smearing =/);
    const nonmagnetic = apply(fixture('fe.relax.in'), 'spin', 'none');
    expect(nonmagnetic).not.toMatch(/nspin/);
    expect(nonmagnetic).toContain('starting_magnetization(1)'); // not owned: stays
  });

  it('only suggests values that are not set yet', () => {
    const text = fixture('fe.relax.in').replace('degauss = 0.02', 'degauss = 0.05');
    expect(apply(text, 'occupations', 'smearing')).toContain('degauss = 0.05');
    expect(apply(fixture('si.scf.in'), 'spin', 'collinear')).toContain('starting_magnetization(1) = 0.5');
    expect(apply(fixture('fe.relax.in'), 'spin', 'collinear')).toContain('starting_magnetization(1) = 0.5');
    expect(apply(fixture('fe.relax.in').replace('starting_magnetization(1) = 0.5', 'starting_magnetization(1) = 0.8'), 'spin', 'collinear')).toContain('starting_magnetization(1) = 0.8');
  });

  it('shows custom for settings that match no preset', () => {
    expect(detect("&CONTROL\n calculation = 'dos'\n/\n", 'calculation')).toBe('custom');
    expect(detect("&SYSTEM\n input_dft = 'hse'\n/\n", 'functional')).toBe('custom');
    expect(detect('&ELECTRONS\n conv_thr = 1.0d-3\n/\n', 'convergence')).toBe('custom');
  });

  it('describes the variables a choice writes', () => {
    const smearing = QE_INTENTS.find((k) => k.id === 'occupations')!.choices.find((c) => c.id === 'smearing')!;
    expect(describeQeChoice(smearing)).toBe("occupations = 'smearing', smearing = 'mv'*, degauss = 0.02*");
  });
});

describe('ph.x intents', () => {
  const ph = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'qe', name), 'utf8');
  const phReader = (text: string) => new Reader(parseQe(text, { cards: cardsOf('ph') }));
  const applyPh = (text: string, kindId: string, choiceId: string) => {
    const kind = QE_INTENTS_PH.find((k) => k.id === kindId)!;
    return setVariables(text, 'ph', qeIntentChanges(kind, choiceId, phReader(text)));
  };
  const detectPh = (text: string, kindId: string) => detectQeIntent(QE_INTENTS_PH.find((k) => k.id === kindId)!, phReader(text));

  it('detects every choice again after applying it', () => {
    for (const base of ['ph.in', 'ph.grid.in']) {
      for (const kind of QE_INTENTS_PH) {
        for (const choice of kind.choices) {
          const text = applyPh(ph(base), kind.id, choice.id);
          expect(detectPh(text, kind.id), `${base}: ${kind.id}/${choice.id}`).toBe(choice.id);
          expect(parseQe(text, { cards: cardsOf('ph') }).issues, `${base}: ${kind.id}/${choice.id}`).toEqual([]);
        }
      }
    }
  });

  it('switches between one q point and a grid, keeping the title and the q point line', () => {
    const grid = applyPh(ph('ph.in'), 'qpoints', 'grid');
    expect(grid.split('\n')[0]).toBe('phonons of Si at Gamma');
    expect(grid).toMatch(/ldisp = \.true\./);
    expect(grid).toMatch(/nq1 = 4/);
    expect(grid.trimEnd().endsWith('0.0 0.0 0.0')).toBe(true);
    const back = applyPh(grid, 'qpoints', 'gamma');
    expect(back).not.toMatch(/ldisp/);
    expect(back).toContain('nq1 = 4'); // not owned: stays
  });

  it('picks the intents by program', () => {
    expect(intentsFor('pw')).toBe(QE_INTENTS);
    expect(intentsFor('ph')).toBe(QE_INTENTS_PH);
    expect(intentsFor('dos')).toBe(QE_INTENTS_POST.dos);
    expect(intentsFor('pp')).toEqual([]);
  });
});

describe('dos.x, projwfc.x and bands.x intents', () => {
  const dos = (extra = '') => `&DOS\n  prefix = 'si'\n${extra}/\n`;
  const readerDos = (text: string) => new Reader(parseQe(text, { cards: cardsOf('dos') }));
  const kind = QE_INTENTS_POST.dos.find((k) => k.id === 'integration')!;
  const apply = (text: string, id: string) => setVariables(text, 'dos', qeIntentChanges(kind, id, readerDos(text)));

  it('switches the integration and detects it again', () => {
    for (const choice of kind.choices) {
      const text = apply(dos(), choice.id);
      expect(detectQeIntent(kind, readerDos(text)), choice.id).toBe(choice.id);
    }
    const smearing = apply(dos(), 'smearing');
    expect(smearing).toMatch(/bz_sum = 'smearing'/);
    expect(smearing).toMatch(/degauss = 0\.02/);
    const tetra = apply(smearing, 'tetrahedra');
    expect(tetra).toMatch(/bz_sum = 'tetrahedra_opt'/);
    expect(tetra).not.toMatch(/degauss/);
  });

  it('has field cards for the rest', () => {
    for (const program of ['dos', 'projwfc', 'bands'] as const) {
      expect(QE_INTENTS_POST[program].length, program).toBeGreaterThan(0);
      for (const k of QE_INTENTS_POST[program]) for (const f of k.related) expect(f.name, `${program}/${k.id}`).toBeTruthy();
    }
  });
});
