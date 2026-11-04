// Lookup of Quantum ESPRESSO input variables (generated from the 7.4 input definitions).

import { QE_DEFS, QE_VERSION, type QeVarRow } from './tags.generated';

export { QE_VERSION };

export type QeProgram = 'pw' | 'ph' | 'projwfc' | 'dos' | 'bands' | 'pp';
export type QeType = 'integer' | 'real' | 'logical' | 'character';

export interface QeVar {
  /** As written in the QE documentation (mixed case, e.g. "Hubbard_U"). */
  name: string;
  /** Upper-case namelist name, e.g. "SYSTEM". */
  namelist: string;
  type?: QeType;
  default: string;
  summary: string;
  options: { value: string; note: string }[];
  /** Index range of an array variable, e.g. "1:6" or "1:ntyp"; empty for scalars. */
  dim: string;
  required: boolean;
  /** `obsolete`: still read (with a warning) but no longer documented; `undocumented`: accepted, but not described in the docs (e.g. cp.x variables). */
  status: '' | 'obsolete' | 'undocumented';
}

const TYPES: Record<string, QeType> = { I: 'integer', R: 'real', L: 'logical', C: 'character' };

function toVar(name: string, namelist: string, row: QeVarRow): QeVar {
  return {
    name,
    namelist,
    type: TYPES[row[0]],
    default: row[1],
    summary: row[2],
    options: row[3].map(([value, note]) => ({ value, note })),
    dim: row[4],
    required: row[5],
    status: row[6] as QeVar['status'],
  };
}

const cache = new Map<QeProgram, Map<string, Map<string, QeVar>>>();

/** namelist (upper case) → variable name (lower case) → variable. */
function table(program: QeProgram) {
  let t = cache.get(program);
  if (!t) {
    t = new Map();
    for (const [namelist, vars] of Object.entries(QE_DEFS[program].namelists)) {
      t.set(namelist, new Map(Object.entries(vars).map(([name, row]) => [name.toLowerCase(), toVar(name, namelist, row)])));
    }
    cache.set(program, t);
  }
  return t;
}

/** The namelists of a program, in the order they must appear in the input. */
export const namelistsOf = (program: QeProgram): string[] => [...table(program).keys()];

export const cardsOf = (program: QeProgram): string[] => Object.keys(QE_DEFS[program].cards);

/** The documented variables of a namelist (obsolete and undocumented ones are accepted by QE but not listed). */
export const varsOf = (program: QeProgram, namelist: string): QeVar[] => [...(table(program).get(namelist.toUpperCase())?.values() ?? [])].filter((v) => !v.status);

/** A variable by namelist and name (case-insensitive). */
export function lookupVar(program: QeProgram, namelist: string, name: string): QeVar | undefined {
  return table(program).get(namelist.toUpperCase())?.get(name.toLowerCase());
}

/** Every namelist that defines `name` (case-insensitive), to say where a misplaced variable belongs. */
export function namelistsDefining(program: QeProgram, name: string): string[] {
  return [...table(program)].filter(([, vars]) => vars.has(name.toLowerCase())).map(([nl]) => nl);
}

/** All variable names of a program (lower case), for did-you-mean. */
export function allVarNames(program: QeProgram): string[] {
  return [...new Set([...table(program).values()].flatMap((vars) => [...vars.keys()]))];
}

/** Which program an input file is for, from its first namelist; undefined if unrecognized. */
export function detectProgram(text: string): QeProgram | undefined {
  const m = text.match(/^\s*&\s*(\w+)/m);
  switch (m?.[1].toUpperCase()) {
    case 'CONTROL':
      return 'pw';
    case 'INPUTPH':
      return 'ph';
    case 'PROJWFC':
      return 'projwfc';
    case 'DOS':
      return 'dos';
    case 'BANDS':
      return 'bands';
    case 'INPUTPP':
    case 'PLOT':
      return 'pp';
  }
  return undefined;
}

export const qeDocsUrl = (program: QeProgram) =>
  `https://www.quantum-espresso.org/Doc/INPUT_${program === 'pw' ? 'PW' : program === 'ph' ? 'PH' : program.toUpperCase()}.html`;
