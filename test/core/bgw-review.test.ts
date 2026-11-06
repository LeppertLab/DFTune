import { describe, expect, it } from 'vitest';
import { setBgwKeywords } from '../../src/core/bgw/edit';
import { formatBgw } from '../../src/core/bgw/format';
import { parseBgw } from '../../src/core/bgw/parse';
import { detectBgwProgram } from '../../src/core/bgw/tags';
import { validateBgw } from '../../src/core/bgw/validate';

describe('review findings', () => {
  it('reports a tab after the keyword and keeps its value in the formatter', () => {
    const doc = parseBgw('epsilon_cutoff\t10.0\n');
    expect(doc.entries[0].value).toBe('10.0');
    const issue = doc.issues.find((i) => i.code === 'bgw-tab')!;
    expect(issue.severity).toBe('error');
    expect(issue.fix?.edit.text).toBe(' ');
    expect(formatBgw('epsilon_cutoff\t10.0\nnumber_bands 5 \n') ?? '').not.toContain('epsilon_cutoff\n');
  });

  it('adds keywords before the first block, so do_rpa precedes qpoints', () => {
    const text = '# hdr\nepsilon_cutoff 10\nbegin qpoints\n 0 0 0 1 1\nend\nnumber_bands 5\n';
    const out = setBgwKeywords(text, [{ keyword: 'do_rpa', value: '' }]);
    expect(out.indexOf('do_rpa')).toBeLessThan(out.indexOf('begin qpoints'));
    expect(validateBgw(parseBgw(out), 'epsilon').map((d) => d.code)).not.toContain('bgw-rpa-order');
  });

  it('drops # comments from block rows', () => {
    expect(setBgwKeywords('', [{ block: 'diag', rows: ['# note', '1', '2'] }])).toBe('\nbegin diag\n  1\n  2\nend\n'.replace(/^\n/, ''));
  });

  it('removes a blank row with its whole CRLF line break', () => {
    const text = 'epsilon_cutoff 10\r\nnumber_bands 5\r\nbegin qpoints\r\n\r\n 0 0 0 1 1\r\nend\r\n';
    const d = validateBgw(parseBgw(text), 'epsilon').find((x) => x.code === 'bgw-block-row')!;
    const { start, end } = d.fix!.edit;
    const fixed = text.slice(0, start) + text.slice(end);
    expect(fixed).toBe('epsilon_cutoff 10\r\nnumber_bands 5\r\nbegin qpoints\r\n 0 0 0 1 1\r\nend\r\n');
  });

  it('does not take a kernel input for sigma because of the shared cutoff', () => {
    expect(detectBgwProgram('run.inp', 'number_val_bands 3\nnumber_cond_bands 3\nscreened_coulomb_cutoff 20\n')).toBe('kernel');
    expect(detectBgwProgram('run.inp', 'band_index_min 1\nband_index_max 8\n')).toBe('sigma');
  });
});
