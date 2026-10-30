// DFT+U is set per species, so it is a table rather than a list of choices.

import type { TagChanges } from '../incar/edit';
import { compressArray, formatReal } from '../incar/values';
import type { TagReader } from './reader';

export interface HubbardRow {
  species: string;
  /** -1 none, 1 p, 2 d, 3 f */
  l: number;
  u: number;
  j: number;
}

export interface HubbardSetup {
  enabled: boolean;
  type: number;
  rows: HubbardRow[];
}

export function readHubbard(r: TagReader, species: string[]): HubbardSetup {
  const ls = r.array('LDAUL') ?? [];
  const us = r.array('LDAUU') ?? [];
  const js = r.array('LDAUJ') ?? [];
  return {
    enabled: r.bool('LDAU') === true,
    type: r.num('LDAUTYPE') ?? 2,
    rows: species.map((s, i) => ({
      species: s,
      l: ls[i] !== undefined ? Number(ls[i]) : -1,
      u: us[i] !== undefined ? Number(us[i]) : 0,
      j: js[i] !== undefined ? Number(js[i]) : 0,
    })),
  };
}

export function hubbardChanges(setup: HubbardSetup, r: TagReader): TagChanges {
  if (!setup.enabled) {
    return { LDAU: null, LDAUTYPE: null, LDAUL: null, LDAUU: null, LDAUJ: null };
  }
  const changes: TagChanges = {
    LDAU: '.TRUE.',
    LDAUTYPE: String(setup.type),
    LDAUL: compressArray(setup.rows.map((row) => String(row.l))),
    LDAUU: compressArray(setup.rows.map((row) => formatReal(row.u))),
    LDAUJ: compressArray(setup.rows.map((row) => formatReal(row.j))),
  };
  const maxL = Math.max(-1, ...setup.rows.filter((row) => row.u !== 0 || row.j !== 0).map((row) => row.l));
  const needed = maxL >= 3 ? 6 : maxL === 2 ? 4 : 0;
  if (needed && (r.num('LMAXMIX') ?? 2) < needed) changes.LMAXMIX = String(needed);
  return changes;
}
