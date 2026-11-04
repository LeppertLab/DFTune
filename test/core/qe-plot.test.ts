import { describe, expect, it } from 'vitest';
import { lintPlotInput, plotHover, plotProgramOf } from '../../src/core/qe/plot';

const band = (t: string) => lintPlotInput('plotband', t).map((d) => `${d.code}:${d.severity}`);
const rho = (t: string) => lintPlotInput('plotrho', t).map((d) => `${d.code}:${d.severity}`);

describe('plotProgramOf', () => {
  it('goes by the file name', () => {
    expect(['plotband.in', '/x/run1.plotband', 'PlotBand_si.in'].map(plotProgramOf)).toEqual(['plotband', 'plotband', 'plotband']);
    expect(['plotrho.in', 'a/si.plotrho'].map(plotProgramOf)).toEqual(['plotrho', 'plotrho']);
    expect(plotProgramOf('scf.in')).toBeUndefined();
  });
});

describe('plotband.x input', () => {
  it('accepts the usual input', () => {
    expect(band('-6 10\nbands.xmgr\nbands.ps\n6.5\n2 0\n')).toEqual([]);
    expect(band('-6 10 1 120\nbands.xmgr\nbands.ps\n6.5\n2.0 6.5\n')).toEqual([]);
  });

  it('stops at a blank PostScript file name', () => {
    expect(band('-6 10\nbands.xmgr\n\n')).toEqual([]);
    expect(band('-6 10\n\n\n')).toEqual([]);
    expect(band('-6 10\nbands.xmgr\n\n6.5\n')).toEqual(['plot-ignored:info']);
  });

  it('needs the Fermi energy and tics after a PostScript file', () => {
    expect(band('-6 10\nb.xmgr\nb.ps\n')).toEqual(['plot-incomplete:error']);
    expect(band('-6 10\nb.xmgr\nb.ps\nfermi\n2 0\n')).toEqual(['plot-line:error']);
    expect(band('-6 10\nb.xmgr\nb.ps\n6.5\n')).toEqual(['plot-incomplete:error']);
    expect(band('-6 10\nb.xmgr\nb.ps\n6.5\n2\n')).toEqual(['plot-line:error']);
  });

  it('checks the energy range', () => {
    expect(band('10 -6\nb.xmgr\n\n')).toEqual(['plot-range:warning']);
    expect(band('-6\nb.xmgr\n\n')).toEqual(['plot-line:error']);
    expect(band('-6 10 5\nb.xmgr\n\n')).toEqual(['plot-range:warning']);
    expect(band('-6 10 9 3\nb.xmgr\n\n')).toEqual(['plot-range:error']);
    expect(band('-6 10 1.5 3\nb.xmgr\n\n')).toEqual(['plot-range:error']);
    expect(band('')).toEqual(['plot-line:error', 'plot-incomplete:error']);
  });

  it('needs the output file lines', () => {
    expect(band('-6 10\n')).toEqual(['plot-incomplete:error']);
    expect(band('-6 10\nb.xmgr\n')).toEqual(['plot-incomplete:error']);
  });
});

describe('plotrho.x input', () => {
  it('accepts both forms: with and without the logarithmic-scale question', () => {
    expect(rho('rho.ps\nn\n0.0 0.5 20\n')).toEqual([]);
    expect(rho('rho.ps\ny\n0.001 0.5 20\n')).toEqual([]);
    expect(rho('rho.ps\n-0.1 0.5 20\n')).toEqual([]);
  });

  it('checks the levels', () => {
    expect(rho('rho.ps\nn\n0.5 0.1 20\n')).toEqual(['plot-range:error']);
    expect(rho('rho.ps\nn\n0.1 0.5\n')).toEqual(['plot-line:error']);
    expect(rho('rho.ps\nn\n0.1 0.5 2.5\n')).toEqual(['plot-line:error']);
    expect(rho('rho.ps\nn\n0.1 0.5 5000\n')).toEqual(['plot-levels:warning']);
    expect(rho('rho.ps\nmaybe\n0.1 0.5 20\n')).toEqual(['plot-line:error']);
  });

  it('needs the output file and the levels', () => {
    expect(rho('')).toEqual(['plot-line:error', 'plot-incomplete:error']);
    expect(rho('rho.ps\n')).toEqual(['plot-incomplete:error']);
    expect(rho('rho.ps\nn\n')).toEqual(['plot-incomplete:error']);
  });
});

describe('plotHover', () => {
  it('says what each line answers', () => {
    const t = '-6 10\nb.xmgr\nb.ps\n6.5\n2 0\n';
    expect(plotHover('plotband', t, 2)!.markdown).toBe('**plotband.x** · Energy range: Emin Emax [firstk lastk]');
    expect(plotHover('plotband', t, t.indexOf('6.5'))!.markdown).toMatch(/Fermi energy/);
    expect(plotHover('plotrho', 'rho.ps\nn\n0 1 10\n', 8)!.markdown).toMatch(/Logarithmic scale/);
    expect(plotHover('plotrho', 'rho.ps\n0 1 10\n', 8)!.markdown).toMatch(/Contour levels/);
  });
});
