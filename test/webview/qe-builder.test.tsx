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
    const ph = render("title\n&inputph\n prefix='si', ldisp=.true.\n/\n", 'ph.in');
    expect(ph).toContain('ph.x inputs only get the variable table');
    expect(ph).not.toContain('Setup');
  });
});
