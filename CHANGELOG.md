# Changelog

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
