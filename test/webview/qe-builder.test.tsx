import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'qe', name), 'utf8');

// The webview module talks to VS Code through acquireVsCodeApi() as soon as it is imported.
vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState: () => undefined, setState() {} }));

let QeBuilder: typeof import('../../src/webview/qe/QeApp').QeBuilder;
beforeAll(async () => {
  ({ QeBuilder } = await import('../../src/webview/qe/QeApp'));
});

const render = (text: string, fileName = 'scf.in') => renderToStaticMarkup(<QeBuilder state={{ text, fileName }} />);

describe('QE builder view', () => {
  it('has setup cards for pp.x inputs', () => {
    const html = render(fixture('pp.in'), 'pp.in');
    expect(html).toContain('What to extract (&amp;INPUTPP)');
    expect(html).toContain('How to plot it (&amp;PLOT)');
    expect(html).toContain('aria-label="plot_num"');
    expect(html).toContain('aria-label="output_format"');
  });

  it('has setup cards for dos.x, projwfc.x and bands.x inputs', () => {
    const dos = render(fixture('dos.in'), 'dos.in');
    for (const label of ['Brillouin-zone integration', 'Energy window', 'Files']) expect(dos).toContain(label);
    expect(dos).toContain('aria-label="Emin"');
    expect(render(fixture('projwfc.in'), 'projwfc.in')).toContain('Energy window and broadening');
    expect(render(fixture('bands.pp.in'), 'bands.pp.in')).toContain('aria-label="filband"');
  });

  it('has setup cards for ph.x inputs', () => {
    const html = render(fixture('ph.grid.in'), 'ph.grid.in');
    for (const label of ['q points', 'Electric field', 'Convergence', 'Files']) expect(html).toContain(label);
    expect(html).toContain('Grid of q points');
    expect(html).toContain('&amp;INPUTPH');
    expect(html).toContain('aria-label="nq1"');
  });

  it('renders the setup cards, the header and the variable table for a real input', () => {
    const html = render(fixture('fe.relax.in'), 'fe.relax.in');
    expect(html).toContain('fe.relax.in');
    expect(html).toContain('1 atoms · 1 species');
    expect(html).toContain('volume');
    for (const label of ['Calculation', 'Occupations', 'Magnetism', 'Functional', 'van der Waals', 'SCF convergence', 'Cutoffs']) expect(html).toContain(label);
    // The detected presets: vc-relax, smearing, collinear.
    expect(html).toMatch(/<option value="vc-relax" [^>]*>|<option value="vc-relax"[^>]*selected/);
    expect(html).toContain('All variables');
    expect(html).toContain('&amp;SYSTEM');
    expect(html).toContain('ecutwfc');
  });

  it('shows the problems of an input, with their fix buttons', () => {
    const html = render("&CONTROL\n calculation = 'relax'\n/\n&SYSTEM\n ibrav = 2, celldm(1) = 10, nat = 1, ntyp = 1, ecutwfx = 20\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nSi 28 Si.UPF\nATOMIC_POSITIONS alat\nSi 0 0 0\nK_POINTS gamma\n");
    expect(html).toContain('Did you mean ecutwfc?');
    expect(html).toContain('needs an &amp;IONS namelist');
    expect(html).toContain('Change to ecutwfc');
    expect(html).toContain('Add an empty &amp;IONS namelist');
  });

  it('renders a field for each kind of variable', () => {
    const html = render(fixture('si.scf.in'));
    expect(html).toContain('aria-label="nosym"'); // a logical: a select
    expect(html).toMatch(/<select[^>]*aria-label="diagonalization"/); // options: a select
    expect(html).toMatch(/<input[^>]*aria-label="ecutwfc"/); // a real: a text field
    expect(html).toContain('aria-label="celldm(1)"'); // an array element
  });

  it('handles an empty input, and one that is not pw.x', () => {
    expect(render('')).toContain('No K_POINTS card');
    // A file that is not a QE input at all: no program, so the pw.x variable table and cards.
    expect(render('nothing here\n', 'x.in')).toContain('No K_POINTS card');
  });
});
