// Curated INCAR tag definitions (VASP 6). Defaults follow https://vasp.at/wiki.
// This is deliberately not exhaustive: tags missing here are still shown and preserved,
// they just get no typed editor or validation.

import type { TagDef } from './schema';

const bool = (name: string, category: TagDef['category'], summary: string, def: boolean, extra: Partial<TagDef> = {}): TagDef => ({
  name,
  type: 'bool',
  category,
  summary,
  default: def ? '.TRUE.' : '.FALSE.',
  ...extra,
});

export const TAG_DEFS: TagDef[] = [
  // ── Flow control and electronic structure ──────────────────────────────
  { name: 'SYSTEM', type: 'string', category: 'flow', summary: 'Free-text title of the calculation.', default: 'unknown system' },
  {
    name: 'PREC', type: 'string', open: true, category: 'electronic',
    summary: 'Precision mode: sets defaults for ENCUT and the FFT grids.',
    default: 'Normal',
    options: [
      { value: 'Normal', label: 'Normal', description: 'Default; adequate for most energies.' },
      { value: 'Accurate', label: 'Accurate', description: 'Finer grids, fewer wrap-around errors. Use for forces, stress and phonons.' },
      { value: 'High', label: 'High', description: 'Legacy: raises ENCUT by 30 %. Prefer Accurate plus an explicit ENCUT.' },
      { value: 'Low', label: 'Low', description: 'Quick tests only.' },
      { value: 'Single', label: 'Single', description: 'Like Accurate, with single-precision grids.' },
    ],
  },
  { name: 'ENCUT', type: 'real', category: 'electronic', unit: 'eV', summary: 'Plane-wave kinetic-energy cutoff.', defaultNote: 'largest ENMAX in POTCAR' },
  { name: 'ENAUG', type: 'real', category: 'electronic', unit: 'eV', summary: 'Cutoff for the augmentation charges.', defaultNote: 'largest EAUG in POTCAR', advanced: true },
  { name: 'ISTART', type: 'int', category: 'flow', summary: 'Whether to read the WAVECAR.', defaultNote: '1 if a WAVECAR exists, else 0',
    options: [
      { value: '0', label: 'From scratch' },
      { value: '1', label: 'Restart, constant ENCUT', description: 'Read WAVECAR; basis set adapts to the cell.' },
      { value: '2', label: 'Restart, constant basis set' },
      { value: '3', label: 'Full restart', description: 'Including the wavefunction prediction.' },
    ] },
  { name: 'ICHARG', type: 'int', open: true, category: 'flow', summary: 'Construction of the initial charge density.', defaultNote: '2 if ISTART = 0, else 0',
    options: [
      { value: '0', label: 'From WAVECAR' },
      { value: '1', label: 'Read CHGCAR' },
      { value: '2', label: 'Atomic charge superposition' },
      { value: '4', label: 'Read potential (POT)', description: 'Reads the local potential from the POT file.' },
      { value: '11', label: 'Non-SCF from CHGCAR', description: 'Fixed charge density: eigenvalues for DOS and band structures.' },
      { value: '12', label: 'Non-SCF from atomic charges', description: 'Non-self-consistent from superposed atomic charges (Harris–Foulkes).' },
    ] },
  { name: 'NBANDS', type: 'int', category: 'electronic', summary: 'Number of Kohn–Sham bands.', defaultNote: 'max((NELECT+2)/2 + NIONS/2, 0.6·NELECT), rounded up for parallelization' },
  { name: 'NELECT', type: 'real', category: 'electronic', summary: 'Total number of electrons (charged cells).', defaultNote: 'neutral cell (sum of ZVAL)', advanced: true },
  { name: 'KSPACING', type: 'real', category: 'electronic', unit: 'Å⁻¹', summary: 'Smallest k-point spacing; used only when there is no KPOINTS file.', default: '0.5' },
  bool('KGAMMA', 'electronic', 'KSPACING meshes are Γ-centred (otherwise Monkhorst–Pack).', true),
  {
    name: 'ISYM', type: 'int', category: 'electronic', summary: 'Symmetry treatment.',
    defaultNote: '2 for PAW; 3 with LHFCALC',
    options: [
      { value: '-1', label: 'Off, no symmetrization' },
      { value: '0', label: 'Off', description: 'Recommended for molecular dynamics.' },
      { value: '1', label: 'On (USPP)' },
      { value: '2', label: 'On, efficient charge symmetrization (PAW)' },
      { value: '3', label: 'On, symmetrize forces/stress only (hybrids)' },
    ],
  },
  { name: 'SYMPREC', type: 'real', category: 'electronic', summary: 'Tolerance for detecting symmetry from POSCAR positions.', default: '1E-5', advanced: true },

  // ── Electronic minimization ──────────────────────────────────────────────
  {
    name: 'ALGO', type: 'string', category: 'electronic', summary: 'Electronic minimization algorithm.', default: 'Normal',
    options: [
      { value: 'Normal', label: 'Normal', description: 'Blocked Davidson. Robust default.' },
      { value: 'Fast', label: 'Fast', description: 'Davidson for the first steps, then RMM-DIIS. Good for most semiconductors and metals.' },
      { value: 'VeryFast', label: 'VeryFast', description: 'RMM-DIIS only. Fast but less robust.' },
      { value: 'All', label: 'All', description: 'Conjugate gradient over all bands simultaneously. Robust for hybrids and magnetic systems.' },
      { value: 'Damped', label: 'Damped', description: 'Damped velocity friction. Recommended for hybrids and meta-GGAs that converge poorly.' },
      { value: 'Exact', label: 'Exact', description: 'Exact diagonalization. For many empty bands (GW, optics).' },
      { value: 'None', label: 'None', description: 'No electronic update (e.g. reusing WAVECAR for post-processing).' },
    ],
    open: true,
  },
  { name: 'NELM', type: 'int', category: 'electronic', summary: 'Maximum number of electronic steps per ionic step.', default: '60' },
  { name: 'NELMIN', type: 'int', category: 'electronic', summary: 'Minimum number of electronic steps.', default: '2' },
  { name: 'NELMDL', type: 'int', category: 'electronic', summary: 'Non-self-consistent steps at the start (negative: only for the first ionic step).', defaultNote: '-5 when starting from scratch, else 0', advanced: true },
  { name: 'EDIFF', type: 'real', category: 'electronic', unit: 'eV', summary: 'Energy convergence criterion of the SCF loop.', default: '1E-4' },
  {
    name: 'LREAL', type: 'string', category: 'electronic', summary: 'Evaluate projection operators in real space.', default: '.FALSE.',
    options: [
      { value: '.FALSE.', label: 'Reciprocal space', description: 'Exact; best for small cells.' },
      { value: 'Auto', label: 'Auto (real space, optimized)', description: 'Faster for cells above ~20 atoms. Small errors that are fine for MD and screening.' },
      { value: '.TRUE.', label: 'Real space (legacy)', description: 'Unoptimized projectors. Prefer Auto.' },
    ],
  },
  bool('LASPH', 'electronic', 'Non-spherical gradient corrections inside the PAW spheres. Needed for meta-GGAs, recommended for d/f elements.', false),
  bool('ADDGRID', 'electronic', 'Extra fine grid for augmentation charges (reduces noise in forces).', false, { advanced: true }),
  { name: 'AMIX', type: 'real', category: 'electronic', summary: 'Linear mixing parameter of the charge density.', defaultNote: '0.4 (0.8 for USPP)', advanced: true },
  { name: 'BMIX', type: 'real', category: 'electronic', summary: 'Cutoff wave vector for Kerker mixing.', default: '1.0', advanced: true },
  { name: 'AMIX_MAG', type: 'real', category: 'electronic', summary: 'Linear mixing parameter for the magnetization density.', default: '1.6', advanced: true },
  { name: 'BMIX_MAG', type: 'real', category: 'electronic', summary: 'Kerker cutoff for the magnetization density.', default: '1.0', advanced: true },
  { name: 'TIME', type: 'real', category: 'electronic', summary: 'Trial time step for ALGO = Damped/All.', default: '0.4', advanced: true },

  // ── Smearing ─────────────────────────────────────────────────────────────
  {
    name: 'ISMEAR', type: 'int', category: 'smearing', summary: 'How partial occupancies are assigned.', default: '1', open: true,
    options: [
      { value: '-5', label: 'Tetrahedron, Blöchl corrections', description: 'Accurate total energies and DOS. Needs ≥ 3 k-points per direction; forces not variational for metals.' },
      { value: '-4', label: 'Tetrahedron, no corrections' },
      { value: '-1', label: 'Fermi–Dirac', description: 'Physical electronic temperature SIGMA.' },
      { value: '0', label: 'Gaussian', description: 'Safe default for semiconductors, insulators and molecules (SIGMA ≈ 0.03–0.05).' },
      { value: '1', label: 'Methfessel–Paxton (N = 1)', description: 'Metals. Never for gapped systems.' },
      { value: '2', label: 'Methfessel–Paxton (N = 2)' },
    ],
  },
  { name: 'SIGMA', type: 'real', category: 'smearing', unit: 'eV', summary: 'Smearing width.', default: '0.2' },

  // ── Exchange–correlation ─────────────────────────────────────────────────
  {
    name: 'GGA', type: 'string', category: 'xc', summary: 'LDA/GGA exchange–correlation functional.', defaultNote: 'functional of the POTCAR (LEXCH)', open: true,
    options: [
      { value: 'PE', label: 'PBE' },
      { value: 'PS', label: 'PBEsol' },
      { value: 'RP', label: 'RPBE' },
      { value: '91', label: 'PW91' },
      { value: 'AM', label: 'AM05' },
      { value: 'CA', label: 'LDA (Ceperley–Alder)' },
    ],
  },
  {
    name: 'METAGGA', type: 'string', category: 'xc', summary: 'Meta-GGA functional. Requires LASPH = .TRUE.', open: true,
    options: [
      { value: 'R2SCAN', label: 'r²SCAN', description: 'Numerically stable SCAN variant. Usually preferred over SCAN.' },
      { value: 'SCAN', label: 'SCAN', description: 'Can be numerically unstable; needs dense grids.' },
      { value: 'RSCAN', label: 'rSCAN' },
      { value: 'TPSS', label: 'TPSS' },
      { value: 'MBJ', label: 'modified Becke–Johnson', description: 'Potential-only; for band gaps, not total energies.' },
    ],
  },
  bool('LMIXTAU', 'xc', 'Mix the kinetic-energy density along with the charge density (helps meta-GGA convergence).', false, { advanced: true }),
  bool('LHFCALC', 'xc', 'Hybrid functional / Hartree–Fock exchange.', false),
  { name: 'HFSCREEN', type: 'real', category: 'xc', unit: 'Å⁻¹', summary: 'Range-separation parameter μ (0.2 for HSE06).', default: '0' },
  { name: 'AEXX', type: 'real', category: 'xc', summary: 'Fraction of exact exchange.', defaultNote: '0.25 if LHFCALC = .TRUE., else 0' },
  { name: 'AGGAX', type: 'real', category: 'xc', summary: 'Fraction of GGA exchange.', defaultNote: '1 − AEXX', advanced: true },
  { name: 'AGGAC', type: 'real', category: 'xc', summary: 'Fraction of GGA correlation.', default: '1.0', advanced: true },
  { name: 'ALDAC', type: 'real', category: 'xc', summary: 'Fraction of LDA correlation.', default: '1.0', advanced: true },
  {
    name: 'PRECFOCK', type: 'string', category: 'xc', summary: 'FFT grid used for the exact-exchange operator.', default: 'Normal', advanced: true,
    options: [
      { value: 'Low', label: 'Low' },
      { value: 'Medium', label: 'Medium' },
      { value: 'Fast', label: 'Fast' },
      { value: 'Normal', label: 'Normal' },
      { value: 'Accurate', label: 'Accurate' },
    ],
  },
  { name: 'NKRED', type: 'int', category: 'xc', summary: 'Downsample the k-mesh for the Fock operator by this factor.', default: '1', advanced: true },

  // ── van der Waals ────────────────────────────────────────────────────────
  {
    name: 'IVDW', type: 'int', category: 'vdw', summary: 'Dispersion correction.', default: '0', open: true,
    options: [
      { value: '0', label: 'None' },
      { value: '11', label: 'DFT-D3, zero damping' },
      { value: '12', label: 'DFT-D3, Becke–Johnson damping' },
      { value: '13', label: 'DFT-D4', description: 'Requires VASP built with the dftd4 library.' },
      { value: '1', label: 'DFT-D2' },
      { value: '20', label: 'Tkatchenko–Scheffler' },
      { value: '21', label: 'TS, iterative Hirshfeld' },
      { value: '202', label: 'Many-body dispersion (MBD@rsSCS)' },
      { value: '4', label: 'dDsC' },
    ],
  },
  bool('LUSE_VDW', 'vdw', 'Non-local vdW-DF functionals (vdW-DF, optB88, rVV10…).', false, { advanced: true }),

  // ── Spin ─────────────────────────────────────────────────────────────────
  {
    name: 'ISPIN', type: 'int', category: 'spin', summary: 'Spin polarization.', default: '1',
    options: [
      { value: '1', label: 'Non-spin-polarized' },
      { value: '2', label: 'Spin-polarized (collinear)' },
    ],
  },
  { name: 'MAGMOM', type: 'realArray', category: 'spin', unit: 'μB', perAtom: true, summary: 'Initial magnetic moment per atom (3 components per atom if noncollinear).', defaultNote: '1.0 per atom' },
  { name: 'NUPDOWN', type: 'real', category: 'spin', summary: 'Fixed difference between up and down electrons (−1: not fixed).', default: '-1' },
  bool('LNONCOLLINEAR', 'spin', 'Noncollinear magnetism.', false),
  bool('LSORBIT', 'spin', 'Spin–orbit coupling (implies LNONCOLLINEAR).', false),
  { name: 'SAXIS', type: 'realArray', category: 'spin', summary: 'Quantization axis for noncollinear spins.', default: '0 0 1', advanced: true },
  { name: 'I_CONSTRAINED_M', type: 'int', category: 'spin', summary: 'Constrain local magnetic moments.', advanced: true,
    options: [
      { value: '1', label: 'Constrain direction' },
      { value: '2', label: 'Constrain size and direction' },
    ] },

  // ── DFT+U ────────────────────────────────────────────────────────────────
  bool('LDAU', 'ldau', 'Enable DFT+U.', false),
  {
    name: 'LDAUTYPE', type: 'int', open: true, category: 'ldau', summary: 'DFT+U formulation.', default: '2',
    options: [
      { value: '1', label: 'Liechtenstein (U and J separately)' },
      { value: '2', label: 'Dudarev (only U − J matters)' },
      { value: '4', label: 'Liechtenstein, no exchange splitting' },
    ],
  },
  { name: 'LDAUL', type: 'intArray', category: 'ldau', perSpecies: true, summary: 'Angular momentum per species (−1: no U, 1: p, 2: d, 3: f).' },
  { name: 'LDAUU', type: 'realArray', category: 'ldau', perSpecies: true, unit: 'eV', summary: 'Effective on-site Coulomb U per species.' },
  { name: 'LDAUJ', type: 'realArray', category: 'ldau', perSpecies: true, unit: 'eV', summary: 'On-site exchange J per species.' },
  {
    name: 'LMAXMIX', type: 'int', open: true, category: 'ldau', summary: 'Max l of the one-center PAW densities passed through the mixer. Set 4 for d, 6 for f elements.', default: '2',
    options: [
      { value: '2', label: '2 (s, p)' },
      { value: '4', label: '4 (d elements)' },
      { value: '6', label: '6 (f elements)' },
    ],
  },
  { name: 'LDAUPRINT', type: 'int', category: 'ldau', summary: 'Verbosity of the DFT+U occupation matrices.', default: '0', advanced: true },

  // ── Ionic relaxation ─────────────────────────────────────────────────────
  {
    name: 'IBRION', type: 'int', open: true, category: 'ionic', summary: 'How ions are updated.', defaultNote: '-1 if NSW = 0, else 0 (MD!)',
    options: [
      { value: '-1', label: 'No update' },
      { value: '0', label: 'Molecular dynamics' },
      { value: '1', label: 'Quasi-Newton (RMM-DIIS)', description: 'Fast close to the minimum; needs good forces.' },
      { value: '2', label: 'Conjugate gradient', description: 'Robust default for relaxations.' },
      { value: '3', label: 'Damped MD', description: 'Good for poor starting geometries.' },
      { value: '5', label: 'Finite differences', description: 'Phonons / Hessian, no symmetry.' },
      { value: '6', label: 'Finite differences, with symmetry' },
      { value: '7', label: 'DFPT' },
      { value: '8', label: 'DFPT, with symmetry' },
      { value: '44', label: 'Improved dimer method', description: 'Transition-state search.' },
    ],
  },
  { name: 'NSW', type: 'int', category: 'ionic', summary: 'Maximum number of ionic steps.', default: '0' },
  {
    name: 'ISIF', type: 'int', category: 'ionic', summary: 'Which degrees of freedom move, and whether stress is computed.',
    defaultNote: '0 for MD or hybrids, else 2',
    options: [
      { value: '0', label: 'Ions; no stress' },
      { value: '1', label: 'Ions; stress trace only' },
      { value: '2', label: 'Ions; stress computed' },
      { value: '3', label: 'Ions + cell shape + volume' },
      { value: '4', label: 'Ions + cell shape (fixed volume)' },
      { value: '5', label: 'Cell shape only' },
      { value: '6', label: 'Cell shape + volume' },
      { value: '7', label: 'Volume only' },
      { value: '8', label: 'Ions + volume (VASP ≥ 6.4.1)' },
    ],
  },
  { name: 'EDIFFG', type: 'real', category: 'ionic', summary: 'Ionic convergence: > 0 energy change (eV), < 0 max force (eV/Å).', defaultNote: 'EDIFF × 10' },
  { name: 'POTIM', type: 'real', category: 'ionic', summary: 'Step width: scaling for relaxations, time step (fs) for MD.', defaultNote: '0.5 (none for MD: must be set)' },
  { name: 'PSTRESS', type: 'real', category: 'ionic', unit: 'kbar', summary: 'External pressure for cell relaxations and NPT MD.', default: '0' },
  { name: 'NFREE', type: 'int', category: 'ionic', summary: 'Displacements per direction (IBRION = 5/6) or history size (IBRION = 1).', advanced: true },

  // ── Molecular dynamics ───────────────────────────────────────────────────
  {
    name: 'MDALGO', type: 'int', open: true, category: 'md', summary: 'Molecular dynamics thermostat / ensemble.', default: '0',
    options: [
      { value: '0', label: 'Standard (Nosé via SMASS)' },
      { value: '1', label: 'Andersen thermostat' },
      { value: '2', label: 'Nosé–Hoover thermostat' },
      { value: '3', label: 'Langevin (NVT, or NpT with ISIF = 3)' },
      { value: '4', label: 'Nosé–Hoover chains' },
      { value: '5', label: 'CSVR (Bussi)' },
    ],
  },
  { name: 'TEBEG', type: 'real', category: 'md', unit: 'K', summary: 'Starting temperature.', default: '0' },
  { name: 'TEEND', type: 'real', category: 'md', unit: 'K', summary: 'Final temperature (linear ramp).', defaultNote: 'TEBEG' },
  { name: 'SMASS', type: 'real', category: 'md', summary: 'Nosé mass (−3: NVE; 0: period of 40 steps).', default: '-3' },
  { name: 'LANGEVIN_GAMMA', type: 'realArray', category: 'md', perSpecies: true, unit: 'ps⁻¹', summary: 'Langevin friction per species.' },
  { name: 'LANGEVIN_GAMMA_L', type: 'real', category: 'md', unit: 'ps⁻¹', summary: 'Langevin friction for the lattice (NpT).' },
  { name: 'PMASS', type: 'real', category: 'md', unit: 'amu', summary: 'Fictitious mass of the lattice (NpT).', default: '1000' },
  { name: 'POMASS', type: 'realArray', category: 'md', perSpecies: true, unit: 'amu', summary: 'Atomic mass per species, overriding the POTCAR masses (e.g. deuterium instead of hydrogen in MD). Give one value per species.', defaultNote: 'masses from POTCAR', advanced: true },
  { name: 'NBLOCK', type: 'int', category: 'md', summary: 'Steps between pair-correlation/DOS updates and XDATCAR writes.', default: '1', advanced: true },

  // ── Flow control: output files ─────────────────────────────────────────
  bool('LWAVE', 'flow', 'Write WAVECAR.', true),
  bool('LCHARG', 'flow', 'Write CHGCAR and CHG.', true),
  {
    name: 'LORBIT', type: 'int', category: 'flow', summary: 'Projected DOS / PROCAR output.',
    options: [
      { value: '10', label: 'lm-summed DOS (DOSCAR)' },
      { value: '11', label: 'lm-decomposed DOS + PROCAR', description: 'Most common choice; uses Wigner–Seitz radii from POTCAR.' },
      { value: '12', label: 'As 11, with phase factors' },
      { value: '13', label: 'As 11, spin-orbit resolved' },
      { value: '14', label: 'As 13, with phases' },
    ],
    open: true,
  },
  { name: 'NEDOS', type: 'int', category: 'flow', summary: 'Number of grid points of the DOS.', default: '301' },
  { name: 'EMIN', type: 'real', category: 'flow', unit: 'eV', summary: 'Lower energy bound of the DOS.', advanced: true },
  { name: 'EMAX', type: 'real', category: 'flow', unit: 'eV', summary: 'Upper energy bound of the DOS.', advanced: true },
  bool('LVTOT', 'flow', 'Write the total local potential (LOCPOT).', false),
  bool('LVHAR', 'flow', 'Write only the electrostatic potential to LOCPOT (work functions).', false),
  bool('LELF', 'flow', 'Write the electron localization function (ELFCAR).', false, { advanced: true }),
  bool('LAECHG', 'flow', 'Write all-electron densities for Bader analysis.', false),
  { name: 'NWRITE', type: 'int', category: 'flow', summary: 'Verbosity of OUTCAR (0–4).', default: '2', advanced: true },
  {
    name: 'INIWAV', type: 'int', category: 'flow', summary: 'Initial orbitals when starting from scratch.', default: '1', advanced: true,
    options: [
      { value: '0', label: 'Jellium', description: 'Lowest plane waves.' },
      { value: '1', label: 'Random', description: 'The safe choice.' },
    ],
  },
  {
    name: 'IWAVPR', type: 'int', open: true, category: 'flow', summary: 'Extrapolation of orbitals and charge density from one ionic step to the next.',
    defaultNote: 'depends on IBRION: extrapolation for MD and relaxations, 0 for static runs', advanced: true,
    options: [
      { value: '0', label: 'None' },
      { value: '1', label: 'Charge density (atomic)' },
      { value: '2', label: 'Second order: orbitals and density' },
      { value: '3', label: 'Second-order orbitals, atomic density' },
      { value: '11', label: 'Charge density (atomic), in memory' },
      { value: '12', label: 'Second order, in memory' },
      { value: '13', label: 'Mixed, in memory' },
    ],
  },

  // ── Response & dipoles ───────────────────────────────────────────────────
  bool('LEPSILON', 'response', 'Static dielectric tensor and Born charges via DFPT.', false),
  bool('LOPTICS', 'response', 'Frequency-dependent dielectric function (needs many empty bands).', false),
  { name: 'CSHIFT', type: 'real', category: 'response', unit: 'eV', summary: 'Lorentzian broadening (complex shift) of the dielectric function in the Kramers–Kronig transformation.', advanced: true },
  bool('LRPA', 'response', 'Local field effects on the Hartree level only (RPA). Keep .FALSE. for LEPSILON.', false, { advanced: true }),
  bool('LCALCEPS', 'response', 'Dielectric tensor, Born charges and piezoelectric tensor from finite electric fields (works with hybrids).', false, { advanced: true }),
  bool('LDIPOL', 'response', 'Dipole correction to the potential (slabs, molecules).', false),
  {
    name: 'IDIPOL', type: 'int', category: 'response', summary: 'Direction of the dipole correction.',
    options: [
      { value: '1', label: 'Along a1' },
      { value: '2', label: 'Along a2' },
      { value: '3', label: 'Along a3 (typical slab)' },
      { value: '4', label: 'All directions (molecule in a box)' },
    ],
  },
  { name: 'DIPOL', type: 'realArray', category: 'response', summary: 'Center of the cell for the dipole correction (direct coordinates).', advanced: true },

  // ── Parallelization ──────────────────────────────────────────────────────
  { name: 'NCORE', type: 'int', category: 'parallel', summary: 'Cores working on one orbital. Typically the cores per socket/NUMA domain.', default: '1' },
  { name: 'NPAR', type: 'int', category: 'parallel', summary: 'Bands treated in parallel (alternative to NCORE; takes precedence).', advanced: true },
  { name: 'KPAR', type: 'int', category: 'parallel', summary: 'k-point groups treated in parallel.', default: '1' },
  { name: 'NSIM', type: 'int', category: 'parallel', summary: 'Bands optimized simultaneously in RMM-DIIS / blocked Davidson.', default: '4', advanced: true },
  bool('LPLANE', 'parallel', 'Plane-wise data distribution in real space.', true, { advanced: true }),

  // ── MLFF ─────────────────────────────────────────────────────────────────
  bool('ML_LMLFF', 'mlff', 'Enable machine-learned force fields.', false),
  {
    name: 'ML_MODE', type: 'string', category: 'mlff', summary: 'MLFF mode.', default: 'none',
    options: [
      { value: 'train', label: 'train', description: 'On-the-fly training during MD (from scratch or continuing from ML_AB).' },
      { value: 'select', label: 'select', description: 'Reselect local reference configurations from ML_AB.' },
      { value: 'refit', label: 'refit', description: 'Refit a fast-evaluation force field (ML_FFN) from ML_AB.' },
      { value: 'run', label: 'run', description: 'Production MD with a trained ML_FF; no ab initio steps.' },
      { value: 'delta', label: 'delta', description: 'Learn the difference between two levels of theory (VASP ≥ 6.6).' },
      { value: 'none', label: 'none' },
    ],
  },
  { name: 'ML_CTIFOR', type: 'real', category: 'mlff', summary: 'Initial Bayesian force-error threshold for triggering ab initio steps.', default: '0.002', advanced: true },
  { name: 'ML_MB', type: 'int', category: 'mlff', summary: 'Maximum number of local reference configurations per species.', advanced: true },
  { name: 'ML_MCONF', type: 'int', category: 'mlff', summary: 'Maximum number of structures in the training set.', advanced: true },
  { name: 'ML_RCUT1', type: 'real', category: 'mlff', unit: 'Å', summary: 'Cutoff of the radial descriptor.', default: '8', advanced: true },
  { name: 'ML_RCUT2', type: 'real', category: 'mlff', unit: 'Å', summary: 'Cutoff of the angular descriptor.', default: '5', advanced: true },
];

export const TAGS: ReadonlyMap<string, TagDef> = new Map(TAG_DEFS.map((d) => [d.name, d]));

export function tagDef(name: string): TagDef | undefined {
  return TAGS.get(name.toUpperCase());
}
