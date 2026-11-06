// Checks for epsilon.inp beyond the syntax: combinations of keywords that Epsilon/inread.f90 refuses
// (call die) or warns about. Every rule is a condition from that file.

import type { Span } from '../incar/parse';
import { isInteger, isNumber, toNumber } from '../lines';
import type { Diagnostic } from '../validation/rules';
import type { BgwDoc } from './parse';
import { BgwReader } from './reader';

type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => void;

export function checkEpsilon(doc: BgwDoc, report: Report) {
  const r = new BgwReader(doc);
  const at = (name: string): Span => r.entry(name)!.keySpan;
  const valueAt = (name: string): Span => {
    const e = r.entry(name)!;
    return e.args.length ? e.valueSpan : e.keySpan;
  };

  // The frequency dependence: static (0), full frequency (2) or Godby–Needs (3); anything else stops it.
  const freq = r.num('frequency_dependence');
  if (freq !== undefined && ![0, 2, 3].includes(freq)) {
    report('error', 'bgw-eps-frequency', `frequency_dependence = ${freq} is not 0 (static), 2 (full frequency) or 3 (Godby–Needs): Epsilon stops with "Need to specify frequency dependence".`, valueAt('frequency_dependence'));
  }
  const method = r.num('frequency_dependence_method');
  if (method !== undefined && ![0, 1, 2].includes(method)) {
    report('error', 'bgw-eps-frequency', `frequency_dependence_method = ${method} is not 0 (Adler–Wiser), 1 (spectral) or 2 (contour deformation).`, valueAt('frequency_dependence_method'));
  }
  const delta = r.num('delta_frequency');
  if (freq === 2 && delta !== undefined && Math.abs(delta) <= 1e-9) {
    report('error', 'bgw-eps-delta', 'delta_frequency is 0 in a full-frequency calculation: Epsilon stops with "Illegal value for Delta Frequency".', valueAt('delta_frequency'));
  }

  // Partial occupations need an absolute Fermi level; the default is relative, the later switch wins.
  if (r.has('occ_broadening') && !r.after('fermi_level_absolute', 'fermi_level_relative')) {
    report('error', 'bgw-eps-fermi', 'occ_broadening needs fermi_level_absolute (the Fermi level is relative to the band edges by default): Epsilon stops with "fermi_level_absolute must be specified if using occ_broadening".', at('occ_broadening'));
  }

  const conv = r.num('full_chi_conv_log');
  if (conv !== undefined && (conv < -1 || conv > 2)) report('error', 'bgw-eps-range', 'full_chi_conv_log must be -1, 0, 1 or 2.', valueAt('full_chi_conv_log'));
  if (r.has('skip_epsilon') && r.has('skip_chi')) report('error', 'bgw-eps-skip', 'skip_epsilon and skip_chi cannot be used together: Epsilon stops with "Cannot skip_epsilon and skip_chi".', at('skip_chi'));
  if (r.has('number_qpoints')) report('warning', 'bgw-deprecated', 'number_qpoints is deprecated: Epsilon works out the number of q-points from the block.', at('number_qpoints'));

  // q-points: at most one q→0 point (is_q0 = 1 or 2), all with the same value, unless `subsample`.
  const block = r.block('qpoints');
  if (block) {
    const columns = block.rows.filter((l) => l.tokens.length >= 5 && l.tokens.slice(0, 4).every((t) => isNumber(t.text)) && isInteger(l.tokens[4].text));
    const q0 = columns.filter((l) => Number(l.tokens[4].text) > 0);
    if (!r.has('subsample') && q0.length > 1) {
      report('error', 'bgw-eps-q0', 'Only one q→0 point is allowed (is_q0 = 1 or 2 in the last column): Epsilon stops with "Can only have one q->0 point".', { start: q0[1].start, end: q0[1].end });
    }
    const values = new Set(q0.map((l) => Number(l.tokens[4].text)));
    if (values.size > 1) report('error', 'bgw-eps-q0', 'All q→0 points must have the same value in the last column (1 or 2).', { start: q0[1].start, end: q0[1].end });
    if (r.has('do_rpa') && block.rows.length) {
      const weight = columns.length ? block.rows.find((l) => l.tokens.length >= 6) : undefined;
      if (weight && isNumber(weight.tokens[5].text) && toNumber(weight.tokens[5].text) < 0) {
        report('error', 'bgw-eps-rpa', 'The weight of the first q-point is negative: Epsilon stops with "RPA Energy: Illegal value for RPA q-point weight".', weight.tokens[5]);
      }
    }
  }
}
