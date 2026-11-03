// Hover text for POSCAR lines: what the number under the cursor means in the structure.

import { angle, norm, speciesLabeler, type PoscarDoc } from './parse';

const f = (x: number, digits = 4) => Number(x.toFixed(digits)).toString();

/** Markdown for the token at `offset`, with the span it applies to; undefined where there is nothing to say. */
export function poscarHover(doc: PoscarDoc, offset: number): { markdown: string; start: number; end: number } | undefined {
  const line = doc.lines.find((l) => offset >= l.start && offset <= l.end);
  const s = doc.structure;
  if (!line || !s) return undefined;
  const token = line.tokens.find((t) => offset >= t.start && offset <= t.end);
  const whole = { start: line.start, end: line.end };
  const [a, b, c] = s.lattice;
  const label = speciesLabeler(s);

  switch (line.role) {
    case 'scale':
      return {
        ...whole,
        markdown: `**Scaling factor**\n\nCell volume ${f(s.volume, 3)} Å³ · ${f(s.volume / s.nions, 3)} Å³ per atom`,
      };
    case 'lattice': {
      const k = doc.lines.filter((l) => l.role === 'lattice').indexOf(line);
      const v = s.lattice[k];
      return {
        ...whole,
        markdown:
          `**Lattice vector ${'abc'[k]}** (scaled): ${v.map((x) => f(x)).join(', ')} Å\n\n` +
          `|${'abc'[k]}| = ${f(norm(v))} Å\n\n` +
          `a = ${f(norm(a))} · b = ${f(norm(b))} · c = ${f(norm(c))} Å  \n` +
          `α = ${f(angle(b, c), 3)}° · β = ${f(angle(a, c), 3)}° · γ = ${f(angle(a, b), 3)}°`,
      };
    }
    case 'species':
    case 'counts': {
      if (!token) return undefined;
      const k = line.tokens.indexOf(token);
      if (k >= s.counts.length) return undefined;
      const first = s.counts.slice(0, k).reduce((x, y) => x + y, 0) + 1;
      const last = first + s.counts[k] - 1;
      const name = s.species?.[k] ?? `Species ${k + 1}`;
      const range = s.counts[k] === 0 ? 'no atoms' : s.counts[k] === 1 ? `atom ${first}` : `atoms ${first}–${last}`;
      return { start: token.start, end: token.end, markdown: `**${name}**: ${s.counts[k]} of ${s.nions} atoms (${range})` };
    }
    case 'position': {
      const i = s.atomLines.indexOf(line);
      if (i < 0) return undefined;
      const sp = label(i);
      const same = s.atomLines.slice(0, i + 1).filter((_, j) => label(j) === sp).length;
      const frac = s.frac[i];
      const cart = [0, 1, 2].map((k) => frac[0] * a[k] + frac[1] * b[k] + frac[2] * c[k]);
      const parts = [`**Atom ${i + 1}**: ${sp} #${same}`];
      parts.push(s.cartesian ? `Direct: ${frac.map((x) => f(x)).join(', ')}` : `Cartesian: ${cart.map((x) => f(x)).join(', ')} Å`);
      if (s.selective) {
        const flags = line.tokens.slice(3, 6).map((t) => /^\.?T/i.test(t.text));
        // The flags refer to the lattice directions, also for Cartesian positions.
        const free = 'abc'.split('').filter((_, k) => flags[k]);
        parts.push(free.length === 3 ? 'Free to move' : free.length === 0 ? 'Fixed' : `Moves along ${free.join(', ')} only (lattice directions)`);
      }
      return { ...whole, markdown: parts.join('\n\n') };
    }
  }
  return undefined;
}
