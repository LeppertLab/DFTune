<p align="center"><img src="images/icon.png" alt="DFTune logo" width="128"></p>

# DFTune

A VS Code extension for setting up DFT calculations by **physical intent** (calculation type, functional, magnetism, smearing, accuracy, DFT+U) instead of remembering tags and magic numbers, and for catching the mistakes the codes themselves don't complain about (or only complain about after a day in the queue). It covers **VASP** (INCAR, KPOINTS, POSCAR, POTCAR) and **Quantum ESPRESSO** (pw.x, ph.x, dos.x, projwfc.x, bands.x, pp.x, plotband.x, plotrho.x): builders, checks, hovers, completion, quick fixes, formatting, and conversion between POSCAR and pw.x inputs.

It is built for the usual HPC workflow: VS Code connected to a cluster with **Remote-SSH**. The extension runs on the cluster (`extensionKind: workspace`) and edits the files in place, so nothing is copied back and forth. The builder UIs are bundled locally and need no internet access.

Every check that says "QE stops" or "VASP refuses" was taken from the code or its documentation: for Quantum ESPRESSO from the 7.4 source, for VASP from the wiki. Where a code only prints a message, DFTune only warns.

## VASP

### INCAR

- **INCAR Builder** (open an INCAR, then click the gear in the editor title bar or run *VASP: Open INCAR Builder*)
  - *Setup* cards: pick "Relax ions + cell", "Phonons (finite differences)", "HSE06", "Spin-polarized"… and see which tags that writes. Calculation types: single point, relaxations, DOS/bands, phonons (finite differences or DFPT), elastic constants, dielectric tensor, optics, MD (NVT/NpT) and MLFF training/production. The current INCAR is read back into these choices; anything that doesn't fit a preset shows up as *Custom* and is never overwritten silently.
  - *All tags*: about 100 common tags with typed fields, defaults, units, descriptions and VASP wiki links. Every other tag is kept and remains editable as raw text, with its description from the VASP wiki. Each nested-tag group used in the file (e.g. `KERNEL_TRUNCATION { … }`) gets its own card.
  - DFT+U table per species, read from the neighbouring POSCAR.
  - The header shows what the neighbouring files hold: atoms and species, the k-point setup (or the mesh `KSPACING` gives), and the POTCARs.
  - Live checks, with a button for each problem that has a quick fix.
- **The INCAR text stays the source of truth.** The builder applies minimal text edits, so comments, alignment, tag order and unknown tags survive. Undo/redo, git diffs and the plain text editor all stay in sync, and typing in the text updates the builder.
- **In the text editor**: syntax highlighting, hover docs (for `KSPACING` also the mesh it gives for the POSCAR), completion of tags and values, diagnostics in the Problems panel, and quick fixes.
- **Format Document** (Alt+Shift+F) tidies an INCAR, e.g. one written by pymatgen: one statement per line, tag names in upper case, tags grouped by category under `# Category` headers, `=` signs and trailing comments aligned, and logical values spelled one way (`.TRUE.`/`.FALSE.` or `T`/`F`). Other values and all comments are kept exactly; hand-written section headings on the same topic replace the default headers. It refuses to run while the file has syntax problems. Each step can be switched off in the settings (`dftune.format.*`).

Checks: typos (`ENCTU` → did you mean `ENCUT`?), tags VASP doesn't know (it silently ignores them), deprecated and renamed tags, invalid values, duplicates, and physics/setup pitfalls such as `NSW > 0` without `IBRION` (silently runs MD), MD without `POTIM`/`TEBEG`, tetrahedron smearing with forces, Methfessel–Paxton by default, Pulay stress in cell relaxations, meta-GGA without `LASPH`, hybrid parameters without `LHFCALC`, `MAGMOM` length vs. atom count (×3 if noncollinear), per-species arrays (`LDAUU`, `LANGEVIN_GAMMA`) vs. POSCAR species, `LMAXMIX` for d/f +U, `ICHARG = 11` with ionic steps, `NCORE` and `NPAR` both set, `LREAL` for large cells, and MLFF runs with the same element name for two species groups.

Known tags are the ~600 INCAR tags on the VASP wiki (including numbered families such as `LIBXC1_Pn` and grouped tags such as `KERNEL_TRUNCATION/LTRUNCATE`), their wiki redirects (older names such as `ML_FF_*`), and the tags of the VTST and VASPsol patches.

### KPOINTS

For `KPOINTS`, `KPOINTS.*`, `KPOINTS_*` and `*.kpoints`: highlighting, checks, hovers, quick fixes and Format Document.

- **Checks** read the file the way VASP does, by line position, and flag what it cannot read: a missing or non-numeric count, subdivisions or coordinates, a file that ends before the announced k points, line-mode points that don't come in pairs, tetrahedron corners outside the k-point list. Softer notes: a mode word VASP reads as generating vectors, all-zero weights, text VASP ignores. Against the POSCAR: an even Monkhorst–Pack mesh on a hexagonal cell, and a mesh much finer in one direction than in the others (e.g. 8 × 8 × 8 for a slab), with a balanced mesh as quick fix.
- **Hover** explains each line; on the mesh you also get the number of k points, the spacing in Å⁻¹ and the equivalent `KSPACING`; on a fully automatic length, the mesh it gives.
- **Format Document** only changes whitespace: mode words get one spelling (`gamma` → `Gamma`), k points and vectors are lined up on the decimal point with their labels in one column, and line-mode segments are separated by one blank line. Numbers are copied as written, and it refuses to run while the file has errors.
- **Generate k-point Mesh…** (right-click a folder, POSCAR, INCAR, KPOINTS or Quantum ESPRESSO input, or from the editor's context menu) writes a Γ-centred mesh for the POSCAR at a chosen k-point spacing; for `INCAR.relax` it writes `KPOINTS.relax`. It asks before replacing a file. On a Quantum ESPRESSO input it replaces (or adds) the `K_POINTS {automatic}` card with a grid for that input's cell.

### POSCAR and CONTCAR

For `POSCAR`, `CONTCAR`, `POSCAR.*`, `CONTCAR.*`, `*.vasp` and `*.poscar`: highlighting, checks, hovers, quick fixes and Format Document.

- **Checks**: unreadable numbers, a zero or invalid scaling factor, a flat or left-handed cell, element names that don't match the atom counts or aren't elements, missing atoms, selective-dynamics flags that aren't T/F, atoms closer than 0.5 Å (also across the cell boundary), and Direct/Cartesian mix-ups (fractional coordinates of 3.5, or Cartesian ones that all fit in 1 Å).
- **Hover** over a position for the atom's number, element and coordinates in the other system (and which directions selective dynamics frees); over the lattice for lengths and angles; over a count for the atom range of that element; over the scale for the cell volume.
- **Format Document** lines up the lattice and the positions on the decimal point, puts element names above their counts, and spells `Direct`/`Cartesian`/`Selective dynamics` one way, keeping every number as written and CONTCAR velocities untouched.

### POTCAR

The POTCAR itself is never shown or changed; only its header lines (`TITEL`, `ENMAX`, `ZVAL`) are read. It is checked against the POSCAR, from both the INCAR and the POSCAR: the number of species and their order (a POTCAR in the wrong order runs without complaint and silently uses the wrong potentials). The INCAR's `ENCUT` is compared with the largest `ENMAX`, and cell relaxations get a concrete cutoff (1.3 × `ENMAX`) against Pulay stress.

### Files that belong together

The files of one calculation are found in the same folder: `POSCAR.relax` for `INCAR.relax` (or `KPOINTS.relax`), otherwise `POSCAR`; likewise for KPOINTS and POTCAR. Open files are rechecked when one of their neighbours changes on disk. Only folders with an open input file are watched, which keeps the extension light on large cluster file systems.

### New calculations

**New VASP Calculation…** (right-click a folder): answer a few quick picks and get a commented INCAR. The last pick sets up the k points: a Γ-centred KPOINTS for the POSCAR in the folder, or `KSPACING` in the INCAR, at a density you choose (each option shows the mesh it gives).

### Quick fixes

Problems with an obvious remedy offer a fix (lightbulb, Ctrl+.; in the builder a button): a misspelled or renamed tag, `LASPH` for meta-GGAs, `LMAXMIX` for +U, `ENCUT` from the POTCAR, Gaussian smearing instead of the default or tetrahedra with forces, `IBRION` for `NSW > 0`, removing `NPAR` next to `NCORE` or an ignored `KSPACING`, Gamma instead of Monkhorst–Pack, a balanced k-point mesh, Direct/Cartesian.

## Quantum ESPRESSO

### pw.x

- **Quantum ESPRESSO Builder** (the gear in the editor title bar of a QE input, or *Open Quantum ESPRESSO Builder*): the same idea as the INCAR builder. *Setup* cards pick the calculation (scf, relax, vc-relax, md, nscf, bands), occupations (insulator, metal with smearing, tetrahedra), magnetism (non-magnetic, collinear, noncollinear, spin–orbit), functional, van der Waals correction and SCF convergence, and show which variables each writes; the current input is read back into these choices, and anything that fits no preset shows as *Custom* and is never overwritten silently. *All variables* lists every documented variable of every namelist with a typed field (logicals and fixed options as drop-downs, strings quoted for you), its description, and a jump to the text. The header shows atoms, cell, k points and pseudopotentials; problems come with their fix buttons. Edits are minimal text edits: comments, layout and order survive, and a missing `&IONS` or `&CELL` is added in the right place.

Files are recognized by name (`*.pwi`, `scf.in`, `relax.in`, `vc-relax.in`, `bands.in`, `pw.*.in`, …) or by content: a plain-text file that starts with `&CONTROL` is switched to the *Quantum ESPRESSO* language automatically.

- **Highlighting** of namelists, variables, cards, strings, logicals and numbers.
- **Checks** for what QE itself stops on. Unlike VASP, QE rejects variables it does not know, so these are errors: unknown variables (with *did you mean*), variables in the wrong namelist (`ecutrho` in `&CONTROL` → belongs in `&SYSTEM`), namelists out of order, repeated or missing, unterminated namelists and strings, values of the wrong type (`nbnd = 4.5`, `nosym = yes`), several values for a scalar, array indices out of range, and the required variables (`ecutwfc`, `ibrav` unless `space_group`, `nat`, `ntyp`). Softer: unquoted strings, values outside the documented options (`calculation = 'relx'`), a variable set twice, missing cards, and obsolete variables that QE 7.4 still reads (the old `lda_plus_u` / `Hubbard_U` input, replaced by the `HUBBARD` card). Names that QE accepts but does not document are not reported.
- **Hover** on a variable: description, type, default and allowed values, taken from the Quantum ESPRESSO 7.4 input documentation (249 variables of pw.x; the tables also include ph.x, projwfc.x, dos.x, bands.x and pp.x for the coming releases).
- **Completion** of variable names inside a namelist (required ones first), of the values of variables with a fixed set of options, and of namelist and card names.
- **Quick fixes** for typos, quoting strings, values near an allowed option, and the namelists or settings a check asks for.
- **Cross-checks** between variables and cards, each taken from a condition in the QE 7.4 source: `nat` and `ntyp` against the cards, species labels, the columns of each card, `ibrav` against `CELL_PARAMETERS` and `celldm`/`A`, the `celldm(i)` each `ibrav` needs, the units of `CELL_PARAMETERS`, the K_POINTS grid or list, `&IONS` and `&CELL` for the calculation, `nspin = 2` without smearing (QE stops with "specify occupations"), smearing without `degauss`, tetrahedra without an automatic grid, `ecutrho` against `ecutwfc`, starting magnetization, and Windows line endings or tabs.
- **Structure**: the cell is built the way QE builds it (`ibrav` + `celldm`/`A…`, or `CELL_PARAMETERS`; a port of QE's `latgen`, tested against the textbook volume of every Bravais lattice) and the atoms are read in any unit. Hover the value of `ibrav`/`celldm`/`A` or `CELL_PARAMETERS` for lengths, angles and volume; hover an automatic `K_POINTS` grid for the number of k points and the spacing in Å⁻¹. Checks: atoms closer than 0.5 Å (also across the cell boundary), a cell that cannot be built (impossible angles), an automatic grid much finer in one direction than in the others (e.g. 8 × 8 × 8 for a slab; with a balanced grid as fix), and a shifted grid on a hexagonal cell (breaks the symmetry; fix: offsets 0). A missing `K_POINTS` card gets a fix with a grid for the cell at 0.3 Å⁻¹.
- **Format Document** (Alt+Shift+F): one variable per line with `=` aligned, documented spelling of variable names, `.true.`/`.false.`, `&NAME` and `/` in the usual form, cards with their columns lined up and the option in braces (`ATOMIC_POSITIONS {angstrom}`). Values, strings and all comments are kept and the order stays as written; it refuses to run while the file has syntax errors.

- **Pseudopotentials**: the files named in `ATOMIC_SPECIES` are looked up in `pseudo_dir` (relative to the input's folder; else `$ESPRESSO_PSEUDO`, else `~/espresso/pseudo`) and their UPF headers read (UPF 1 and 2; the potential itself is not read). Hovering a species line shows element, type (norm-conserving, ultrasoft, PAW), functional, valence electrons and the cutoffs the generator suggests. Checks: a file that is not there, a pseudopotential for another element than the species label, pseudopotentials generated with different functionals (without `input_dft`), `ecutwfc`/`ecutrho` below the generator's suggested minimum (the default `ecutrho = 4 × ecutwfc` is often too low for ultrasoft and PAW), `lspinorb` without spin–orbit pseudopotentials, and the number of valence electrons against `nbnd` ("too few bands") and against fixed occupations (an odd number of electrons is a metal).

### Conversion between POSCAR and pw.x

- **Create Quantum ESPRESSO Input from POSCAR…** (right-click a POSCAR or CONTCAR): pick scf, relax or vc-relax and a k-point density, and get `scf.in` / `relax.in` / `vc-relax.in` next to it: `ibrav = 0` with `CELL_PARAMETERS {angstrom}`, `ATOMIC_POSITIONS {crystal}` (selective dynamics become `if_pos` flags), the standard atomic masses, a k-point grid for the cell, the namelists a relaxation needs, and the input formatted. Pseudopotentials are picked from `$ESPRESSO_PSEUDO` (or `~/espresso/pseudo`) when it exists (a PBE file if there is one), and the cutoffs they suggest are used.
- **Create POSCAR from Quantum ESPRESSO Input** (right-click a pw.x input): writes `POSCAR` next to it, atoms grouped by species, `if_pos = 0` becoming selective dynamics. Both ask before replacing a file.

### ph.x

Phonon inputs (`ph.in`, `*.phi`, or any file starting with `&inputph`) get the same support: highlighting, hover and completion for the 69 variables of `&INPUTPH`, Format Document, and the builder with cards for the q points (one point, a grid, a path), the electric field and the convergence. Checks, each from `phq_readin.f90`: the title line before the namelist (a first line `&inputph` is an error, with a fix), the q point line after it (or the `nqs` list with `qplot`), `nq1 nq2 nq3` for `ldisp`, the Γ point for `epsil`, and the combinations QE refuses (`zue` without `trans`, `modenum` with `ldisp`, `only_init` with `only_wfc`, `tr2_ph <= 0`, `start_q < 1`). When the pw.x input of the run is in the same folder (same prefix, the scf one if there are several) it is compared: prefix and outdir must match, the pw.x run must be scf with a tight `conv_thr`, and `epsil` is refused for metals.

### dos.x, projwfc.x, bands.x

Inputs that start with `&DOS`, `&PROJWFC` or `&BANDS` get highlighting, hover and completion, Format Document, builder cards (Brillouin-zone integration, energy window, options, files) and checks from the QE 7.4 sources: for projwfc.x the combinations it refuses (`pawproj` with `lforcet` or `tdosinboxes`, `lforcet` without `lsym = .false.`, `diag_basis` with `pawproj`) and for bands.x `spin_component`. They continue a pw.x run, so the pw.x input in the same folder (same prefix; the nscf run for dos.x and projwfc.x, the bands run for bands.x) is compared: prefix and outdir must match; dos.x with tetrahedra needs `K_POINTS {automatic}`; bands.x refuses Γ-only runs, `lsigma` without `noncolin` and `spin_component` 2 without `nspin = 2`; projwfc.x needs the wavefunctions (not `disk_io = 'nowf'`) and refuses `pawproj`/`diag_basis` for noncollinear runs.

### pp.x, plotband.x, plotrho.x

- **pp.x** (`&INPUTPP` + `&PLOT`) gets highlighting, hover, completion, Format Document, builder cards (what to extract, how to plot it) and checks from `postproc.f90` and `chdens_module.f90`: valid `plot_num` values, `spin_component` for what is plotted, `emin <= emax`, `iflag` and `output_format` both set (otherwise pp.x exits without a plot), valid output formats, the vectors `e1`/`e2`/`e3` (present, orthogonal) and `nx`/`ny` for each `iflag`, and the 3D formats for `iflag = 3`.
- **plotband.x and plotrho.x** have no namelist: they read their answers to prompts from standard input, one value per line (`plotband.x < plotband.in`). Files named `plotband.in`, `plotrho.in`, `*.plotband` or `*.plotrho` get a hover that says which prompt each line answers and checks of the sequence: the energy range, the output files (a blank PostScript name stops the program), the Fermi energy and tics, and for plotrho.x the logarithmic-scale answer and the contour levels. Other file names: pick the language *QE plotband/plotrho input* in the status bar.

## Development

```bash
npm install
npm test            # unit tests for the parser, intents and validation (vitest)
npm run smoke       # after a build: the bundled extension activates and its providers run (stubbed VS Code API)
npm run build       # bundle to dist/
npm run package     # build a .vsix
```

- **F5** in VS Code launches an Extension Development Host with `test/fixtures` open.
- `node test/harness/serve.mjs` serves the builder webview in a normal browser at http://localhost:5173/test/harness/, with the fixture INCAR standing in for VS Code. Add `?incar=INCAR.mlff_train` to load another fixture, or `?app=qe&input=fe.relax.in` for the Quantum ESPRESSO builder.

### Layout

| Path | What |
| --- | --- |
| `src/core/` | Pure TypeScript, no VS Code dependency: lossless INCAR parser/editor, tag knowledge base, intent layer, validation; KPOINTS and POSCAR parsers, formatters and hovers; POTCAR header reader; Quantum ESPRESSO input parser, tag table and checks (`qe/`) |
| `src/extension/` | VS Code glue: custom editor, language features, commands |
| `src/webview/` | React UI of the builder |
| `test/` | vitest suites, fixtures, browser harness, smoke test of the bundle |

Tag defaults follow the [VASP wiki](https://vasp.at/wiki) for VASP 6. The Quantum ESPRESSO variable table is generated from the input definitions of a QE release with `node scripts/fetch-qe-tags.mjs [qe-7.4]`. To add a tag, add a `TagDef` to `src/core/tags/definitions.ts`. The full tag list in `src/core/tags/wikiTags.generated.ts` is refreshed with `node scripts/fetch-wiki-tags.mjs`. Patch tags (VTST, VASPsol) live in `src/core/tags/known.ts`. To add a preset, add a choice to `src/core/intents/definitions.ts`; the tests check automatically that every choice is detected again after it is applied.

## Installing

In a VS Code window connected to the cluster over Remote-SSH, search for **DFTune** in the Extensions view and click *Install in SSH: …*, or install it from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=DaanHolleman.dftune). VS Code installs it on the remote host and keeps it up to date.

Without Marketplace access, download the `.vsix` from the [latest release](https://github.com/LeppertLab/DFTune/releases/latest) (or build it with `npm run package`) and run *Extensions: Install from VSIX…* in the remote window.

Releases are published by pushing a `vX.Y.Z` tag that matches `package.json`: CI attaches the `.vsix` to a GitHub Release and publishes it to the Marketplace with Trusted Publishing.

## License

MIT, see [LICENSE](LICENSE). There are two exceptions:

- The tag descriptions in `src/core/tags/wikiTags.generated.ts` are excerpts from the [VASP Wiki](https://vasp.at/wiki), © VASP Software GmbH and the VASP Wiki authors, and are distributed under the [GNU Free Documentation License 1.2](LICENSES/GFDL-1.2.txt).
- The variable descriptions in `src/core/qe/tags.generated.ts` are excerpts from the input documentation of [Quantum ESPRESSO](https://www.quantum-espresso.org), which is distributed under the [GNU General Public License, version 2 or later](LICENSES/GPL-2.0.txt); the excerpts keep that licence.
