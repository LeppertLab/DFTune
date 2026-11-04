// "What do I want to calculate?" for pw.x: presets that set the variables behind a physical
// intent, and are recognized again when the input is read back (the same idea as the INCAR intents).

import type { QeChange } from './edit';
import type { Reader } from './reader';

/** A variable in an intent: namelist, name and optionally the array index. */
export interface VarRef {
  namelist: string;
  name: string;
  index?: string;
}

export interface QeChoice {
  id: string;
  label: string;
  description: string;
  /** Always written when the choice is applied (value as written in the file). */
  set: (VarRef & { value: string })[];
  /** Written only when the variable is not set yet. */
  suggest?: (VarRef & { value: string })[];
  matches(r: Reader): boolean;
  hints?: string[];
}

export interface QeIntent {
  id: string;
  label: string;
  /** Variables this intent controls: removed when the chosen preset does not set them. */
  owns: VarRef[];
  /** Variables worth tuning alongside, shown as fields in the card. */
  related: VarRef[];
  choices: QeChoice[];
}

const v = (namelist: string, name: string, value: string, index?: string) => ({ namelist, name, value, ...(index !== undefined && { index }) });
const own = (namelist: string, name: string, index?: string): VarRef => ({ namelist, name, ...(index !== undefined && { index }) });

const calc = (r: Reader) => r.str('CONTROL', 'calculation') ?? 'scf';
const occ = (r: Reader) => r.str('SYSTEM', 'occupations') ?? 'fixed';
const near = (value: number | undefined, target: number) => value !== undefined && value > 0 && Math.abs(Math.log10(value / target)) < 0.5;

export const QE_INTENTS: QeIntent[] = [
  {
    id: 'calculation',
    label: 'Calculation',
    owns: [own('CONTROL', 'calculation'), own('IONS', 'ion_dynamics'), own('CELL', 'cell_dynamics')],
    related: [own('CONTROL', 'nstep'), own('CONTROL', 'forc_conv_thr'), own('CONTROL', 'etot_conv_thr')],
    choices: [
      { id: 'scf', label: 'Single point (scf)', description: 'One self-consistent calculation: energy, forces and stress for the structure as given.', set: [v('CONTROL', 'calculation', "'scf'")], matches: (r) => calc(r) === 'scf' },
      {
        id: 'relax',
        label: 'Relax atoms',
        description: 'Move the atoms to minimize the forces, with the cell fixed.',
        set: [v('CONTROL', 'calculation', "'relax'"), v('IONS', 'ion_dynamics', "'bfgs'")],
        matches: (r) => calc(r) === 'relax',
        hints: ['Converge ecutwfc and the k-point grid with scf runs first.'],
      },
      {
        id: 'vc-relax',
        label: 'Relax atoms and cell',
        description: 'Relax atoms and the cell shape and volume (variable cell).',
        set: [v('CONTROL', 'calculation', "'vc-relax'"), v('IONS', 'ion_dynamics', "'bfgs'"), v('CELL', 'cell_dynamics', "'bfgs'")],
        matches: (r) => calc(r) === 'vc-relax',
        hints: ['The basis set changes with the cell: use a higher ecutwfc than for a fixed cell, and re-run the final structure with scf.'],
      },
      {
        id: 'md',
        label: 'Molecular dynamics',
        description: 'Ab initio molecular dynamics (Verlet).',
        set: [v('CONTROL', 'calculation', "'md'"), v('IONS', 'ion_dynamics', "'verlet'")],
        matches: (r) => calc(r) === 'md',
        hints: ['Set nstep, dt and ion_temperature; symmetry is usually switched off (nosym = .true.).'],
      },
      {
        id: 'nscf',
        label: 'Non-self-consistent (nscf)',
        description: 'Eigenvalues on a new k-point set, from the density of an earlier scf run.',
        set: [v('CONTROL', 'calculation', "'nscf'")],
        matches: (r) => calc(r) === 'nscf',
        hints: ['Needs the output of an scf run with the same prefix and outdir; usually a denser grid and more bands (nbnd).'],
      },
      {
        id: 'bands',
        label: 'Band structure (bands)',
        description: 'Eigenvalues along a k-point path, from the density of an earlier scf run.',
        set: [v('CONTROL', 'calculation', "'bands'")],
        matches: (r) => calc(r) === 'bands',
        hints: ['Needs an scf run with the same prefix and outdir, and a path in K_POINTS {tpiba_b} or {crystal_b}.'],
      },
    ],
  },
  {
    id: 'occupations',
    label: 'Occupations',
    owns: [own('SYSTEM', 'occupations'), own('SYSTEM', 'smearing'), own('SYSTEM', 'degauss')],
    related: [own('SYSTEM', 'smearing'), own('SYSTEM', 'degauss'), own('SYSTEM', 'nbnd')],
    choices: [
      { id: 'fixed', label: 'Insulator or semiconductor (fixed)', description: 'Fixed occupations: every state is full or empty.', set: [v('SYSTEM', 'occupations', "'fixed'")], matches: (r) => occ(r) === 'fixed' },
      {
        id: 'smearing',
        label: 'Metal (smearing)',
        description: 'Marzari–Vanderbilt cold smearing, 0.02 Ry: a good default for metals, also for relaxations.',
        set: [v('SYSTEM', 'occupations', "'smearing'")],
        suggest: [v('SYSTEM', 'smearing', "'mv'"), v('SYSTEM', 'degauss', '0.02')],
        matches: (r) => occ(r) === 'smearing',
        hints: ['Converge degauss together with the k-point grid.'],
      },
      {
        id: 'tetrahedra',
        label: 'Tetrahedra (optimized)',
        description: 'Tetrahedron method (Kawamura): accurate DOS, no broadening parameter.',
        set: [v('SYSTEM', 'occupations', "'tetrahedra_opt'")],
        matches: (r) => occ(r) === 'tetrahedra_opt' || occ(r) === 'tetrahedra' || occ(r) === 'tetrahedra_lin',
        hints: ['Needs K_POINTS {automatic}; not for forces in relaxations.'],
      },
    ],
  },
  {
    id: 'spin',
    label: 'Magnetism',
    owns: [own('SYSTEM', 'nspin'), own('SYSTEM', 'noncolin'), own('SYSTEM', 'lspinorb')],
    related: [own('SYSTEM', 'starting_magnetization', '1'), own('SYSTEM', 'starting_magnetization', '2'), own('SYSTEM', 'tot_magnetization')],
    choices: [
      { id: 'none', label: 'Non-magnetic', description: 'Spin-unpolarized.', set: [], matches: (r) => (r.num('SYSTEM', 'nspin') ?? 1) === 1 && !r.bool('SYSTEM', 'noncolin') },
      {
        id: 'collinear',
        label: 'Collinear spin-polarized',
        description: 'Spin up and down (LSDA).',
        set: [v('SYSTEM', 'nspin', '2')],
        suggest: [v('SYSTEM', 'starting_magnetization', '0.5', '1')],
        matches: (r) => r.num('SYSTEM', 'nspin') === 2 && !r.bool('SYSTEM', 'noncolin'),
        hints: ['Set starting_magnetization for every magnetic species, and use smearing (or tot_magnetization): QE stops otherwise.'],
      },
      {
        id: 'noncollinear',
        label: 'Noncollinear magnetism',
        description: 'Magnetization in any direction, without spin–orbit coupling.',
        set: [v('SYSTEM', 'noncolin', '.true.')],
        suggest: [v('SYSTEM', 'starting_magnetization', '0.5', '1')],
        matches: (r) => r.bool('SYSTEM', 'noncolin') === true && !r.bool('SYSTEM', 'lspinorb'),
        hints: ['Use angle1 and angle2 for the direction of each species.'],
      },
      {
        id: 'soc',
        label: 'Spin–orbit coupling',
        description: 'Noncollinear with spin–orbit coupling.',
        set: [v('SYSTEM', 'noncolin', '.true.'), v('SYSTEM', 'lspinorb', '.true.')],
        matches: (r) => r.bool('SYSTEM', 'noncolin') === true && r.bool('SYSTEM', 'lspinorb') === true,
        hints: ['Needs fully relativistic pseudopotentials.'],
      },
    ],
  },
  {
    id: 'functional',
    label: 'Functional',
    owns: [own('SYSTEM', 'input_dft')],
    related: [],
    choices: [
      { id: 'pseudo', label: 'From the pseudopotentials', description: 'Use the functional the pseudopotentials were generated with (the usual way).', set: [], matches: (r) => !r.has('SYSTEM', 'input_dft') },
      { id: 'pbe', label: 'PBE', description: 'Generalized gradient approximation (Perdew–Burke–Ernzerhof).', set: [v('SYSTEM', 'input_dft', "'pbe'")], matches: (r) => r.str('SYSTEM', 'input_dft') === 'pbe' },
      { id: 'pbesol', label: 'PBEsol', description: 'PBE revised for solids: better lattice constants.', set: [v('SYSTEM', 'input_dft', "'pbesol'")], matches: (r) => r.str('SYSTEM', 'input_dft') === 'pbesol' },
      { id: 'lda', label: 'LDA (Perdew–Zunger)', description: 'Local density approximation.', set: [v('SYSTEM', 'input_dft', "'pz'")], matches: (r) => r.str('SYSTEM', 'input_dft') === 'pz' },
    ],
  },
  {
    id: 'dispersion',
    label: 'van der Waals',
    owns: [own('SYSTEM', 'vdw_corr')],
    related: [],
    choices: [
      { id: 'none', label: 'None', description: 'No dispersion correction.', set: [], matches: (r) => !r.has('SYSTEM', 'vdw_corr') },
      { id: 'd3', label: 'DFT-D3', description: 'Grimme D3 dispersion correction.', set: [v('SYSTEM', 'vdw_corr', "'dft-d3'")], matches: (r) => ['dft-d3', 'grimme-d3'].includes(r.str('SYSTEM', 'vdw_corr') ?? '') },
      { id: 'd2', label: 'Grimme-D2', description: 'Grimme D2 dispersion correction.', set: [v('SYSTEM', 'vdw_corr', "'grimme-d2'")], matches: (r) => ['grimme-d2', 'dft-d', 'dft-d2'].includes(r.str('SYSTEM', 'vdw_corr') ?? '') },
      { id: 'ts', label: 'Tkatchenko–Scheffler', description: 'TS-vdW dispersion correction.', set: [v('SYSTEM', 'vdw_corr', "'ts'")], matches: (r) => ['ts', 'ts-vdw', 'tkatchenko-scheffler'].includes(r.str('SYSTEM', 'vdw_corr') ?? '') },
      { id: 'xdm', label: 'XDM', description: 'Exchange-hole dipole moment model.', set: [v('SYSTEM', 'vdw_corr', "'xdm'")], matches: (r) => r.str('SYSTEM', 'vdw_corr') === 'xdm' },
    ],
  },
  {
    id: 'convergence',
    label: 'SCF convergence',
    owns: [own('ELECTRONS', 'conv_thr')],
    related: [own('ELECTRONS', 'mixing_beta'), own('ELECTRONS', 'electron_maxstep')],
    choices: [
      { id: 'normal', label: 'Normal (1e-6 Ry)', description: 'The default: fine for most energies.', set: [v('ELECTRONS', 'conv_thr', '1.0d-6')], matches: (r) => !r.has('ELECTRONS', 'conv_thr') || near(r.num('ELECTRONS', 'conv_thr'), 1e-6) },
      { id: 'tight', label: 'Tight (1e-9 Ry)', description: 'For relaxations and accurate forces.', set: [v('ELECTRONS', 'conv_thr', '1.0d-9')], matches: (r) => near(r.num('ELECTRONS', 'conv_thr'), 1e-9) },
      { id: 'phonon', label: 'Very tight (1e-12 Ry)', description: 'For phonons and other derivatives.', set: [v('ELECTRONS', 'conv_thr', '1.0d-12')], matches: (r) => near(r.num('ELECTRONS', 'conv_thr'), 1e-12) },
    ],
  },
  {
    id: 'cutoffs',
    label: 'Cutoffs',
    owns: [],
    related: [own('SYSTEM', 'ecutwfc'), own('SYSTEM', 'ecutrho')],
    choices: [],
  },
];

/** The id of the choice that matches the input, or `custom`. */
export function detectQeIntent(kind: QeIntent, r: Reader): string {
  return kind.choices.find((c) => c.matches(r))?.id ?? 'custom';
}

/** The changes that apply a choice: its values, suggestions for what is unset, and the removal of owned variables it does not set. */
export function qeIntentChanges(kind: QeIntent, choiceId: string, r: Reader): QeChange[] {
  const choice = kind.choices.find((c) => c.id === choiceId);
  if (!choice) return [];
  const changes: QeChange[] = choice.set.map((s) => ({ namelist: s.namelist, name: s.name, index: s.index, value: s.value }));
  for (const s of choice.suggest ?? []) {
    if (!r.has(s.namelist, s.name, s.index)) changes.push({ namelist: s.namelist, name: s.name, index: s.index, value: s.value });
  }
  const written = new Set([...(choice.set ?? []), ...(choice.suggest ?? [])].map((s) => `${s.namelist}/${s.name}`));
  for (const o of kind.owns) {
    if (!written.has(`${o.namelist}/${o.name}`) && r.has(o.namelist, o.name, o.index)) changes.push({ namelist: o.namelist, name: o.name, index: o.index, value: null });
  }
  return changes;
}

/** The variables a choice writes, for the card: `calculation = 'relax', ion_dynamics = 'bfgs'`; `*` marks suggestions. */
export function describeQeChoice(choice: QeChoice): string {
  const fmt = (s: VarRef & { value: string }, mark = '') => `${s.name}${s.index !== undefined ? `(${s.index})` : ''} = ${s.value}${mark}`;
  return [...choice.set.map((s) => fmt(s)), ...(choice.suggest ?? []).map((s) => fmt(s, '*'))].join(', ') || '(none of these variables set)';
}
