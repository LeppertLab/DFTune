// The physical-intent layer: each intent kind maps a choice a researcher thinks in
// ("relax ions and cell", "HSE06", "spin-polarized") to the INCAR tags that express it.

import { effective } from './reader';
import type { IntentKind } from './types';

const ML_TAGS = ['ML_LMLFF', 'ML_MODE'];

export const calculation: IntentKind = {
  id: 'calculation',
  label: 'Calculation',
  owns: ['IBRION', 'NSW', 'ISIF', 'EDIFFG', 'POTIM', 'NFREE', 'ICHARG', 'MDALGO', 'TEBEG', 'TEEND', 'SMASS',
    'LANGEVIN_GAMMA', 'LANGEVIN_GAMMA_L', 'PMASS', 'LEPSILON', 'LOPTICS', ...ML_TAGS],
  related: [],
  choices: [
    {
      id: 'mlff-train',
      label: 'MLFF on-the-fly training',
      description: 'MD driven by a machine-learned force field that learns from occasional DFT steps.',
      force: { ML_LMLFF: '.TRUE.', ML_MODE: 'train', IBRION: '0', ISIF: '2' },
      suggest: { NSW: '10000', POTIM: '1.0', MDALGO: '2', SMASS: '0', TEBEG: '300' },
      related: ['TEEND'],
      matches: (r) => r.bool('ML_LMLFF') === true && r.str('ML_MODE') === 'TRAIN',
      hints: ['Put the existing ML_AB next to the INCAR to continue training.'],
    },
    {
      id: 'mlff-run',
      label: 'MLFF production MD',
      description: 'MD with a trained force field (ML_FF) only, without ab initio steps.',
      force: { ML_LMLFF: '.TRUE.', ML_MODE: 'run', IBRION: '0', ISIF: '2' },
      suggest: { NSW: '100000', POTIM: '1.0', MDALGO: '2', SMASS: '0', TEBEG: '300' },
      related: ['TEEND'],
      matches: (r) => r.bool('ML_LMLFF') === true && r.str('ML_MODE') === 'RUN',
      hints: ['Requires a trained ML_FF file in the run directory.'],
    },
    {
      id: 'static',
      label: 'Single point (SCF)',
      description: 'Self-consistent energy, forces and charge density at a fixed geometry.',
      force: { IBRION: '-1' },
      matches: (r) =>
        effective.nsw(r) === 0 && ![11, 12].includes(r.num('ICHARG') ?? -1) && !r.bool('ML_LMLFF') &&
        !effective.isPhonon(r) && !r.bool('LEPSILON') && !r.bool('LOPTICS'),
    },
    {
      id: 'relax-ions',
      label: 'Relax ions',
      description: 'Optimize atomic positions at a fixed cell.',
      force: { IBRION: '2', ISIF: '2' },
      suggest: { NSW: '100', EDIFFG: '-0.01' },
      related: ['POTIM'],
      matches: (r) => effective.isRelaxation(r) && [0, 1, 2].includes(effective.isif(r)),
    },
    {
      id: 'relax-full',
      label: 'Relax ions + cell',
      description: 'Optimize positions, cell shape and volume.',
      force: { IBRION: '2', ISIF: '3' },
      suggest: { NSW: '100', EDIFFG: '-0.01' },
      related: ['PSTRESS', 'POTIM'],
      matches: (r) => effective.isRelaxation(r) && effective.isif(r) === 3,
      hints: [
        'Pulay stress: set ENCUT to ~1.3 × the largest ENMAX in POTCAR.',
        'The basis set is fixed during the run: restart the relaxation until the volume stops changing.',
      ],
    },
    {
      id: 'relax-shape',
      label: 'Relax ions + cell shape',
      description: 'Optimize positions and cell shape at a constant volume.',
      force: { IBRION: '2', ISIF: '4' },
      suggest: { NSW: '100', EDIFFG: '-0.01' },
      related: ['POTIM'],
      matches: (r) => effective.isRelaxation(r) && effective.isif(r) === 4,
    },
    {
      id: 'non-scf',
      label: 'DOS / band structure (non-SCF)',
      description: 'Eigenvalues on a new k-point set from a converged CHGCAR.',
      force: { ICHARG: '11', IBRION: '-1' },
      suggest: { LORBIT: '11', NEDOS: '2001' },
      related: ['EMIN', 'EMAX'],
      matches: (r) => r.num('ICHARG') === 11,
      hints: [
        'Copy CHGCAR from the converged SCF run. Use the same functional and LMAXMIX.',
        'DOS: denser Γ-centred mesh with ISMEAR = -5. Bands: line-mode KPOINTS with ISMEAR = 0.',
      ],
    },
    {
      id: 'phonon-fd',
      label: 'Phonons (finite differences)',
      description: 'Γ-point phonons and the force-constant matrix from displaced structures.',
      force: { IBRION: '6' },
      suggest: { NFREE: '2', POTIM: '0.015' },
      matches: (r) => [5, 6].includes(effective.ibrion(r)) && effective.isif(r) < 3,
      hints: [
        'Use EDIFF = 1E-6 or tighter; forces from a loose SCF give wrong frequencies.',
        'For phonons away from Γ, use a supercell (e.g. with phonopy).',
      ],
    },
    {
      id: 'elastic',
      label: 'Elastic constants (finite differences)',
      description: 'Elastic tensor (and phonons) from displaced ions and strained cells.',
      force: { IBRION: '6', ISIF: '3' },
      suggest: { NFREE: '2', POTIM: '0.015' },
      matches: (r) => [5, 6].includes(effective.ibrion(r)) && effective.isif(r) >= 3,
      hints: [
        'Use EDIFF = 1E-6 or tighter and a converged ENCUT (~1.3 × ENMAX) for reliable stresses.',
        'Start from a structure relaxed with the same settings.',
      ],
    },
    {
      id: 'phonon-dfpt',
      label: 'Phonons (DFPT)',
      description: 'Γ-point phonons from density-functional perturbation theory; with LEPSILON also Born charges.',
      force: { IBRION: '8' },
      related: ['LEPSILON'],
      matches: (r) => [7, 8].includes(effective.ibrion(r)),
      hints: ['Use EDIFF = 1E-6 or tighter.'],
    },
    {
      id: 'dielectric',
      label: 'Dielectric tensor (DFPT)',
      description: 'Static dielectric tensor, Born effective charges and piezoelectric tensor (ion-clamped).',
      force: { LEPSILON: '.TRUE.', IBRION: '-1' },
      related: ['LRPA'],
      matches: (r) => r.bool('LEPSILON') === true && !effective.isPhonon(r) && effective.nsw(r) === 0,
      hints: ['Does not need extra empty bands. Not available for hybrid functionals: use LOPTICS or LCALCEPS there.'],
    },
    {
      id: 'optics',
      label: 'Optical properties (LOPTICS)',
      description: 'Frequency-dependent dielectric function from a sum over empty bands.',
      force: { LOPTICS: '.TRUE.', IBRION: '-1' },
      suggest: { NEDOS: '2001' },
      related: ['NBANDS', 'CSHIFT'],
      matches: (r) => r.bool('LOPTICS') === true && !r.bool('LEPSILON') && effective.nsw(r) === 0,
      hints: ['Raise NBANDS to 2–3× the default and converge the spectrum with it.'],
    },
    {
      id: 'md-nvt',
      label: 'Molecular dynamics (NVT)',
      description: 'Canonical MD with a Nosé–Hoover thermostat.',
      force: { IBRION: '0', MDALGO: '2', ISIF: '2' },
      suggest: { NSW: '10000', POTIM: '1.0', TEBEG: '300', SMASS: '0' },
      related: ['TEEND'],
      matches: (r) => effective.isMD(r) && effective.isif(r) !== 3,
      hints: ['Switch symmetry off (ISYM = 0). LREAL = Auto and lower EDIFF are usual for MD.'],
    },
    {
      id: 'md-npt',
      label: 'Molecular dynamics (NpT)',
      description: 'Isothermal–isobaric MD with Langevin thermostat and barostat.',
      force: { IBRION: '0', MDALGO: '3', ISIF: '3' },
      suggest: { NSW: '10000', POTIM: '1.0', TEBEG: '300', PMASS: '1000', LANGEVIN_GAMMA_L: '10' },
      related: ['TEEND', 'PSTRESS', 'LANGEVIN_GAMMA'],
      matches: (r) => effective.isMD(r) && effective.isif(r) === 3,
      hints: ['Set LANGEVIN_GAMMA (one value per species) and raise ENCUT for stable pressures.'],
    },
  ],
};

export const functional: IntentKind = {
  id: 'functional',
  label: 'Exchange–correlation',
  owns: ['GGA', 'METAGGA', 'LHFCALC', 'HFSCREEN', 'AEXX', 'AGGAX', 'AGGAC', 'ALDAC'],
  related: ['LASPH', 'ALGO'],
  choices: [
    {
      id: 'pbe',
      label: 'PBE',
      description: 'GGA; the general-purpose default.',
      force: { GGA: 'PE' },
      matches: (r) => (!r.has('GGA') || r.str('GGA') === 'PE') && !r.has('METAGGA') && !r.bool('LHFCALC'),
    },
    {
      id: 'pbesol',
      label: 'PBEsol',
      description: 'GGA tuned for lattice constants of solids.',
      force: { GGA: 'PS' },
      matches: (r) => r.str('GGA') === 'PS' && !r.has('METAGGA') && !r.bool('LHFCALC'),
    },
    {
      id: 'rpbe',
      label: 'RPBE',
      description: 'GGA; improved adsorption energies.',
      force: { GGA: 'RP' },
      matches: (r) => r.str('GGA') === 'RP' && !r.has('METAGGA') && !r.bool('LHFCALC'),
    },
    {
      id: 'lda',
      label: 'LDA',
      description: 'Local density approximation (Ceperley–Alder).',
      force: { GGA: 'CA' },
      matches: (r) => ['CA', 'PZ'].includes(r.str('GGA') ?? '') && !r.has('METAGGA') && !r.bool('LHFCALC'),
    },
    {
      id: 'r2scan',
      label: 'r²SCAN',
      description: 'Meta-GGA; better energetics than PBE and numerically stable.',
      force: { METAGGA: 'R2SCAN', LASPH: '.TRUE.' },
      related: ['LMIXTAU'],
      matches: (r) => r.str('METAGGA') === 'R2SCAN',
    },
    {
      id: 'scan',
      label: 'SCAN',
      description: 'Meta-GGA; can be numerically unstable, prefer r²SCAN.',
      force: { METAGGA: 'SCAN', LASPH: '.TRUE.' },
      related: ['LMIXTAU'],
      matches: (r) => r.str('METAGGA') === 'SCAN',
    },
    {
      id: 'hse06',
      label: 'HSE06',
      description: 'Screened hybrid; good band gaps. 10–100× the cost of PBE.',
      force: { GGA: 'PE', LHFCALC: '.TRUE.', HFSCREEN: '0.2' },
      suggest: { ALGO: 'All' },
      related: ['AEXX', 'PRECFOCK', 'NKRED'],
      matches: (r) => r.bool('LHFCALC') === true && Math.abs((r.num('HFSCREEN') ?? 0) - 0.2) < 1e-6 && (r.num('AEXX') ?? 0.25) === 0.25,
      hints: ['Start from a converged PBE WAVECAR. Consider NKRED or PRECFOCK = Fast to reduce cost.'],
    },
    {
      id: 'pbe0',
      label: 'PBE0',
      description: 'Unscreened hybrid with 25 % exact exchange.',
      force: { GGA: 'PE', LHFCALC: '.TRUE.' },
      suggest: { ALGO: 'All' },
      related: ['AEXX', 'PRECFOCK', 'NKRED'],
      matches: (r) => r.bool('LHFCALC') === true && !r.num('HFSCREEN') && (r.num('AEXX') ?? 0.25) === 0.25,
    },
  ],
};

export const vdw: IntentKind = {
  id: 'vdw',
  label: 'van der Waals',
  owns: ['IVDW'],
  related: [],
  choices: [
    { id: 'none', label: 'None', description: 'No dispersion correction.', force: {}, matches: (r) => (r.num('IVDW') ?? 0) === 0 },
    { id: 'd3', label: 'DFT-D3 (zero damping)', description: 'Grimme D3.', force: { IVDW: '11' }, matches: (r) => r.num('IVDW') === 11 },
    { id: 'd3bj', label: 'DFT-D3 (BJ damping)', description: 'Grimme D3 with Becke–Johnson damping; the usual choice.', force: { IVDW: '12' }, matches: (r) => r.num('IVDW') === 12 },
    { id: 'd4', label: 'DFT-D4', description: 'Charge-dependent D4. VASP must be built with dftd4.', force: { IVDW: '13' }, matches: (r) => r.num('IVDW') === 13 },
    { id: 'ts', label: 'Tkatchenko–Scheffler', description: 'Hirshfeld-partitioned C6 coefficients.', force: { IVDW: '20' }, matches: (r) => [2, 20].includes(r.num('IVDW') ?? -1) },
    { id: 'mbd', label: 'Many-body dispersion', description: 'MBD@rsSCS.', force: { IVDW: '202' }, matches: (r) => r.num('IVDW') === 202 },
  ],
};

export const spin: IntentKind = {
  id: 'spin',
  label: 'Magnetism',
  owns: ['ISPIN', 'LNONCOLLINEAR', 'LSORBIT', 'MAGMOM', 'NUPDOWN', 'SAXIS'],
  related: [],
  choices: [
    {
      id: 'none',
      label: 'Non-magnetic',
      description: 'Spin-restricted calculation.',
      force: {},
      matches: (r) => effective.ispin(r) === 1 && !effective.noncollinear(r),
    },
    {
      id: 'collinear',
      label: 'Spin-polarized',
      description: 'Collinear magnetism (ferro- or antiferromagnetic).',
      force: { ISPIN: '2' },
      suggest: { MAGMOM: '', NUPDOWN: '' },
      matches: (r) => effective.ispin(r) === 2 && !effective.noncollinear(r),
      hints: ['Set MAGMOM explicitly: the default starts every atom at 1 μB (ferromagnetic).'],
    },
    {
      id: 'noncollinear',
      label: 'Noncollinear',
      description: 'Spins free to point in any direction.',
      force: { LNONCOLLINEAR: '.TRUE.' },
      suggest: { MAGMOM: '', SAXIS: '' },
      matches: (r) => r.bool('LNONCOLLINEAR') === true && r.bool('LSORBIT') !== true,
      hints: ['MAGMOM takes three components per atom. Use the vasp_ncl executable.'],
    },
    {
      id: 'soc',
      label: 'Spin–orbit coupling',
      description: 'Noncollinear with spin–orbit coupling.',
      force: { LSORBIT: '.TRUE.' },
      suggest: { MAGMOM: '', SAXIS: '' },
      matches: (r) => r.bool('LSORBIT') === true,
      hints: ['MAGMOM takes three components per atom. Use the vasp_ncl executable and switch symmetry off (ISYM = -1) for magnetic systems.'],
    },
  ],
};

export const smearing: IntentKind = {
  id: 'smearing',
  label: 'Occupations',
  owns: ['ISMEAR', 'SIGMA'],
  related: [],
  choices: [
    {
      id: 'gaussian',
      label: 'Gaussian',
      description: 'Insulators, semiconductors and molecules, or when unsure.',
      force: { ISMEAR: '0' },
      suggest: { SIGMA: '0.05' },
      matches: (r) => r.num('ISMEAR') === 0,
    },
    {
      id: 'mp',
      label: 'Methfessel–Paxton',
      description: 'Metals: relaxations and MD. Never for gapped systems.',
      force: { ISMEAR: '1' },
      suggest: { SIGMA: '0.2' },
      matches: (r) => effective.ismear(r) >= 1,
      hints: ['Choose SIGMA so that the entropy term T·S in OUTCAR stays below ~1 meV/atom.'],
    },
    {
      id: 'tetra',
      label: 'Tetrahedron (Blöchl)',
      description: 'Accurate total energies and DOS of bulk systems.',
      force: { ISMEAR: '-5' },
      matches: (r) => r.num('ISMEAR') === -5,
      hints: ['Needs a Γ-centred mesh with at least 3 k-points per direction (4 in total).'],
    },
    {
      id: 'fermi',
      label: 'Fermi–Dirac',
      description: 'Physical electronic temperature (SIGMA = k_B·T).',
      force: { ISMEAR: '-1' },
      suggest: { SIGMA: '0.0259' },
      matches: (r) => r.num('ISMEAR') === -1,
    },
  ],
};

export const accuracy: IntentKind = {
  id: 'accuracy',
  label: 'Accuracy',
  owns: ['PREC', 'EDIFF', 'LREAL'],
  related: ['ENCUT', 'EDIFF', 'NELM', 'ALGO'],
  choices: [
    {
      id: 'screening',
      label: 'Screening',
      description: 'Fast: PREC = Normal, EDIFF = 1E-4, real-space projectors.',
      force: { PREC: 'Normal', EDIFF: '1E-4', LREAL: 'Auto' },
      matches: (r) => (r.num('EDIFF') ?? 1e-4) >= 1e-4 - 1e-12,
    },
    {
      id: 'production',
      label: 'Production',
      description: 'Reliable energies, forces and stress: PREC = Accurate, EDIFF = 1E-6.',
      force: { PREC: 'Accurate', EDIFF: '1E-6', LREAL: '.FALSE.' },
      matches: (r) => {
        const ediff = r.num('EDIFF') ?? 1e-4;
        return r.str('PREC') === 'ACCURATE' && ediff < 1e-4 && ediff > 1e-7 * 1.0001;
      },
    },
    {
      id: 'tight',
      label: 'Tight',
      description: 'Phonons, elastic constants and DFPT: EDIFF = 1E-8.',
      force: { PREC: 'Accurate', EDIFF: '1E-8', LREAL: '.FALSE.' },
      suggest: { ADDGRID: '.TRUE.' },
      matches: (r) => r.str('PREC') === 'ACCURATE' && (r.num('EDIFF') ?? 1e-4) <= 1e-7 * 1.0001,
    },
  ],
};

export const INTENTS: IntentKind[] = [calculation, functional, spin, smearing, vdw, accuracy];
