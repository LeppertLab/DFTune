import { describe, expect, it } from 'vitest';
import { setBgwKeywords } from '../../src/core/bgw/edit';
import { parseBgw } from '../../src/core/bgw/parse';
import { validateBgw } from '../../src/core/bgw/validate';

const TEXT = '# epsilon\nepsilon_cutoff 10.0\nnumber_bands 20\n\nbegin qpoints\n  0.0 0.0 0.001 1.0 1\nend\n';

describe('setBgwKeywords', () => {
  it('replaces a keyword line and keeps the rest', () => {
    expect(setBgwKeywords(TEXT, [{ keyword: 'number_bands', value: '40' }])).toBe(TEXT.replace('number_bands 20', 'number_bands 40'));
  });
  it('adds a keyword after the last one, or after the header in an empty file', () => {
    expect(setBgwKeywords(TEXT, [{ keyword: 'cell_average_cutoff', value: '1.0' }])).toBe(TEXT.replace('number_bands 20\n', 'number_bands 20\ncell_average_cutoff 1.0\n'));
    expect(setBgwKeywords('# header\n', [{ keyword: 'number_bands', value: '5' }])).toBe('# header\nnumber_bands 5\n');
    expect(setBgwKeywords('', [{ keyword: 'skip_chi', value: '' }])).toBe('skip_chi\n');
  });
  it('removes a keyword, all its lines', () => {
    expect(setBgwKeywords('a 1\nb 2\na 3\n', [{ keyword: 'a', value: null }])).toBe('b 2\n');
  });
  it('writes, replaces and removes blocks', () => {
    const added = setBgwKeywords('number_bands 20\n', [{ block: 'qpoints', rows: ['0 0 0 1 1', '', '0.5 0 0 1 0'] }]);
    expect(added).toBe('number_bands 20\n\nbegin qpoints\n  0 0 0 1 1\n  0.5 0 0 1 0\nend\n');
    expect(setBgwKeywords(TEXT, [{ block: 'qpoints', rows: ['0 0 0 1 1'] }])).toBe(TEXT.replace('0.0 0.0 0.001 1.0 1', '0 0 0 1 1'));
    expect(setBgwKeywords(TEXT, [{ block: 'qpoints', rows: null }])).toBe('# epsilon\nepsilon_cutoff 10.0\nnumber_bands 20\n\n');
  });
  it('keeps CRLF', () => {
    expect(setBgwKeywords('a 1\r\nb 2\r\n', [{ keyword: 'c', value: '3' }])).toBe('a 1\r\nb 2\r\nc 3\r\n'.replace('b 2\r\nc', 'b 2\r\nc'));
  });
  it('produces input the validator accepts', () => {
    const out = setBgwKeywords('', [{ keyword: 'epsilon_cutoff', value: '10.0' }, { keyword: 'number_bands', value: '30' }, { block: 'qpoints', rows: ['0 0 0.001 1 1'] }]);
    expect(validateBgw(parseBgw(out), 'epsilon').map((d) => d.code)).toEqual([]);
  });
});
