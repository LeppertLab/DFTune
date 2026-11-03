// Reads the headers of a POTCAR: which pseudopotentials it holds, in which order, and their ENMAX.
// Only the TITEL, ENMAX and ZVAL lines are used; the POTCAR data itself is licensed and never shown.

import { elementOf } from '../poscar/elements';

export interface PotcarEntry {
  /** As in TITEL, e.g. "Fe_pv" or "O". */
  symbol: string;
  /** Element of the symbol, e.g. "Fe"; undefined if not recognized. */
  element?: string;
  /** Functional family from TITEL, e.g. "PAW_PBE". */
  kind: string;
  /** Recommended cutoff in eV. */
  enmax?: number;
  /** Valence electrons. */
  zval?: number;
}

export function readPotcar(text: string): PotcarEntry[] {
  const out: PotcarEntry[] = [];
  for (const chunk of text.split(/End of Dataset/)) {
    const titel = chunk.match(/^\s*TITEL\s*=\s*(\S+)\s+(\S+)/m);
    if (!titel) continue;
    const enmax = chunk.match(/ENMAX\s*=\s*([-\d.]+)/);
    const zval = chunk.match(/ZVAL\s*=\s*([-\d.]+)/);
    out.push({
      kind: titel[1],
      symbol: titel[2],
      element: elementOf(titel[2]),
      enmax: enmax ? Number(enmax[1]) : undefined,
      zval: zval ? Number(zval[1]) : undefined,
    });
  }
  return out;
}

/** "Fe_pv O" */
export const potcarSymbols = (p: PotcarEntry[]) => p.map((e) => e.symbol).join(' ');
