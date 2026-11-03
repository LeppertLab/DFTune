// Element symbols in order of atomic number, for checking POSCAR species names.

export const ELEMENTS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
  'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
  'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');

const BY_LOWER = new Map(ELEMENTS.map((e) => [e.toLowerCase(), e]));

/**
 * The element a POSCAR or POTCAR species name stands for: "Fe_pv", "Fe/3a4b…", "Fe1" (a sublattice
 * label) or "H1.25" (a fractional-charge hydrogen) → "Fe"/"H"; undefined if none. Two-letter
 * symbols are tried first, as VASP reads at most two characters.
 */
export function elementOf(name: string): string | undefined {
  const letters = name.match(/^[A-Za-z]{1,2}/)?.[0].toLowerCase();
  if (!letters) return undefined;
  return BY_LOWER.get(letters) ?? (letters.length === 2 ? BY_LOWER.get(letters[0]) : undefined);
}
