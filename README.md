<p align="center"><img src="images/icon.png" alt="DFTune logo" width="128"></p>

# DFTune

**Input files for first-principles codes, checked, formatted and built from inside VS Code.** DFTune reads your VASP, Quantum ESPRESSO, BerkeleyGW, CASTEP, ABINIT and MolGW input files the way each code does, tells you what is wrong before the job spends a day in the queue, tidies the files, and lets you set a calculation up by what you want to do instead of by tag names. A 3D viewer shows the structure next to the text.

It is built for working on a cluster through **Remote-SSH**: the extension runs on the cluster and edits your files in place, and nothing needs internet access.

## What it does

**It catches mistakes the codes don't.** The checks run as you type, and each one comes from the code's documentation or source. Some examples:

- VASP silently ignores a mistyped tag: `ENCTU` is flagged (*did you mean `ENCUT`?*), and so is the missing `ENCUT` it causes. `NSW = 50` without `IBRION` is not a relaxation but MD at 0 K. `MAGMOM` with 3 values for a 5-atom POSCAR, `LDAUU` with 2 values for 3 species, a POTCAR in a different element order than the POSCAR, `METAGGA = R2SCAN` without `LASPH`.
- Quantum ESPRESSO stops on unknown variables, so a misplaced `ecutrho` in `&CONTROL` is an error with its namelist named, `ibrav` is checked against `CELL_PARAMETERS`, and a `ph.x`, `dos.x` or `projwfc.x` input is compared with the `pw.x` run it continues (prefix, `outdir`, spin, k-point type).
- BerkeleyGW is strict about its input: an indented keyword or a comment inside a block stops it. DFTune flags those, a Hartree–Fock run without a q→0 point, and across files a `screened_coulomb_cutoff` above the `epsilon_cutoff` or a `frequency_dependence` that doesn't fit the dielectric matrix.

Errors are kept for what makes the code stop; anything softer is a warning. On the 119 inputs of BerkeleyGW's own testsuite the BerkeleyGW rules raise nothing except keywords that BerkeleyGW 4.0 itself no longer accepts.

**It builds a calculation by intent.** Open the builder next to the text: pick *Relax ions + cell*, *HSE06*, *Spin-polarized* or *DFT-D3*, and see which tags that writes. The builder reads the file back, so an existing INCAR shows up as "single point, PBE, Gaussian smearing". Every tag, variable or keyword also has a typed field with its documentation. The text file stays the source of truth: every change is a minimal edit, so comments, layout, undo and git diffs survive.

**It tidies files.** *Format Document* (Alt+Shift+F) groups an INCAR in sections (Calculation, Electronic structure, Exchange–correlation, Magnetism, …) with aligned values, and the builder uses the same sections. It cleans up a pymatgen-written INCAR, aligns KPOINTS and POSCAR coordinates, and formats QE namelists and cards. Values and comments are kept.

**It explains and completes.** Hover a tag for its description, default, unit and allowed values (for `KSPACING`, also the mesh it gives for your POSCAR); completion offers tags and values; quick fixes repair typos, quoting and renamed tags.

**It compares files that belong together.** In one folder, an INCAR is checked against its POSCAR, KPOINTS and POTCAR; ph.x, dos.x and projwfc.x against their pw.x input; sigma against epsilon (cutoffs, frequency dependence), absorption against kernel (bands, symmetry flags).

**It shows the structure.** The structure viewer draws a POSCAR, CONTCAR or pw.x input in 3D with bonds, the unit cell and supercells. Click an atom to jump to its line; edit the line and the view follows.

**It writes the boring parts.** *New VASP Calculation…* asks a few questions and writes the INCAR (and KPOINTS); *Generate k-point Mesh…* picks a mesh for a k-point spacing; POSCAR and pw.x inputs convert into each other.

## What it supports

| Code | Files | Highlights |
| --- | --- | --- |
| **VASP** | INCAR, KPOINTS, POSCAR/CONTCAR, POTCAR (headers only) | ~600 known INCAR tags from the VASP wiki, 100 with typed fields; physics checks; the builder with presets for calculation type, functional, magnetism, smearing, van der Waals, accuracy and DFT+U |
| **Quantum ESPRESSO** | pw.x, ph.x, dos.x, projwfc.x, bands.x, pp.x, plotband.x, plotrho.x, pw2bgw.x | variable tables of QE 7.4; the cell built the way QE builds it; pseudopotential files read; builders for the namelist programs |
| **BerkeleyGW** | epsilon, sigma, kernel, absorption, inteqp | all 332 keywords of BerkeleyGW 4.0; checks that follow the Fortran readers; a keyword builder; checks across the workflow files |
| **CASTEP** | `.cell` and `.param` | the documented keywords and blocks; block rows checked; the cell and param files of one seed compared |
| **ABINIT** | `.abi` | 1056 documented variables; multi-dataset aware checks of `natom`, `typat`, `znucl`, `xred` and the k-point variables; checked on 1339 test-suite inputs |
| **MolGW** | `molgw.in` | 249 variables of MolGW 3.4; value checks that follow its namelist reader; the atoms checked against `natom` or the `xyz_file` |

See [docs/features.md](docs/features.md) for every feature and check per file type.

## Installing

In a VS Code window connected to the cluster, search for **DFTune** in the Extensions view and click *Install in SSH: …*, or install it from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=DaanHolleman.dftune). VS Code installs it on the cluster and keeps it up to date.

Without Marketplace access, download the `.vsix` from the [latest release](https://github.com/LeppertLab/DFTune/releases/latest) and run *Extensions: Install from VSIX…* in the remote window.

## Development

```bash
npm install
npm test         # unit tests (vitest)
npm run build    # bundle to dist/
npm run smoke    # after a build: the bundled extension activates (stubbed VS Code API)
npm run package  # build a .vsix
```

**F5** opens an Extension Development Host with `test/fixtures`; `node test/harness/serve.mjs` serves the builders in a browser at http://localhost:5173/test/harness/. Domain logic lives in `src/core/` (no VS Code dependency), the VS Code glue in `src/extension/`, the builders in `src/webview/`.

To release, push a `vX.Y.Z` tag that matches `package.json`: CI attaches the `.vsix` to a GitHub Release and publishes it to the Marketplace.

## License

MIT, see [LICENSE](LICENSE). There are six exceptions:

- The tag descriptions in `src/core/tags/wikiTags.generated.ts` are excerpts from the [VASP Wiki](https://vasp.at/wiki), © VASP Software GmbH and the VASP Wiki authors, and are distributed under the [GNU Free Documentation License 1.2](LICENSES/GFDL-1.2.txt).
- The keyword descriptions in `src/core/bgw/keywords.generated.ts` and the testsuite inputs in `test/fixtures/bgw` are from the documentation and testsuite of [BerkeleyGW](https://berkeleygw.org), distributed under a [modified BSD license](LICENSES/BerkeleyGW.txt), whose notice they keep.
- The variable descriptions in `src/core/qe/tags.generated.ts` are excerpts from the input documentation of [Quantum ESPRESSO](https://www.quantum-espresso.org), which is distributed under the [GNU General Public License, version 2 or later](LICENSES/GPL-2.0.txt); the excerpts keep that licence.
- The keyword names, types, defaults and allowed values in `src/core/castep/keywords.generated.ts` come from the [CASTEP community documentation](https://castep-docs.github.io/castep-docs/), © its authors (the phonon pages: Science and Technology Facilities Council, 2009). That repository declares no licence, so no descriptions are included; see [LICENSES/CASTEP-docs.txt](LICENSES/CASTEP-docs.txt).
- The variable descriptions in `src/core/abinit/variables.generated.ts` are excerpts from the documentation of [ABINIT](https://www.abinit.org) (`abimkdocs/variables_abinit.py`), which is free software distributed under the [GNU General Public License, version 3](LICENSES/ABINIT-GPL-3.0.txt); the excerpts keep that licence. The inputs in `test/fixtures/abinit` are copied from the ABINIT test suite under the same licence.
- The keyword names, defaults and descriptions in `src/core/molgw/keywords.generated.ts` are derived from the source of [MolGW](https://github.com/molgw/molgw) (Copyright (C) 2010-2026 Fabien Bruneval), and the inputs in `test/fixtures/molgw` are copied from its testsuite. MolGW is free software distributed under the [GNU General Public License](LICENSES/GPL-3.0.txt), version 3 or (at your option) any later version, without any warranty; those files are distributed under the same terms and keep that notice.
