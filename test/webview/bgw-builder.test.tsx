import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'bgw', name), 'utf8');

vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState: () => undefined, setState() {} }));

let BgwBuilder: typeof import('../../src/webview/bgw/BgwApp').BgwBuilder;
beforeAll(async () => {
  ({ BgwBuilder } = await import('../../src/webview/bgw/BgwApp'));
});

const render = (text: string, fileName: string) => renderToStaticMarkup(<BgwBuilder state={{ text, fileName }} />);

describe('BerkeleyGW builder view', () => {
  it('lists the keywords of the program with their controls', () => {
    const html = render('epsilon_cutoff 10.0\nnumber_bands 20\nskip_chi\n\nbegin qpoints\n  0 0 0.001 1 1\nend\n', 'epsilon.inp');
    expect(html).toContain('BerkeleyGW epsilon.x');
    expect(html).toContain('aria-label="epsilon_cutoff"');
    expect(html).toContain('aria-label="skip_chi"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('begin qpoints');
    expect(html).toContain('<textarea');
  });

  it('shows the diagnostics of the checks', () => {
    expect(render('number_bands 20\nfrequency_dependence 1\n', 'epsilon.inp')).toContain('frequency_dependence = 1');
  });

  it('says when the program is not recognized', () => {
    expect(render('foo 1\n', 'notes.inp')).toContain('not recognized');
  });

  it('renders a real input without problems', () => {
    const name = 'si-epm/epsilon.inp';
    expect(render(fixture(name), 'epsilon.inp')).toContain('No problems found');
  });
});
