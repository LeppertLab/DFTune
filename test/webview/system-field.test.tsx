import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemField, systemValue } from '../../src/webview/components/SystemField';

describe('SYSTEM field', () => {
  it('shows the current title, or a hint when there is none', () => {
    expect(renderToStaticMarkup(<SystemField value="MAPbI3 2x2x6" onChange={() => {}} />)).toContain('value="MAPbI3 2x2x6"');
    const empty = renderToStaticMarkup(<SystemField value={undefined} onChange={() => {}} />);
    expect(empty).toContain('placeholder="Title of this calculation"');
    expect(empty).toContain('aria-label="SYSTEM"');
  });

  it('quotes titles that VASP would otherwise cut short', () => {
    expect(systemValue('Fe3O4 relax')).toBe('Fe3O4 relax');
    expect(systemValue('run 2; strained')).toBe('"run 2; strained"');
    expect(systemValue('MAPbI3 #3')).toBe('"MAPbI3 #3"');
  });
});
