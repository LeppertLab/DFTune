// Formats a KPOINTS file. Only whitespace and the spelling of mode keywords change: numbers and
// free text are copied verbatim, so the k points are exactly the ones in the file.
//
//  - trailing whitespace is removed, the file ends with one newline, line endings are kept
//  - mode words VASP reads by their first letter get one spelling (gamma → Gamma, cart → Cartesian)
//  - k points, generating vectors and tetrahedra are lined up on the decimal point, with their
//    trailing labels/comments in one column
//  - line-mode segments are separated by a single blank line
//
// Idempotent. Returns undefined while the file has errors, since lines whose role is unclear
// must not be moved around (same policy as the INCAR formatter).

import { alignedRows, canonicalWord, joinLines, plain } from '../lines';
import { parseKpoints, type KLine } from './parse';

const MODE_WORDS: Record<string, string> = {
  g: 'Gamma',
  gamma: 'Gamma',
  m: 'Monkhorst-Pack',
  mp: 'Monkhorst-Pack',
  monkhorst: 'Monkhorst-Pack',
  'monkhorst-pack': 'Monkhorst-Pack',
  'monkhorst pack': 'Monkhorst-Pack',
  a: 'Auto',
  auto: 'Auto',
  automatic: 'Auto',
  l: 'Line-mode',
  line: 'Line-mode',
  'line-mode': 'Line-mode',
  linemode: 'Line-mode',
};
const COORD_WORDS: Record<string, string> = {
  r: 'Reciprocal',
  rec: 'Reciprocal',
  reciprocal: 'Reciprocal',
  direct: 'Reciprocal',
  c: 'Cartesian',
  k: 'Cartesian',
  cart: 'Cartesian',
  cartesian: 'Cartesian',
};

export function formatKpoints(text: string): string | undefined {
  const doc = parseKpoints(text);
  if (doc.diagnostics.some((d) => d.severity === 'error')) return undefined;
  const out: string[] = [];
  const { lines } = doc;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    switch (l.role) {
      case 'title':
      case 'extra':
        out.push(l.text.trimEnd());
        break;
      case 'mode':
        out.push(canonicalWord(l.text, doc.layout === 'explicit' ? COORD_WORDS : MODE_WORDS));
        break;
      case 'coords':
        out.push(canonicalWord(l.text, COORD_WORDS));
        break;
      case 'tetra-flag':
        out.push(/^t(etrahedra)?$/i.test(l.text.trim()) ? 'Tetrahedra' : l.text.trim());
        break;
      case 'blank':
        // One blank line at most, none at the end of the file.
        if (out.length && out[out.length - 1] !== '' && lines.slice(i + 1).some((x) => x.role !== 'blank')) out.push('');
        break;
      case 'point':
      case 'vector':
      case 'tetra': {
        // A run of the same role, aligned together (blank lines between line-mode segments don't break it).
        let j = i;
        const run: KLine[] = [];
        for (let k = i; k < lines.length; k++) {
          if (lines[k].role === 'blank') continue;
          if (lines[k].role !== l.role) break;
          run.push(lines[k]);
          j = k;
        }
        const rows = alignedRows(run);
        let r = 0;
        for (let k = i; k <= j; k++) {
          if (lines[k].role === 'blank') {
            if (out[out.length - 1] !== '') out.push('');
          } else out.push(rows[r++]);
        }
        i = j;
        break;
      }
      default:
        // count, mesh, shift, length, tetra-head
        out.push(plain(l));
    }
  }
  return joinLines(out, text);
}
