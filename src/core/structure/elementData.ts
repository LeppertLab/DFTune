// Colours and radii for drawing atoms, indexed like ELEMENTS (H = 0).
//
// Colours: the Jmol/CPK scheme, the default of most crystal viewers.
// Radii: covalent radii in Å from B. Cordero et al., Dalton Trans. 2008, 2832 (low-spin values for
// Mn, Fe and Co); elements after Cm, for which none are given, use 1.6 Å.

import { ELEMENTS } from '../poscar/elements';

const JMOL = (
  'FFFFFF D9FFFF CC80FF C2FF00 FFB5B5 909090 3050F8 FF0D0D 90E050 B3E3F5 ' +
  'AB5CF2 8AFF00 BFA6A6 F0C8A0 FF8000 FFFF30 1FF01F 80D1E3 8F40D4 3DFF00 ' +
  'E6E6E6 BFC2C7 A6A6AB 8A99C7 9C7AC7 E06633 F090A0 50D050 C88033 7D80B0 ' +
  'C28F8F 668F8F BD80E3 FFA100 A62929 5CB8D1 702EB0 00FF00 94FFFF 94E0E0 ' +
  '73C2C9 54B5B5 3B9E9E 248F8F 0A7D8C 006985 C0C0C0 FFD98F A67573 668080 ' +
  '9E63B5 D47A00 940094 429EB0 57178F 00C900 70D4FF FFFFC7 D9FFC7 C7FFC7 ' +
  'A3FFC7 8FFFC7 61FFC7 45FFC7 30FFC7 1FFFC7 00FF9C 00E675 00D452 00BF38 ' +
  '00AB24 4DC2FF 4DA6FF 2194D6 267DAB 266696 175487 D0D0E0 FFD123 B8B8D0 ' +
  'A6544D 575961 9E4FB5 AB5C00 754F45 428296 420066 007D00 70ABFA 00BAFF ' +
  '00A1FF 008FFF 0080FF 006BFF 545CF2 785CE3 8A4FE3 A136D4 B31FD4 B31FBA ' +
  'B30DA6 BD0D87 C70066 CC0059 D1004F D90045 E00038 E6002E EB0026'
).split(' ');

const COVALENT = [
  0.31, 0.28, 1.28, 0.96, 0.84, 0.76, 0.71, 0.66, 0.57, 0.58,
  1.66, 1.41, 1.21, 1.11, 1.07, 1.05, 1.02, 1.06, 2.03, 1.76,
  1.7, 1.6, 1.53, 1.39, 1.39, 1.32, 1.26, 1.24, 1.32, 1.22,
  1.22, 1.2, 1.19, 1.2, 1.2, 1.16, 2.2, 1.95, 1.9, 1.75,
  1.64, 1.54, 1.47, 1.46, 1.42, 1.39, 1.45, 1.44, 1.42, 1.39,
  1.39, 1.38, 1.39, 1.4, 2.44, 2.15, 2.07, 2.04, 2.03, 2.01,
  1.99, 1.98, 1.98, 1.96, 1.94, 1.92, 1.92, 1.89, 1.9, 1.87,
  1.87, 1.75, 1.7, 1.62, 1.51, 1.44, 1.41, 1.36, 1.36, 1.32,
  1.45, 1.46, 1.48, 1.4, 1.5, 1.5, 2.6, 2.21, 2.15, 2.06,
  2.0, 1.96, 1.9, 1.87, 1.8, 1.69,
];

const INDEX = new Map(ELEMENTS.map((e, i) => [e, i]));

/** Colour of an unknown species. */
export const UNKNOWN_COLOR = '#ff1493';

/** Jmol colour of an element as `#rrggbb`. */
export function elementColor(element: string): string {
  const i = INDEX.get(element);
  return i !== undefined && JMOL[i] ? `#${JMOL[i]}` : UNKNOWN_COLOR;
}

/** Covalent radius in Å. */
export function covalentRadius(element: string): number {
  const i = INDEX.get(element);
  return i === undefined ? 1.5 : (COVALENT[i] ?? 1.6);
}
