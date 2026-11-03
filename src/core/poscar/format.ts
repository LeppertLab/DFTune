// Formats a POSCAR/CONTCAR. Only whitespace and the spelling of the Selective dynamics and
// Direct/Cartesian lines change; every number and name is copied as written.
//
//  - lattice vectors and positions are lined up on the decimal point (selective flags as columns,
//    labels after the coordinates in one column)
//  - element names stand right-aligned above their atom counts
//  - CONTCAR extras after the positions (velocities, …) are kept as they are
//
// Idempotent. Returns undefined while the file has errors.

import { alignedRows, canonicalWord, joinLines, plain, rest } from '../lines';
import { parsePoscar, type PLine } from './parse';

const MODE_WORDS: Record<string, string> = {
  d: 'Direct',
  direct: 'Direct',
  c: 'Cartesian',
  cart: 'Cartesian',
  cartesian: 'Cartesian',
  k: 'Cartesian',
};
const SELECTIVE_WORDS: Record<string, string> = {
  s: 'Selective dynamics',
  selective: 'Selective dynamics',
  'selective dynamics': 'Selective dynamics',
};

/** Element names over atom counts, each column right-aligned. */
function speciesAndCounts(species: PLine, counts: PLine): [string, string] {
  const n = Math.min(species.fields, counts.fields);
  const widths = Array.from({ length: n }, (_, k) => Math.max(species.tokens[k].text.length, counts.tokens[k].text.length));
  const row = (l: PLine) => {
    const cells = widths.map((w, k) => l.tokens[k].text.padStart(w));
    const extra = [...l.tokens.slice(n, l.fields).map((t) => t.text), rest(l)].filter(Boolean).join('  ');
    return (cells.join('  ') + (extra ? '  ' + extra : '')).trimEnd();
  };
  return [row(species), row(counts)];
}

export function formatPoscar(text: string): string | undefined {
  const doc = parsePoscar(text);
  if (doc.diagnostics.some((d) => d.severity === 'error') || !doc.structure) return undefined;
  const { lines } = doc;
  const out: string[] = [];
  const lattice = alignedRows(lines.filter((l) => l.role === 'lattice'));
  const positions = alignedRows(doc.structure.atomLines);
  const speciesLine = lines.find((l) => l.role === 'species');
  const countLine = lines.find((l) => l.role === 'counts')!;
  const [speciesRow, countRow] = speciesLine ? speciesAndCounts(speciesLine, countLine) : [undefined, plain(countLine)];
  let li = 0;
  let pi = 0;
  for (const l of lines) {
    switch (l.role) {
      case 'title':
        out.push(l.text.trimEnd());
        break;
      case 'scale':
        out.push(plain(l));
        break;
      case 'lattice':
        out.push(lattice[li++]);
        break;
      case 'species':
        out.push(speciesRow!);
        break;
      case 'counts':
        out.push(countRow);
        break;
      case 'selective':
        out.push(canonicalWord(l.text, SELECTIVE_WORDS));
        break;
      case 'mode':
        out.push(canonicalWord(l.text, MODE_WORDS));
        break;
      case 'position':
        out.push(positions[pi++]);
        break;
      default:
        // CONTCAR extras and blank lines: as they are (a blank line can be meaningful there).
        out.push(l.text.trimEnd());
    }
  }
  return joinLines(out, text);
}
