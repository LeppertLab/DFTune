<p align="center"><img src="images/icon.png" alt="DFTune logo" width="128"></p>

# DFTune

A VS Code extension for setting up DFT calculations by **physical intent** (calculation type, functional, magnetism, smearing, accuracy, DFT+U) instead of remembering tags and magic numbers. It currently supports VASP: an INCAR builder, plus checks, hovers and formatting for INCAR, KPOINTS and POSCAR files; Quantum ESPRESSO is planned.

It is built for the usual HPC workflow: VS Code connected to a cluster with **Remote-SSH**. The extension runs on the cluster (`extensionKind: workspace`) and edits the INCAR in place, so no files are copied back and forth. The builder UI is bundled locally and needs no internet access.

## Features

- **INCAR Builder** (open an INCAR, then click the gear in the editor title bar or run *VASP: Open INCAR Builder*)
  - *Setup* cards: pick "Relax ions + cell", "Phonons (finite differences)", "HSE06", "Spin-polarized"… and see which tags that writes. Calculation types: single point, relaxations, DOS/bands, phonons (finite differences or DFPT), elastic constants, dielectric tensor, optics, MD (NVT/NpT) and MLFF training/production. The current INCAR is read back into these choices; anything that doesn't fit a preset shows up as *Custom* and is never overwritten silently.
  - *All tags*: about 100 common tags with typed fields, defaults, units, descriptions and VASP wiki links. Every other tag is kept and remains editable as raw text, with its description from the VASP wiki.
  - DFT+U table per species, read from the neighbouring POSCAR.
  - Live checks (see below).
- **The INCAR text stays the source of truth.** The builder applies minimal text edits, so comments, alignment, tag order and unknown tags survive. Undo/redo, git diffs and the plain text editor all stay in sync, and typing in the text updates the builder.
- **Plain-text support** for people who prefer the editor: syntax highlighting, hover docs, completion of tags and values, and diagnostics in the Problems panel.
- **Format Document** (Alt+Shift+F) tidies an INCAR, e.g. one written by pymatgen: one statement per line, tag names in upper case, tags grouped by category under `# Category` headers, `=` signs and trailing comments aligned, and logical values spelled one way (`.TRUE.`/`.FALSE.` or `T`/`F`). Other values and all comments are kept exactly; hand-written section headings on the same topic replace the default headers. It refuses to run while the file has syntax problems. Each step can be switched off in the settings (`dftune.format.*`).
- **KPOINTS files** (`KPOINTS`, `KPOINTS.*`, `KPOINTS_*`, `*.kpoints`) get syntax highlighting, checks in the Problems panel and Format Document. The checks read the file the way VASP does, by line position, and flag what it cannot read: a missing or non-numeric count, subdivisions or coordinates, a file that ends before the announced k points, line-mode points that don't come in pairs, tetrahedron corners outside the k-point list. Softer notes: an even Monkhorst–Pack mesh (no Γ), a mode word VASP reads as generating vectors, all-zero weights, text VASP ignores. Format Document only changes whitespace: mode words get one spelling (`gamma` → `Gamma`), k points and vectors are lined up on the decimal point with their labels in one column, and line-mode segments are separated by one blank line. Numbers are copied as written, and it refuses to run while the file has errors.
- **POSCAR and CONTCAR files** (also `POSCAR.*`, `CONTCAR.*`, `*.vasp`) get highlighting, checks, hovers and Format Document. Checks: unreadable numbers, a zero or invalid scaling factor, a flat or left-handed cell, element names that don't match the atom counts or aren't elements, missing atoms, selective-dynamics flags that aren't T/F, atoms closer than 0.5 Å (also across the cell boundary), and Direct/Cartesian mix-ups (fractional coordinates of 3.5, or Cartesian ones that all fit in 1 Å). Hover over a position for the atom's number, element and coordinates in the other system (and which directions selective dynamics frees); over the lattice for lengths and angles; over a count for the atom range of that element; over the scale for the cell volume. Format Document lines up the lattice and the positions on the decimal point, puts element names above their counts, and spells `Direct`/`Cartesian`/`Selective dynamics` one way, keeping every number as written and CONTCAR velocities untouched.
- **New VASP Calculation…** (right-click a folder): answer a few quick picks and get a commented INCAR. The last pick sets up the k points: a Γ-centred KPOINTS for the POSCAR in the folder, or `KSPACING` in the INCAR, at a density you choose (each option shows the mesh it gives).
- **Generate KPOINTS Mesh…** (right-click a folder, POSCAR, INCAR or KPOINTS, or from the editor's context menu): writes a Γ-centred KPOINTS for the POSCAR at a chosen k-point spacing; for `INCAR.relax` it writes `KPOINTS.relax`. It asks before replacing a file.
- **Quick fixes** (lightbulb, Ctrl+.) for problems with an obvious remedy: a misspelled or renamed tag, `LASPH` for meta-GGAs, `LMAXMIX` for +U, `ENCUT` from the POTCAR, Gaussian smearing instead of the default or tetrahedra with forces, `IBRION` for `NSW > 0`, removing `NPAR` next to `NCORE` or an ignored `KSPACING`, Gamma instead of Monkhorst–Pack, a balanced k-point mesh, Direct/Cartesian. The builder shows the same fixes as buttons next to each problem.

### Checks

Typos (`ENCTU` → did you mean `ENCUT`?), tags VASP doesn't know (it silently ignores them), deprecated and renamed tags, invalid values, duplicates, and physics/setup pitfalls such as:
`NSW > 0` without `IBRION` (silently runs MD), MD without `POTIM`/`TEBEG`, tetrahedron smearing with forces, Methfessel–Paxton by default, Pulay stress in cell relaxations, meta-GGA without `LASPH`, hybrid parameters without `LHFCALC`, `MAGMOM` length vs. atom count (×3 if noncollinear), per-species arrays (`LDAUU`, `LANGEVIN_GAMMA`) vs. POSCAR species, `LMAXMIX` for d/f +U, `ICHARG = 11` with ionic steps, `NCORE` and `NPAR` both set, and `LREAL` for large cells.

With a KPOINTS file it also checks: `KSPACING` ignored because KPOINTS exists, no KPOINTS and no `KSPACING` (default mesh), line-mode KPOINTS without `ICHARG = 11`, and tetrahedron smearing with a Monkhorst–Pack mesh or fewer than 4 k points.

With a POTCAR (only its header lines are read): the elements and their order against the POSCAR (a POTCAR in the wrong order runs without complaint and silently uses the wrong potentials), `ENCUT` below the largest `ENMAX`, and a concrete cutoff (1.3 × `ENMAX`) for cell relaxations. With a POSCAR: machine-learned force fields (`ML_LMLFF`) with the same element name used for two species groups. Hovering `KSPACING` shows the mesh it gives for the POSCAR, and the builder header lists the POTCARs and that mesh.

KPOINTS is also checked against the POSCAR: an even Monkhorst–Pack mesh on a hexagonal cell, and a mesh that is much finer in one direction than in the others (e.g. 8 × 8 × 8 for a slab). Hovering a KPOINTS line explains it; on the mesh line you also get the number of k points, the spacing in Å⁻¹ and the equivalent `KSPACING`; on a fully automatic length, the mesh it gives.

The files of one calculation are found in the same folder: `POSCAR.relax` for `INCAR.relax` (or `KPOINTS.relax`), otherwise `POSCAR`; likewise for KPOINTS and POTCAR. They are rechecked when one of them changes on disk.

Known tags are the ~600 INCAR tags on the VASP wiki (including numbered families such as `LIBXC1_Pn` and grouped tags such as `KERNEL_TRUNCATION/LTRUNCATE`), their wiki redirects (older names such as `ML_FF_*`), and the tags of the VTST and VASPsol patches.

## Development

```bash
npm install
npm test            # unit tests for the parser, intents and validation (vitest)
npm run smoke       # after a build: the bundled extension activates and its providers run (stubbed VS Code API)
npm run build       # bundle to dist/
npm run package     # build a .vsix
```

- **F5** in VS Code launches an Extension Development Host with `test/fixtures` open.
- `node test/harness/serve.mjs` serves the builder webview in a normal browser at http://localhost:5173/test/harness/, with the fixture INCAR standing in for VS Code. Add `?incar=INCAR.mlff_train` to load another fixture.

### Layout

| Path | What |
| --- | --- |
| `src/core/` | Pure TypeScript, no VS Code dependency: lossless INCAR parser/editor, tag knowledge base, intent layer, validation, POSCAR reader |
| `src/extension/` | VS Code glue: custom editor, language features, commands |
| `src/webview/` | React UI of the builder |
| `test/` | vitest suites, fixtures, browser harness |

Tag defaults follow the [VASP wiki](https://vasp.at/wiki) for VASP 6. To add a tag, add a `TagDef` to `src/core/tags/definitions.ts`. The full tag list in `src/core/tags/wikiTags.generated.ts` is refreshed with `node scripts/fetch-wiki-tags.mjs`. Patch tags (VTST, VASPsol) live in `src/core/tags/known.ts`. To add a preset, add a choice to `src/core/intents/definitions.ts`; the tests check automatically that every choice is detected again after it is applied.

## Installing

In a VS Code window connected to the cluster over Remote-SSH, search for **DFTune** in the Extensions view and click *Install in SSH: …*, or install it from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=DaanHolleman.dftune). VS Code installs it on the remote host and keeps it up to date.

Without Marketplace access, download the `.vsix` from the [latest release](https://github.com/LeppertLab/DFTune/releases/latest) (or build it with `npm run package`) and run *Extensions: Install from VSIX…* in the remote window.

Releases are published by pushing a `vX.Y.Z` tag that matches `package.json`: CI attaches the `.vsix` to a GitHub Release and publishes it to the Marketplace with Trusted Publishing.

## License

MIT, see [LICENSE](LICENSE). The exception is the tag descriptions in `src/core/tags/wikiTags.generated.ts`: they are excerpts from the [VASP Wiki](https://vasp.at/wiki), © VASP Software GmbH and the VASP Wiki authors, and are distributed under the [GNU Free Documentation License 1.2](LICENSES/GFDL-1.2.txt).
