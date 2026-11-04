import { describe, expect, it } from 'vitest';
import { qeHover } from '../../src/core/qe/hover';
import { automaticGrid, kpointsCard, setKpointsCard } from '../../src/core/qe/kpoints';
import { parseQe } from '../../src/core/qe/parse';
import { qeCell } from '../../src/core/qe/structure';
import { cardsOf } from '../../src/core/qe/tags';

const parse = (text: string) => parseQe(text, { cards: cardsOf('pw') });
const apply = (text: string, e: { start: number; end: number; text: string }) => text.slice(0, e.start) + e.text + text.slice(e.end);

const SI = '&CONTROL\n/\n&SYSTEM\nibrav = 2, celldm(1) = 10.26, nat = 2, ntyp = 1, ecutwfc = 25\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\nSi 0.25 0.25 0.25\n';

describe('K_POINTS generation', () => {
  it('makes a grid from a spacing, like KSPACING does', () => {
    const cell = qeCell(parse(SI + 'K_POINTS gamma\n'))!;
    expect('volume' in cell).toBe(true);
    // fcc a = 5.43 Å: |b| = 2π √3 / a = 2.0045 Å⁻¹.
    expect(automaticGrid(cell as never, 0.3)).toEqual([7, 7, 7]);
    expect(automaticGrid(cell as never, 0.5)).toEqual([5, 5, 5]);
  });

  it('writes the card', () => {
    expect(kpointsCard([4, 4, 2])).toBe('K_POINTS {automatic}\n  4 4 2 0 0 0\n');
    expect(kpointsCard([4, 4, 2], [1, 1, 1])).toBe('K_POINTS {automatic}\n  4 4 2 1 1 1\n');
  });

  it('replaces an existing card of any kind, keeping what follows', () => {
    const card = kpointsCard([6, 6, 6]);
    const list = SI + 'K_POINTS crystal\n2\n0 0 0 1\n0.5 0 0 1\n\n! trailing note\n';
    expect(apply(list, setKpointsCard(parse(list), card))).toBe(SI + 'K_POINTS {automatic}\n  6 6 6 0 0 0\n\n! trailing note\n');
    const auto = SI + 'K_POINTS {automatic}\n 2 2 2 1 1 1\nOCCUPATIONS\n2 2\n';
    expect(apply(auto, setKpointsCard(parse(auto), card))).toBe(SI + 'K_POINTS {automatic}\n  6 6 6 0 0 0\nOCCUPATIONS\n2 2\n');
  });

  it('appends the card when there is none, and keeps CRLF', () => {
    expect(apply(SI, setKpointsCard(parse(SI), kpointsCard([4, 4, 4])))).toBe(SI + 'K_POINTS {automatic}\n  4 4 4 0 0 0\n');
    expect(apply(SI.trimEnd(), setKpointsCard(parse(SI.trimEnd()), kpointsCard([4, 4, 4])))).toBe(SI + 'K_POINTS {automatic}\n  4 4 4 0 0 0\n');
    const crlf = (SI + 'K_POINTS gamma\n').replace(/\n/g, '\r\n');
    expect(apply(crlf, setKpointsCard(parse(crlf), kpointsCard([4, 4, 4])))).toBe((SI + 'K_POINTS {automatic}\n  4 4 4 0 0 0').replace(/\n/g, '\r\n') + '\r\n');
  });
});

describe('hover on the cell and the grid', () => {
  const text = SI + 'K_POINTS automatic\n4 4 4 1 1 1\n';
  const doc = parse(text);
  it('describes the cell when hovering a value of ibrav, celldm or A', () => {
    const h = qeHover(doc, 'pw', text.indexOf('ibrav = 2') + 8)!;
    expect(h.markdown).toMatch(/^\*\*Cell\*\* · a = 3\.839, b = 3\.839, c = 3\.839 Å · α = 60°, β = 60°, γ = 60° · volume 40\.\d+ Å³$/);
    expect(qeHover(doc, 'pw', text.indexOf('celldm(1) = 10.26') + 15)!.markdown).toMatch(/^\*\*Cell\*\*/);
    // The variable name still shows the documentation.
    expect(qeHover(doc, 'pw', text.indexOf('ibrav'))!.markdown).toMatch(/^\*\*ibrav\*\* · &SYSTEM/);
  });

  it('describes the grid', () => {
    const h = qeHover(doc, 'pw', text.indexOf('4 4 4 1 1 1') + 2)!;
    expect(h.markdown).toMatch(/^\*\*Shifted 4 × 4 × 4 grid\*\*: 64 k points before symmetry reduction\.\n\nSpacing 0\.\d+ × 0\.\d+ × 0\.\d+ Å⁻¹/);
  });
});
