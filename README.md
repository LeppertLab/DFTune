# DFTune

A VS Code extension for setting up DFT calculations by **physical intent** (calculation type, functional, magnetism, smearing, accuracy, DFT+U) instead of remembering tags and magic numbers. It currently supports VASP INCAR files; Quantum ESPRESSO is planned.

It is built for the usual HPC workflow: VS Code connected to a cluster with **Remote-SSH**. The extension runs on the cluster (`extensionKind: workspace`) and edits the INCAR in place, so no files are copied back and forth. The builder UI is bundled locally and needs no internet access.

## Features

- **INCAR Builder** (open an INCAR, then click the gear in the editor title bar or run *VASP: Open INCAR Builder*)
  - *Setup* cards: pick "Relax ions + cell", "Phonons (finite differences)", "HSE06", "Spin-polarized"… and see which tags that writes. Calculation types: single point, relaxations, DOS/bands, phonons (finite differences or DFPT), elastic constants, dielectric tensor, optics, MD (NVT/NpT) and MLFF training/production. The current INCAR is read back into these choices; anything that doesn't fit a preset shows up as *Custom* and is never overwritten silently.
  - *All tags*: about 100 common tags with typed fields, defaults, units, descriptions and VASP wiki links. Every other tag is kept and remains editable as raw text, with its description from the VASP wiki.
  - DFT+U table per species, read from the neighbouring POSCAR.
  - Live checks (see below).
- **The INCAR text stays the source of truth.** The builder applies minimal text edits, so comments, alignment, tag order and unknown tags survive. Undo/redo, git diffs and the plain text editor all stay in sync, and typing in the text updates the builder.
- **Plain-text support** for people who prefer the editor: syntax highlighting, hover docs, completion of tags and values, and diagnostics in the Problems panel.
- **Format Document** (Alt+Shift+F) tidies an INCAR, e.g. one written by pymatgen: one statement per line, tag names in upper case, tags grouped by category under `# Category` headers, `=` signs and trailing comments aligned. Values and comments are kept exactly; hand-written section headings on the same topic replace the default headers. It refuses to run while the file has syntax problems. Each step can be switched off in the settings (`dftune.format.*`).
- **New VASP Calculation…** (right-click a folder): answer a few quick picks and get a commented INCAR.

### Checks

Typos (`ENCTU` → did you mean `ENCUT`?), tags VASP doesn't know (it silently ignores them), deprecated and renamed tags, invalid values, duplicates, and physics/setup pitfalls such as:
`NSW > 0` without `IBRION` (silently runs MD), MD without `POTIM`/`TEBEG`, tetrahedron smearing with forces, Methfessel–Paxton by default, Pulay stress in cell relaxations, meta-GGA without `LASPH`, hybrid parameters without `LHFCALC`, `MAGMOM` length vs. atom count (×3 if noncollinear), per-species arrays (`LDAUU`, `LANGEVIN_GAMMA`) vs. POSCAR species, `LMAXMIX` for d/f +U, `ICHARG = 11` with ionic steps, `NCORE` and `NPAR` both set, and `LREAL` for large cells.

With a KPOINTS file it also checks: `KSPACING` ignored because KPOINTS exists, no KPOINTS and no `KSPACING` (default mesh), line-mode KPOINTS without `ICHARG = 11`, and tetrahedron smearing with a Monkhorst–Pack mesh or fewer than 4 k points.

POSCAR and KPOINTS are found next to the INCAR (`POSCAR.relax` for `INCAR.relax`, otherwise `POSCAR`; likewise for KPOINTS).

Known tags are the ~600 INCAR tags on the VASP wiki (including numbered families such as `LIBXC1_Pn` and grouped tags such as `KERNEL_TRUNCATION/LTRUNCATE`), their wiki redirects (older names such as `ML_FF_*`), and the tags of the VTST and VASPsol patches.

## Development

```bash
npm install
npm test            # unit tests for the parser, intents and validation (vitest)
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

## Installing on a cluster

Download the `.vsix` from the [latest release](https://github.com/LeppertLab/dftune/releases/latest), or build it yourself (`npm run package`). Then, in a VS Code window connected over Remote-SSH, run *Extensions: Install from VSIX…*. VS Code installs it on the remote host.

## License

MIT, see [LICENSE](LICENSE). The exception is the tag descriptions in `src/core/tags/wikiTags.generated.ts`: they are excerpts from the [VASP Wiki](https://vasp.at/wiki), © VASP Software GmbH and the VASP Wiki authors, and are distributed under the [GNU Free Documentation License 1.2](LICENSES/GFDL-1.2.txt).
