import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newIncar } from '../../src/core';
import { setTags } from '../../src/core/incar/edit';
import { parseIncar } from '../../src/core/incar/parse';
import { INTENTS, calculation, functional, smearing, spin } from '../../src/core/intents/definitions';
import { detectIntent, fieldTags, intentChanges } from '../../src/core/intents/engine';
import { hubbardChanges, readHubbard } from '../../src/core/intents/hubbard';
import { tagReader } from '../../src/core/intents/reader';

const reader = (text: string) => tagReader(parseIncar(text));
const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

describe('intent detection', () => {
  it('reads the fixtures as researchers would describe them', () => {
    const fe = reader(fixture('INCAR'));
    expect(detectIntent(calculation, fe)).toBe('relax-full');
    expect(detectIntent(spin, fe)).toBe('collinear');
    expect(detectIntent(smearing, fe)).toBe('gaussian');
    expect(detectIntent(functional, fe)).toBe('pbe');

    const hse = reader(fixture('INCAR.hse_bands'));
    expect(detectIntent(functional, hse)).toBe('hse06');
    expect(detectIntent(calculation, hse)).toBe('static');

    const ml = reader(fixture('INCAR.mlff_train'));
    expect(detectIntent(calculation, ml)).toBe('mlff-train');
  });

  it('treats NSW without IBRION as MD, like VASP does', () => {
    expect(detectIntent(calculation, reader('NSW = 50\n'))).toBe('md-nvt');
  });

  it('reports custom setups as custom', () => {
    expect(detectIntent(functional, reader('LHFCALC = .TRUE.\nAEXX = 0.4\n'))).toBe('custom');
  });
});

describe('applying intents', () => {
  it('every choice is detected after applying it to an empty INCAR', () => {
    for (const kind of INTENTS) {
      for (const choice of kind.choices) {
        const text = setTags('', intentChanges(kind, choice.id, reader('')));
        expect(detectIntent(kind, reader(text)), `${kind.id}/${choice.id}`).toBe(choice.id);
      }
    }
  });

  it('every choice is detected after switching from every other choice', () => {
    for (const kind of INTENTS) {
      for (const from of kind.choices) {
        const start = setTags('', intentChanges(kind, from.id, reader('')));
        for (const to of kind.choices) {
          const text = setTags(start, intentChanges(kind, to.id, reader(start)));
          expect(detectIntent(kind, reader(text)), `${kind.id}: ${from.id} → ${to.id}`).toBe(to.id);
        }
      }
    }
  });

  it('keeps user-tuned suggested values and drops tags that no longer apply', () => {
    const start = 'IBRION = 2\nISIF = 2\nNSW = 300\nEDIFFG = -0.02\n';
    const toFull = setTags(start, intentChanges(calculation, 'relax-full', reader(start)));
    expect(toFull).toBe('IBRION = 2\nISIF = 3\nNSW = 300\nEDIFFG = -0.02\n');
    const toStatic = setTags(toFull, intentChanges(calculation, 'static', reader(toFull)));
    expect(toStatic).toBe('IBRION = -1\n');
  });

  it('keeps MAGMOM when switching between magnetic modes but drops it when non-magnetic', () => {
    const start = 'ISPIN = 2\nMAGMOM = 2*5 -5\n';
    expect(setTags(start, intentChanges(spin, 'soc', reader(start)))).toBe('MAGMOM = 2*5 -5\nLSORBIT = .TRUE.\n');
    expect(setTags(start, intentChanges(spin, 'none', reader(start)))).toBe('');
  });

  it('generates a commented INCAR for a new calculation', () => {
    const text = newIncar('Si', { calculation: 'relax-ions', functional: 'pbe', smearing: 'gaussian', accuracy: 'production' });
    expect(text).toContain('# Calculation: Relax ions\n');
    const r = reader(text);
    expect(detectIntent(calculation, r)).toBe('relax-ions');
    expect(detectIntent(smearing, r)).toBe('gaussian');
    expect(r.raw('EDIFF')).toBe('1E-6');
    expect(parseIncar(text).issues).toEqual([]);
  });
});

describe('fieldTags', () => {
  it('shows only the fields relevant to the current choice', () => {
    expect(fieldTags(calculation, 'relax-full', reader(''))).toEqual(['NSW', 'EDIFFG', 'PSTRESS', 'POTIM']);
    expect(fieldTags(calculation, 'static', reader(''))).toEqual([]);
    expect(fieldTags(calculation, 'custom', reader('IBRION = 7\nNSW = 1\n'))).toEqual(['IBRION', 'NSW']);
  });
});

describe('DFT+U', () => {
  it('reads and writes per-species parameters', () => {
    const r = reader(fixture('INCAR'));
    const setup = readHubbard(r, ['Fe', 'O']);
    expect(setup).toEqual({
      enabled: true,
      type: 2,
      rows: [
        { species: 'Fe', l: 2, u: 3.8, j: 0 },
        { species: 'O', l: -1, u: 0, j: 0 },
      ],
    });
    expect(hubbardChanges(setup, r)).toEqual({ LDAU: '.TRUE.', LDAUTYPE: '2', LDAUL: '2 -1', LDAUU: '3.8 0', LDAUJ: '2*0' });
  });

  it('raises LMAXMIX for f electrons', () => {
    const changes = hubbardChanges({ enabled: true, type: 2, rows: [{ species: 'Ce', l: 3, u: 5, j: 0 }] }, reader(''));
    expect(changes.LMAXMIX).toBe('6');
  });

  it('removes all +U tags when disabled', () => {
    const text = fixture('INCAR');
    const out = setTags(text, hubbardChanges({ enabled: false, type: 2, rows: [] }, reader(text)));
    expect(out).not.toMatch(/LDAU/);
    expect(out).toContain('LMAXMIX  = 4');
  });
});
