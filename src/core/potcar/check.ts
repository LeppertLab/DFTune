// Does the POTCAR match the POSCAR? A POTCAR in the wrong order runs without complaint and
// silently swaps the elements, so this is one of the most costly mistakes to miss.

import { elementOf } from '../poscar/elements';
import { potcarSymbols, type PotcarEntry } from './read';

/** Problems with POTCAR vs. the POSCAR species (names, or only the number of species for VASP 4). */
export function potcarMismatch(potcar: PotcarEntry[], species: string[] | undefined, ntypes: number): string | undefined {
  if (potcar.length === 0) return undefined;
  if (potcar.length !== ntypes) {
    return `POTCAR has ${potcar.length} dataset${potcar.length === 1 ? '' : 's'} (${potcarSymbols(potcar)}) but POSCAR has ${ntypes} species${species ? ` (${species.join(' ')})` : ''}.`;
  }
  if (!species) return undefined;
  const wanted = species.map(elementOf);
  const have = potcar.map((p) => p.element);
  if (wanted.every((w, i) => !w || !have[i] || w === have[i])) return undefined;
  const sameSet = [...wanted].sort().join() === [...have].sort().join();
  return `POTCAR elements ${have.map((e, i) => e ?? potcar[i].symbol).join(' ')} do not match POSCAR ${species.join(' ')}${sameSet ? ': same elements, wrong order' : ''}. VASP would silently use the wrong potentials.`;
}
