// Checks on the blocks of a cell file. The row layouts are those of the cell file page of the CASTEP
// documentation (documentation/Input_Files/cell_file.md); a row that does not have the layout cannot
// be read by CASTEP, so those are errors. What the page says only in passing ("should", "must
// correspond") is a warning.

import type { Span } from '../incar/parse';
import { isInteger, isNumber } from '../lines';
import type { Diagnostic } from '../validation/rules';
import { elementOf } from '../poscar/elements';
import type { CastepBlock, CastepRow } from './parse';
import { canonicalCastepName } from './tags';

export type Report = (severity: Diagnostic['severity'], code: string, message: string, span: Span) => void;

/** A number, also as the arithmetic expression CASTEP accepts: `-1/3`, `0.5*sqrt(2.0)`, `cos(30)` (cell_file.md). */
export function isCastepNumber(text: string): boolean {
  if (isNumber(text)) return true;
  const bare = text.replace(/\b(cos|sin|tan|sqrt)\b/gi, '');
  if (!/^[\d.eEdD+\-*/()]+$/.test(bare) || !/\d/.test(bare) || /[+\-*/]$/.test(bare)) return false;
  // A label such as D1, E2 or ee2 is not a number: the first character must start one, and an exponent
  // letter needs a digit or dot before it and a digit or sign after it.
  if (!/^[+\-]?[\d.(]/.test(bare)) return false;
  return !/(?<![\d.])[eEdD]|[eEdD](?![\d+\-])/.test(bare);
}

const span = (r: CastepRow): Span => ({ start: r.start, end: r.end });
const rowSpan = (r: CastepRow) => ({ start: r.tokens[0].start, end: r.tokens[r.tokens.length - 1].end });

interface Spec {
  /** The first row may be a unit. */
  units?: boolean;
  check: (rows: CastepRow[], b: CastepBlock, report: Report, ctx: BlockContext) => void;
}

export interface BlockContext {
  /** Species labels of the positions block (upper-cased), and whether SPECIES_MASS / SPECIES_POT name them. */
  species: Set<string>;
  hasBlock: (name: string) => boolean;
}

/** Every row must be `n` numbers (`more`: further text is allowed behind them). */
function numbers(rows: CastepRow[], n: number, what: string, b: CastepBlock, report: Report, more = false) {
  for (const r of rows) {
    const bad = r.tokens.slice(0, n).findIndex((t) => !isCastepNumber(t.text));
    if (r.tokens.length < n || bad >= 0 || (!more && r.tokens.length > n)) {
      report('error', 'castep-block-row', `A ${b.name.toUpperCase()} row needs ${n} numbers (${what}), found "${r.text.trim()}".`, rowSpan(r));
    }
  }
}

function count(rows: CastepRow[], n: number, what: string, b: CastepBlock, report: Report) {
  if (rows.length !== n) {
    report('error', 'castep-block-rows', `${b.name.toUpperCase()} needs ${n} rows (${what}), found ${rows.length}.`, b.nameSpan);
  }
}

const SPECS: Record<string, Spec> = {
  // cell_file.md "Cell Lattice Vectors": [units], three rows a_x a_y a_z.
  lattice_cart: {
    units: true,
    check(rows, b, report) {
      count(rows, 3, 'the vectors a, b and c', b, report);
      numbers(rows, 3, 'x y z of a lattice vector', b, report);
    },
  },
  // cell_file.md: [units], then a b c and alpha beta gamma; the angles in degrees.
  lattice_abc: {
    units: true,
    check(rows, b, report) {
      count(rows, 2, 'a b c, then alpha beta gamma', b, report);
      numbers(rows, 3, 'a b c, then alpha beta gamma', b, report);
      rows.slice(0, 2).forEach((r, i) => {
        for (const t of r.tokens.slice(0, 3)) {
          if (!isNumber(t.text)) continue;
          const v = Number(t.text.replace(/[dD]/, 'e'));
          if (i === 0 && v <= 0) report('warning', 'castep-lattice', 'A lattice vector length must be positive.', t);
          if (i === 1 && (v <= 0 || v >= 180)) report('warning', 'castep-lattice', 'A cell angle is in degrees, between 0 and 180.', t);
        }
      });
    },
  },
  positions_frac: { check: (rows, b, report, ctx) => positions(rows, b, report, ctx) },
  positions_abs: { units: true, check: (rows, b, report, ctx) => positions(rows, b, report, ctx) },
  // cell_file.md "Brillouin Zone Sampling": three fractional coordinates and the weight.
  kpoint_list: {
    check(rows, b, report) {
      numbers(rows, 4, 'three fractional coordinates and the weight', b, report);
      const w = rows.map((r) => (r.tokens.length >= 4 && isNumber(r.tokens[3].text) ? Number(r.tokens[3].text) : NaN));
      if (rows.length && w.every((x) => !Number.isNaN(x))) {
        const sum = w.reduce((a, x) => a + x, 0);
        if (Math.abs(sum - 1) > 1e-3) report('warning', 'castep-kpoint-weights', `The weights of the k-points add up to ${Number(sum.toFixed(6))}: the documentation says they must add up to 1.`, b.nameSpan);
      }
    },
  },
  // The weight is optional in the spectral list.
  spectral_kpoint_list: {
    check(rows, b, report) {
      for (const r of rows) {
        const ok = (r.tokens.length === 3 || r.tokens.length === 4) && r.tokens.every((t) => isCastepNumber(t.text));
        if (!ok) report('error', 'castep-block-row', `A ${b.name.toUpperCase()} row needs 3 fractional coordinates and an optional weight, found "${r.text.trim()}".`, rowSpan(r));
      }
    },
  },
  // Paths: three fractional coordinates per vertex, or a special-point label, or BREAK.
  spectral_kpoint_path: { check: (rows, b, report) => path(rows, b, report) },
  phonon_kpoint_path: { check: (rows, b, report) => path(rows, b, report) },
  phonon_fine_kpoint_path: { check: (rows, b, report) => path(rows, b, report) },
  phonon_kpoint_list: { check: (rows, b, report) => listOf(rows, b, report) },
  phonon_fine_kpoint_list: { check: (rows, b, report) => listOf(rows, b, report) },
  phonon_gamma_directions: { check: (rows, b, report) => numbers(rows, 3, 'a direction in reciprocal lattice vectors', b, report) },
  // cell_file.md "Cell Symmetry": operations of 3 rows of the rotation and one row of the translation.
  symmetry_ops: {
    check(rows, b, report) {
      if (rows.length % 4 !== 0) report('error', 'castep-block-rows', `SYMMETRY_OPS holds operations of four rows each (three of the rotation, one translation), found ${rows.length} rows.`, b.nameSpan);
      numbers(rows, 3, 'three numbers', b, report);
    },
  },
  // cell_file.md "Constraints": two rows of three integers; an integer of the lengths may not return among the angles.
  cell_constraints: {
    check(rows, b, report) {
      count(rows, 2, 'three lengths a b c, three angles alpha beta gamma', b, report);
      for (const r of rows) {
        if (r.tokens.length !== 3 || !r.tokens.every((t) => isInteger(t.text))) report('error', 'castep-block-row', `A CELL_CONSTRAINTS row needs 3 integers, found "${r.text.trim()}".`, r.tokens.length ? rowSpan(r) : span(r));
      }
      if (rows.length === 2 && rows.every((r) => r.tokens.length === 3 && r.tokens.every((t) => isInteger(t.text)))) {
        const lengths = new Set(rows[0].tokens.map((t) => Number(t.text)).filter((v) => v > 0));
        const dup = rows[1].tokens.find((t) => lengths.has(Number(t.text)));
        if (dup) report('error', 'castep-constraint', `${Number(dup.text)} is used for a length and an angle: a length and an angle cannot be constrained to the same value.`, dup);
      }
    },
  },
  // I_n species ion-number and three coefficients.
  ionic_constraints: {
    check(rows, _b, report) {
      for (const r of rows) {
        const t = r.tokens;
        const ok = t.length === 6 && isInteger(t[0].text) && isInteger(t[2].text) && t.slice(3).every((x) => isCastepNumber(x.text));
        if (!ok) report('error', 'castep-block-row', `An IONIC_CONSTRAINTS row needs: constraint number, species, ion number and three coefficients; found "${r.text.trim()}".`, rowSpan(r));
      }
    },
  },
  species_mass: {
    units: true,
    check(rows, _b, report, ctx) {
      for (const r of rows) {
        if (r.tokens.length !== 2 || !isCastepNumber(r.tokens[1].text)) report('error', 'castep-block-row', `A SPECIES_MASS row needs the species and its mass, found "${r.text.trim()}".`, rowSpan(r));
        else speciesKnown(r, report, ctx);
      }
    },
  },
  species_pot: {
    check(rows, _b, report, ctx) {
      for (const r of rows) {
        // A single word (NCP, QC5, …) picks a pseudopotential library for all species (XC.md, GA tutorial); two words are species and file.
        if (r.tokens.length === 1) continue;
        if (r.tokens.length < 2) report('error', 'castep-block-row', `A SPECIES_POT row needs the species and the pseudopotential file, found "${r.text.trim()}".`, rowSpan(r));
        else speciesKnown(r, report, ctx);
      }
    },
  },
  species_lcao_states: {
    check(rows, _b, report, ctx) {
      for (const r of rows) {
        if (r.tokens.length !== 2 || !isInteger(r.tokens[1].text)) report('error', 'castep-block-row', `A SPECIES_LCAO_STATES row needs the species and the number of angular momentum channels, found "${r.text.trim()}".`, rowSpan(r));
        else speciesKnown(r, report, ctx);
      }
    },
  },
  // [units], the upper triangle of the pressure tensor.
  external_pressure: {
    units: true,
    check(rows, b, report) {
      count(rows, 3, 'the rows of the pressure tensor', b, report);
      for (const r of rows) if (!r.tokens.every((t) => isCastepNumber(t.text))) report('error', 'castep-block-row', `An EXTERNAL_PRESSURE row holds numbers, found "${r.text.trim()}".`, rowSpan(r));
    },
  },
  ionic_velocities: {
    units: true,
    check(rows, _b, report) {
      for (const r of rows) {
        const ok = r.tokens.length === 4 && r.tokens.slice(1).every((t) => isCastepNumber(t.text));
        if (!ok) report('error', 'castep-block-row', `An IONIC_VELOCITIES row needs the species and three velocity components, found "${r.text.trim()}".`, rowSpan(r));
      }
    },
  },
  // Keyword-Reference.md: a 3x3 integer matrix.
  phonon_supercell_matrix: {
    check(rows, b, report) {
      count(rows, 3, 'a 3x3 integer matrix', b, report);
      for (const r of rows) if (r.tokens.length !== 3 || !r.tokens.every((t) => isInteger(t.text))) report('error', 'castep-block-row', `A PHONON_SUPERCELL_MATRIX row needs 3 integers, found "${r.text.trim()}".`, r.tokens.length ? rowSpan(r) : span(r));
    },
  },
};

function listOf(rows: CastepRow[], b: CastepBlock, report: Report) {
  for (const r of rows) {
    const ok = (r.tokens.length === 3 || r.tokens.length === 4) && r.tokens.every((t) => isCastepNumber(t.text));
    if (!ok) report('error', 'castep-block-row', `A ${b.name.toUpperCase()} row needs 3 fractional coordinates and an optional weight, found "${r.text.trim()}".`, rowSpan(r));
  }
}

/** A vertex (three numbers) or a special-point label or BREAK (a single word); cell_file.md "SPECTRAL_KPOINT_PATH". */
function path(rows: CastepRow[], b: CastepBlock, report: Report) {
  for (const r of rows) {
    const t = r.tokens;
    const numeric = isCastepNumber(t[0].text);
    if (numeric ? t.length < 3 || !t.slice(0, 3).every((x) => isCastepNumber(x.text)) : t.length > 1) {
      report('error', 'castep-block-row', `A ${b.name.toUpperCase()} row is three fractional coordinates, a special-point label or BREAK; found "${r.text.trim()}".`, rowSpan(r));
    }
  }
}

/** Species label of a positions row: the symbol (up to three characters) or the atomic number. */
function positions(rows: CastepRow[], b: CastepBlock, report: Report, ctx: BlockContext) {
  for (const r of rows) {
    const t = r.tokens;
    if (t.length < 4 || !t.slice(1, 4).every((x) => isCastepNumber(x.text))) {
      report('error', 'castep-block-row', `A ${b.name.toUpperCase()} row needs the species and three coordinates, found "${r.text.trim()}".`, rowSpan(r));
      continue;
    }
    ctx.species.add(t[0].text.toUpperCase());
    // Everything behind the coordinates is a flag; the documented one is SPIN=.
    const spin = t.slice(4).find((x) => /^spin=./i.test(x.text));
    if (spin && !isCastepNumber(spin.text.slice(5))) {
      report('error', 'castep-value', `SPIN needs a number (the spin polarisation of the atom), found "${spin.text.slice(5)}".`, spin);
    }
  }
}

/** SPECIES_MASS, SPECIES_POT and SPECIES_LCAO_STATES entries must correspond to a species of the positions block (cell_file.md). */
function speciesKnown(r: CastepRow, report: Report, ctx: BlockContext) {
  if (ctx.species.size && !ctx.species.has(r.tokens[0].text.toUpperCase())) {
    report('warning', 'castep-species', `${r.tokens[0].text} is not a species of the positions block: the documentation says it must correspond to one.`, r.tokens[0]);
  }
}

const LABEL_ELEMENT = (label: string): boolean => /^\d+$/.test(label) || elementOf(label) !== undefined;

/**
 * The block-level checks: the row layout of every block the documentation describes, and species labels
 * that are no element symbol (cell_file.md: then the mass, and the potential, must be specified).
 */
export function checkCellBlocks(blocks: CastepBlock[], report: Report): { species: Set<string> } {
  const ctx: BlockContext = { species: new Set(), hasBlock: (n) => blocks.some((b) => canonicalCastepName(b.name) === n) };
  // Positions first: the species checks of the other blocks need them.
  const order = [...blocks].sort((a, b) => Number(/^positions_/i.test(b.name)) - Number(/^positions_/i.test(a.name)));
  for (const b of order) {
    const spec = SPECS[canonicalCastepName(b.name)];
    if (!spec || !b.closed) continue;
    let rows = b.rows;
    if (spec.units && rows.length && rows[0].tokens.length === 1 && !isCastepNumber(rows[0].tokens[0].text)) rows = rows.slice(1);
    spec.check(rows, b, report, ctx);
  }
  const labelled = new Map<string, Span>();
  for (const b of blocks) {
    if (!/^positions_(frac|abs)$/.test(canonicalCastepName(b.name))) continue;
    for (const r of b.rows) if (r.tokens.length >= 4 && !LABEL_ELEMENT(r.tokens[0].text)) labelled.set(r.tokens[0].text.toUpperCase(), r.tokens[0]);
  }
  for (const [label, at] of labelled) {
    const named = (block: string) => blocks.some((b) => canonicalCastepName(b.name) === block && b.rows.some((r) => r.tokens[0]?.text.toUpperCase() === label));
    if (!named('species_mass') || !named('species_pot')) {
      report('warning', 'castep-species', `${label} does not start with an element symbol: the documentation says its mass (SPECIES_MASS) and its pseudopotential (SPECIES_POT) must then be specified.`, at);
    }
  }
  return { species: ctx.species };
}
