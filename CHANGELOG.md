# Changelog

## 1.7.0 (2026-11-04)

### Added
- ph.x inputs: checks verified against `phq_readin.f90` (title line, the q point line or `qplot` list, `nq1..3` for `ldisp`, Γ for `epsil`, `zue`/`trans`, `modenum` with `ldisp`, `only_init`/`only_wfc`, `tr2_ph`, `start_q`), with fixes for the missing title and q point.
- ph.x against the pw.x input in the same folder: prefix and outdir must match, the pw.x run must be scf with a tight `conv_thr`, no `epsil` for metals. The pw.x input is found by prefix (the scf one when there are several) and rechecked when it changes.
- Builder cards for ph.x: q points (one point, grid, path), electric field, convergence, files.
- The file watcher also follows `*.in` and `*.pwi`, so a ph.x input is rechecked when its pw.x input changes.

## 1.6.0 (2026-11-04)

### Added
- Quantum ESPRESSO Builder for pw.x inputs (*Open Quantum ESPRESSO Builder*, or the gear in the title bar of a QE input; also offered as an alternative editor for `*.pwi`, `scf.in`, `relax.in`, …). Setup cards for calculation, occupations, magnetism, functional, van der Waals and SCF convergence (each choice is detected again when the input is read back), a table of all documented variables per namelist with typed fields, a header with the structure and pseudopotentials, and the checks with fix buttons.
- Text edits of namelist variables that keep comments, layout and order (set, remove, add to a namelist, create a missing namelist in the order QE reads them), also used by the builder.
- `?app=qe&input=<fixture>` in the browser harness shows the builder without VS Code.

## 1.5.0 (2026-11-04)

### Added
- *Create Quantum ESPRESSO Input from POSCAR…*: a formatted pw.x input (scf, relax or vc-relax) for a POSCAR or CONTCAR, with the cell, positions (selective dynamics as `if_pos`), standard atomic masses, a k-point grid at a chosen density, the namelists the calculation needs, and pseudopotentials and cutoffs taken from `$ESPRESSO_PSEUDO` when it exists.
- *Create POSCAR from Quantum ESPRESSO Input*: the structure of a pw.x input as a POSCAR (atoms grouped by species, `if_pos` as selective dynamics).
- A table of standard atomic weights (H–Pu), checked for plausibility in the tests.

## 1.4.0 (2026-11-04)

### Added
- pw.x: the structure. The cell is built as QE builds it (a port of `latgen` for every `ibrav`, with `celldm`, `A…` or `CELL_PARAMETERS`; each lattice is tested against its textbook volume) and the atoms are read from `ATOMIC_POSITIONS` in any unit.
- Hover on the value of `ibrav`/`celldm`/`A` or on `CELL_PARAMETERS`: lengths, angles, volume. Hover on an automatic `K_POINTS` grid: number of k points and spacing in Å⁻¹.
- Checks: atoms closer than 0.5 Å (also across the cell boundary), a cell that cannot be built, an uneven automatic grid (with a balanced one as fix), a shifted grid on a hexagonal cell (fix: offsets 0).
- A missing `K_POINTS` card gets a quick fix with a grid for the cell (0.3 Å⁻¹).
- *Generate k-point Mesh…* works on Quantum ESPRESSO inputs: it replaces or adds the `K_POINTS {automatic}` card at a chosen density.

### Changed
- The command is called *Generate k-point Mesh…* now (it was *Generate KPOINTS Mesh…*).

## 1.3.0 (2026-11-04)

### Added
- Pseudopotentials in pw.x inputs: the files named in `ATOMIC_SPECIES` are found in `pseudo_dir`, `$ESPRESSO_PSEUDO` or `~/espresso/pseudo` and their UPF 1/2 headers read (through `workspace.fs`, so also on Remote-SSH hosts; cached by modification time).
- Hover on a species line: element, type, functional, valence electrons, suggested cutoffs.
- Checks: missing file, pseudopotential for another element than the label, mixed functionals without `input_dft`, `ecutwfc`/`ecutrho` below the generator's suggested minimum, a note on the default `ecutrho` for ultrasoft/PAW, `lspinorb` without spin–orbit pseudopotentials, `nbnd` too small for the number of valence electrons (QE: "too few bands"), and an odd number of electrons with fixed occupations.

## 1.2.0 (2026-11-04)

### Added
- pw.x inputs: Format Document (one variable per line with `=` aligned, documented spelling of names, `.true.`/`.false.`, cards with aligned columns and `{option}` in braces; values, strings and comments untouched, order kept).
- pw.x cross-checks, each verified against the QE 7.4 source: `nat`/`ntyp` against the cards, species labels (case-sensitive), card columns, `ibrav` against `CELL_PARAMETERS` and `celldm`/`A` (including the `celldm(i)` each `ibrav` needs and the units rules), K_POINTS grids and lists (also BZ labels on band paths), `&IONS` for relax/md and `&CELL` for vc-* calculations (with a fix that adds them), `nspin = 2` without smearing, tetrahedra or `tot_magnetization` ("specify occupations"), smearing without `degauss`, tetrahedra without an automatic grid, `ecutrho` against `ecutwfc` (an error only when `ecutrho <= ecutwfc`, as in QE), magnetization notes, the OCCUPATIONS card.
- Warnings for Windows line endings (CRLF) and tab characters, which the QE documentation lists as sources of trouble, with fixes.

## 1.1.0 (2026-11-04)

First Quantum ESPRESSO release: pw.x input files.

### Added
- New *Quantum ESPRESSO* language for pw.x inputs (`*.pwi`, `scf.in`, `relax.in`, `vc-relax.in`, `bands.in`, `pw.*.in`, …); plain-text files that start with `&CONTROL` are switched to it automatically. Highlighting of namelists, variables, cards, strings and numbers.
- Checks for what QE stops on: unknown variables (with *did you mean*), variables in the wrong namelist, namelists out of order, repeated or missing, unterminated namelists and strings, values of the wrong type, several values for a scalar, array indices out of range, required variables. Notes for unquoted strings, values outside the documented options, repeated variables and missing cards. Variables that QE 7.4 still reads but no longer documents are not errors: the old DFT+U input (`lda_plus_u`, `Hubbard_U`, …, replaced by the `HUBBARD` card) is a warning, and the other accepted names (mostly cp.x variables) are silently accepted. The list comes from the namelist declarations in the QE source.
- Hover with description, type, default and allowed values for the 249 variables of pw.x, from the Quantum ESPRESSO 7.4 input documentation (the table also holds ph.x, projwfc.x, dos.x, bands.x and pp.x, for later releases). Completion of variable names, values and namelist/card names. Quick fixes for typos, quoting and near-miss options.
- `scripts/fetch-qe-tags.mjs` regenerates the variable table from the `INPUT_*.def` files of a QE release. The descriptions are excerpts from the QE documentation and keep its GPL-2.0-or-later licence (`LICENSES/GPL-2.0.txt`).

## 1.0.0 (2026-11-03)

DFTune now covers all four VASP input files: the INCAR builder, plus checks, hovers, quick fixes and formatting for INCAR, KPOINTS and POSCAR, and checks against the POTCAR. This release hardens what 0.7–0.9 added, after a full code review.

### Added
- *Generate KPOINTS Mesh…* on a CONTCAR, `*.vasp` or `POSCAR.*` file uses that file's cell (before, it always looked for a file named POSCAR).

### Changed
- The close-atoms check in POSCAR files is exact for any cell shape (strongly skewed cells could hide a close contact) and about 30× faster; it now runs for cells up to 4000 atoms.
- *New VASP Calculation…* no longer offers `KSPACING` when the folder already has a KPOINTS file (VASP would ignore it); it offers to keep or replace the KPOINTS instead.
- The INCAR checks read POSCAR and KPOINTS with the same parsers as their own linters, so both always agree.
- Diagnostics are computed once per edit and shared with the quick fixes. A result that arrives after a newer edit (slow file systems) is dropped; one that was overtaken by a change to a neighbouring file is computed again; a failed check is not remembered.
- The INCAR checks read only the header lines of POSCAR and KPOINTS (species, counts, cell, mesh), not every atom or k point, so large files don't slow down typing in the INCAR.
- *New VASP Calculation…* asks only once before replacing an existing KPOINTS.
- README reorganized by input file.

### Fixed
- A POSCAR with a bad scaling factor or lattice (a template, say) but valid species and counts no longer loses all INCAR checks that depend on it (MAGMOM length, per-species arrays, POTCAR order, the DFT+U table).
- *Generate KPOINTS Mesh…* on a structure file that cannot be read falls back to the POSCAR next to it instead of giving up.
- Format Document no longer repeats words of multi-word keywords: `Line mode` became `Line-mode mode`, `Selective dynamics ! relax` became `Selective dynamics dynamics ! relax`.
- "Remove KGAMMA" was offered for a Monkhorst–Pack KPOINTS file, where KGAMMA has no effect.

## 0.9.0 (2026-11-03)

### Added
- Quick fixes (lightbulb, Ctrl+.) in INCAR, KPOINTS and POSCAR files for problems with an obvious remedy: misspelled and renamed tags, `LASPH`, `LMAXMIX`, `ENCUT` from the POTCAR (1.3 × `ENMAX`), Gaussian smearing, `IBRION`, `ISYM` for MD, `LREAL = Auto`, `EDIFF` for phonons, `IBRION = 6/8` instead of 5/7, removing `NPAR`, `KSPACING`, `KGAMMA`, `GGA` or `ISPIN` where they conflict, Gamma instead of Monkhorst–Pack, a balanced mesh, Direct/Cartesian. In the builder, each fixable problem has a button.
- *Generate KPOINTS Mesh…*: a Γ-centred KPOINTS for the POSCAR at a chosen k-point spacing (coarse 0.5 to very fine 0.12 Å⁻¹, each showing its mesh). From the Explorer or editor context menu of a folder, POSCAR, INCAR or KPOINTS file.
- *New VASP Calculation…* ends with a k-points step: a KPOINTS file for the POSCAR in the folder, or `KSPACING` in the INCAR, at a chosen density.

## 0.8.0 (2026-11-03)

### Added
- POTCAR checks (only the header lines are read): elements and their order against the POSCAR, in both the INCAR and the POSCAR; `ENCUT` below the largest `ENMAX`; the Pulay-stress note for cell relaxations now names a cutoff (1.3 × `ENMAX`), and also flags a set `ENCUT` below 1.2 × `ENMAX`. The builder header lists the POTCARs.
- KPOINTS vs. POSCAR: an even Monkhorst–Pack mesh on a hexagonal cell is a warning (the generic note is dropped for other cells), and a mesh much finer in one direction than the others is noted with a balanced alternative.
- Hovers in KPOINTS: what each line means; on the mesh, the number of k points, the spacing in Å⁻¹ and the equivalent `KSPACING`; on a fully automatic length, the resulting mesh.
- `KSPACING` hover in the INCAR, and the builder header, show the mesh it gives for the POSCAR.
- `ML_LMLFF = .TRUE.` with the same element name for two species groups in the POSCAR is an error (VASP requires distinct names).

### Changed
- KPOINTS and POSCAR files find their neighbours like the INCAR does (`POSCAR.relax` for `KPOINTS.relax`, …) and are rechecked when those change on disk.
- Element names such as `Fe1` (sublattice labels) and `H1.25` (fractional hydrogen) are recognized.

## 0.7.0 (2026-11-03)

### Added
- POSCAR and CONTCAR files (`POSCAR`, `CONTCAR`, `POSCAR.*`, `CONTCAR.*`, `*.vasp`, `*.poscar`): highlighting, checks, hovers and Format Document.
  - Checks: unreadable numbers, zero or invalid scaling factors, a flat or left-handed cell, element names vs. atom counts, unknown element names, missing atoms, selective-dynamics flags, atoms closer than 0.5 Å (including periodic images), and coordinates that look like the other kind (Direct vs. Cartesian).
  - Hover: atom number, element and coordinates on a position line; lattice lengths and angles; the atom range of each element; cell volume.
  - Format Document: aligned lattice vectors and positions, element names above their counts, one spelling of Direct/Cartesian/Selective dynamics. Numbers are kept as written; CONTCAR velocities are left alone.
- CI runs a smoke test on the packaged extension (activation and providers, against a stubbed VS Code API).

## 0.6.0 (2026-11-03)

### Added
- KPOINTS files: syntax highlighting, checks in the Problems panel (unreadable numbers, truncated k-point lists, unpaired line-mode points, bad tetrahedra, and a few hints) and Format Document (aligned columns, one spelling of the mode words).

## 0.5.2 (2026-11-03)

### Added
- Extension icon, also shown at the top of the README.

## 0.5.1 (2026-11-04)

### Added
- Format Document spells the values of logical tags one way across the file, including inside `GROUP { }` blocks: `.TRUE.`/`.FALSE.` (default) or `T`/`F`, set with `dftune.format.logicals` (`keep` leaves them as written).

### Fixed
- An empty `GROUP { }` block (e.g. `KERNEL_TRUNCATION { }`) now gets its card in the builder; on one line it was a syntax error before. Setting a value in the card opens the block up.

## 0.5.0 (2026-11-03)

### Changed
- Renamed from *Project Electrons* to **DFTune**, now at [LeppertLab/DFTune](https://github.com/LeppertLab/DFTune). The extension ID changed to `DaanHolleman.dftune`: uninstall the old *Project Electrons* extension after installing this one.
- Commands, the builder and settings use the `dftune.` prefix; `projectElectrons.format.*` settings become `dftune.format.*`.
- Tag groups reorganized: *General* is gone; PREC, ENCUT, NBANDS, KSPACING, ISYM and similar are in **Electronic structure** (formerly *Electronic minimization*), ISTART, ICHARG and the output switches in **Flow control** (formerly *Output files & DOS*), which comes last. New **Many-body (GW, BSE, RPA)** group; *Linear response & dipoles* is now *Response properties*.
- Licensed under MIT; the tag descriptions from the VASP Wiki are under the GNU FDL 1.2.

### Added
- Documented tags without a curated definition are sorted into a group using the VASP Wiki's categories (about 595 of 609 tags), get a typed field in the builder, and show defaults that depend on other tags on hover.
- A builder card for each nested-tag group used in the file (e.g. `KERNEL_TRUNCATION`), listing all its documented tags; values set there go inside the existing `{ }` block.
- `INIWAV` and `IWAVPR` as curated tags.
- Releases are also published to the VS Code Marketplace (Trusted Publishing from GitHub Actions).

### Fixed
- Format Document keeps commented-out tags (`# ML_MB = 2000`) with their group, and comment lines that close a paragraph with that paragraph.
- Format Document puts `SYSTEM` first.
- Long nested tag names no longer overlap the input field in the builder.

## 0.4.0 (2026-11-02)

### Added
- **Format Document** (Alt+Shift+F) for INCAR files: one statement per line, upper-case tag names, tags grouped by category under `# Category` headers, `=` signs and trailing comments aligned. Values and comments are kept exactly, hand-written section headings on the same topic replace the default headers, and nothing is formatted while the file has syntax problems. Each step can be switched off (`projectElectrons.format.*`).
- `GROUP { ... }` blocks of nested tags (`KERNEL_TRUNCATION`, `PLUGINS`, per-image tags) are read: the tags inside get hover, checks and builder editing, and unbalanced braces are reported.

### Changed
- Errors are reserved for INCAR problems that stop VASP: unreadable values, arrays with too few values, and too few k points for the tetrahedron method. Arrays with too many values, values outside the documented options, lines that are not `TAG = value`, and unsupported combinations are now warnings.

### Fixed
- The ↗ buttons, diagnostics and *Show text* in the builder jump to the editor that already shows the INCAR instead of opening a new split.

## 0.3.0 (2026-11-02)

### Added
- New calculation types in the Calculation card and in *New VASP Calculation…*:
  - phonons from finite differences (`IBRION = 6`) and from DFPT (`IBRION = 8`)
  - elastic constants (`IBRION = 6`, `ISIF = 3`)
  - dielectric tensor and Born charges (`LEPSILON`)
  - optical properties (`LOPTICS`)
- Checks for these setups: `EDIFF` too loose for phonons, `IBRION = 5/7` without symmetry, `LEPSILON` with hybrid functionals, `LEPSILON` together with `LOPTICS`, `LOPTICS` with `ISMEAR = -2`.
- Curated `CSHIFT`, `LRPA` and `LCALCEPS`.
- Pushing a `v*` tag publishes a GitHub Release with the `.vsix` attached.

### Changed
- POSCAR and KPOINTS are watched only in folders with an open INCAR, instead of across the whole workspace (lighter on large cluster file systems).

### Fixed
- `ISIF ≥ 3` with `IBRION = 5–8` (elastic constants) is no longer reported as having no effect.
- Greek letters and symbols in wiki descriptions (η, Å, ⟨⟩) are shown instead of HTML codes.

## 0.2.0 (2026-11-02)

### Added
- Every documented VASP INCAR tag is recognized: the ~600 tags of the VASP wiki, numbered families (`LIBXC1_Pn`, `XCm_Pn`), grouped tags (`KERNEL_TRUNCATION/LTRUNCATE`), and the tags of the VTST and VASPsol patches. Uncommon but valid tags such as `POMASS` are no longer reported as typos.
- `POMASS` as a full tag, checked against the number of species in the POSCAR.
- Hover, completion and the builder's "Other tags" list show the wiki description of every tag.
- Values of uncommon tags are checked against the type the wiki states (logical, integer, real, arrays).
- Warnings for deprecated tags (with the wiki's advice) and notes for older names such as `ML_FF_*` and `LVDW`.
- Tags that VASP doesn't know are reported even without a close match, since VASP silently ignores them.
- KPOINTS support: the KPOINTS file next to the INCAR is read and summarized in the builder header. New checks:
  - `KSPACING` ignored because a KPOINTS file exists
  - no KPOINTS and no `KSPACING` (VASP's default mesh)
  - line-mode KPOINTS without `ICHARG = 11`
  - tetrahedron smearing with a Monkhorst–Pack mesh, `KGAMMA = .FALSE.`, or fewer than 4 k points
- CI on GitHub Actions: typecheck, tests, and the packaged `.vsix` as a build artifact.

## 0.1.0 (2026-10-30)

First version: the INCAR builder.

- Setup by intent (calculation type, functional, magnetism, smearing, van der Waals, accuracy) and a DFT+U table per species.
- About 100 curated tags with typed fields, defaults, units and wiki links.
- Minimal text edits: comments, layout and unknown tags survive; undo and git diffs stay clean.
- Syntax highlighting, hover, completion and diagnostics for plain-text INCARs.
- *New VASP Calculation…* command.
- Runs on the remote host over Remote-SSH.
