// All POSCAR diagnostics: the file's own, plus the comparison with the POTCAR next to it.

import { lineSpan } from '../lines';
import { potcarMismatch } from '../potcar/check';
import type { PotcarEntry } from '../potcar/read';
import type { Diagnostic } from '../validation/rules';
import { parsePoscar } from './parse';

export function lintPoscar(text: string, potcar?: PotcarEntry[]): Diagnostic[] {
  const doc = parsePoscar(text);
  const out = [...doc.diagnostics];
  const counts = doc.lines.find((l) => l.role === 'counts');
  if (potcar && counts && counts.fields > 0 && !out.some((d) => d.severity === 'error' && d.code === 'poscar-species')) {
    const speciesLine = doc.lines.find((l) => l.role === 'species');
    const species = speciesLine?.tokens.slice(0, speciesLine.fields).map((t) => t.text);
    const problem = potcarMismatch(potcar, species, counts.fields);
    if (problem) out.push({ code: 'potcar-mismatch', severity: 'error', message: problem, span: lineSpan(speciesLine ?? counts) });
  }
  return out;
}
