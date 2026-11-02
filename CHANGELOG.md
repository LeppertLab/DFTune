# Changelog

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
