<p align="center"><img src="images/icon.png" alt="DFTune logo" width="128"></p>

# DFTune

A VS Code extension for setting up DFT calculations by **physical intent** (calculation type, functional, magnetism, smearing, accuracy, DFT+U) instead of remembering tags and magic numbers, and for catching the mistakes the codes don't complain about, or only complain about after a day in the queue.

It is built for working on a cluster through **Remote-SSH**: the extension runs on the cluster and edits your files in place, and its builders need no internet access.

## What it supports

| Code | Files |
| --- | --- |
| **VASP** | INCAR, KPOINTS, POSCAR/CONTCAR, POTCAR (headers only) |
| **Quantum ESPRESSO** | pw.x, ph.x, dos.x, projwfc.x, bands.x, pp.x, plotband.x, plotrho.x, pw2bgw.x |
| **BerkeleyGW** | epsilon, sigma, kernel, absorption, inteqp |

For each of these:

- **Builders**: pick "Relax ions + cell", "HSE06" or "Spin-polarized" and see which tags that writes, or edit any tag in a typed field with its documentation. The text file stays the source of truth: edits are minimal, so comments, layout and undo survive.
- **Checks** as you type, taken from each code's documentation and source: typos, unknown or misplaced tags, invalid values, and physics pitfalls such as `NSW` without `IBRION` or a POTCAR in the wrong order. Errors are reserved for what makes the code stop.
- **Hover, completion and quick fixes** for tags and their values.
- **Format Document** (Alt+Shift+F): tags grouped and aligned, with values and comments kept.
- **Cross-file checks**: the files of one calculation in the same folder are compared, e.g. INCAR against POSCAR and POTCAR, or ph.x against its pw.x run.
- **Commands**: *New VASP Calculation…*, *Generate k-point Mesh…*, and conversion between POSCAR and pw.x inputs.

See [docs/features.md](docs/features.md) for the full list of features and checks per file type.

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

MIT, see [LICENSE](LICENSE). There are three exceptions:

- The tag descriptions in `src/core/tags/wikiTags.generated.ts` are excerpts from the [VASP Wiki](https://vasp.at/wiki), © VASP Software GmbH and the VASP Wiki authors, and are distributed under the [GNU Free Documentation License 1.2](LICENSES/GFDL-1.2.txt).
- The keyword descriptions in `src/core/bgw/keywords.generated.ts` and the testsuite inputs in `test/fixtures/bgw` are from the documentation and testsuite of [BerkeleyGW](https://berkeleygw.org), distributed under a [modified BSD license](LICENSES/BerkeleyGW.txt), whose notice they keep.
- The variable descriptions in `src/core/qe/tags.generated.ts` are excerpts from the input documentation of [Quantum ESPRESSO](https://www.quantum-espresso.org), which is distributed under the [GNU General Public License, version 2 or later](LICENSES/GPL-2.0.txt); the excerpts keep that licence.
