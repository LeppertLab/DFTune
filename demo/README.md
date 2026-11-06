# DFTune demo (about 10 minutes)

Open this `demo` folder in VS Code with DFTune installed (or press **F5** in the repo and open
`demo/` in the Extension Development Host). Each folder is one part of the talk; times are rough.

Before you start: open the Problems panel (Ctrl+Shift+M) and leave it visible.

## 1. The problem (1 min) — `02-pitfalls/INCAR`

Open the file and just let people read it. It looks like a normal BaTiO3 relaxation. Ask the room
what is wrong with it. Then point at the Problems panel: DFTune found all of these, and VASP would
have run without complaint on most of them.

## 2. Checks in the plain editor (2 min) — still `02-pitfalls/INCAR`

Walk down the squiggles; each one is a different kind of check:

| Line | What DFTune says | Kind |
| --- | --- | --- |
| `ENCTU` | Unknown tag, did you mean `ENCUT`? | typo |
| second `EDIFF` | set more than once | duplicate |
| `NSW = 50` | no `IBRION`, so this is MD at 0 K, not a relaxation (plus POTIM/TEBEG warnings) | physics pitfall |
| `ISIF = 3` | Pulay stress: no `ENCUT`, because of the typo above | consequence of the typo |
| `ISMEAR = gaussian` | expected an integer | invalid value |
| `METAGGA = R2SCAN` | needs `LASPH` | functional consistency |
| `HFSCREEN` | no effect without `LHFCALC` | functional consistency |
| `LVDW` | older name of `IVDW` | renamed tag |
| `MAGMOM = 3*0.6` | 3 values, POSCAR has 5 atoms | checked against **POSCAR** |
| `LDAUL`, `LDAUU` | 2 values, POSCAR has 3 species (Ba Ti O) | checked against **POSCAR** |
| `LDAU` | set `LMAXMIX = 4` for d electrons | DFT+U pitfall |
| `KSPACING` | ignored, there is a KPOINTS file | checked against **KPOINTS** |
| `NCORE` + `NPAR` | NPAR wins | parallelization |

Also show:
- **Hover** over any tag: description, default, unit and a link to the VASP wiki.
- **Completion**: on a new line type `ALG` → `ALGO`, then after `=` the list of allowed values.
- Fix `ENCTU` → `ENCUT` and watch the Pulay warning disappear with it.

## 3. Format Document (1.5 min) — `01-pymatgen-cleanup/INCAR`

A NiO +U relaxation as pymatgen writes it: alphabetical, `True`/`.true.` mixed, two tags on one line,
no structure. Press **Alt+Shift+F**:
- tags grouped under `# Category` headers, `=` signs aligned, tag names upper case,
- `True`, `False`, `.true.` all become `.TRUE.`/`.FALSE.`,
- `ncore = 8; kpar = 2` split onto two lines; values and comments otherwise untouched.

Mention that each step can be switched off under the `dftune.format.*` settings (e.g. `T`/`F` style).

## 4. The INCAR Builder (3 min) — `03-builder/INCAR`, then back to `01-pymatgen-cleanup/INCAR`

Open `03-builder/INCAR` and click the **gear** in the editor title bar. Put the builder and the text
side by side (drag the tab).

1. *Setup* cards read the file back: Single point, PBE, non-magnetic, Gaussian. Nobody told it that;
   it is inferred from the tags.
2. Click **Relax ions + cell**: `IBRION`, `ISIF`, `NSW`, `EDIFFG` appear in the text. The comments,
   the alignment and the `# Parallelization` block are untouched.
3. Click **HSE06**, then **DFT-D3 (BJ)**: watch the tags each choice writes.
4. Type in the text editor, e.g. change `ISMEAR = 0` to `ISMEAR = -5`. The builder follows, and
   the *tetrahedron with forces* warning appears in its checks panel.
5. **Ctrl+Z** a few times: undo goes through the normal editor history.
6. Run `git diff demo/03-builder/INCAR` to show it is a minimal text diff, not a rewritten file.
   (`git checkout demo/03-builder/INCAR` to reset.)
7. *All tags* tab: typed fields with defaults and units; unknown tags stay editable as text.

Then open the builder on `01-pymatgen-cleanup/INCAR`: it is recognised as *Relax ions + cell*,
*Spin-polarized*, and the **DFT+U card** shows U per species (Ni, O) taken from the POSCAR.

## 5. Files that belong together (1.5 min) — `04-band-structure/`

The usual SCF → bands → DOS workflow in one folder. DFTune pairs `INCAR.bands` with
`KPOINTS.bands`, `INCAR.dos` with `KPOINTS.dos`, and falls back to the shared `POSCAR`.

- `INCAR.scf`: clean.
- `INCAR.bands`: warning that the KPOINTS file is in line mode but `ICHARG = 11` is missing (it was
  copied from the SCF input). Add `ICHARG = 11` and the warning goes.
- `INCAR.dos`: tetrahedron smearing (`ISMEAR = -5`) with a Monkhorst–Pack mesh in `KPOINTS.dos`.
  Change `Monkhorst-Pack` to `Gamma` in `KPOINTS.dos`: the INCAR warning clears without touching
  the INCAR, because DFTune watches the neighbouring files.

## 6. MD and machine-learned force fields (1 min) — `05-md-mlff/`

- `INCAR.train`: open the builder, *Calculation* shows *MLFF on-the-fly training* with the NpT
  settings. Problems: `LANGEVIN_GAMMA` has 4 values but the POSCAR has 3 species (Cs Pb I).
- `INCAR.run`: production MD that forgot `TEBEG` (so it would run at 0 K), and a hint that
  `LREAL = Auto` is much faster for this 40-atom cell.

## 7. Starting from nothing (30 s) — `06-new-calculation/`

Right-click the folder → **New VASP Calculation…**, pick a few options, get a commented INCAR.

## Closing points

- The text file stays the source of truth: the builder only makes minimal edits, so it is safe to
  use on files you share with colleagues or keep in git.
- Runs on the cluster over Remote-SSH, no internet needed on the compute side.
- Knows all ~600 tags on the VASP wiki plus VTST and VASPsol tags.
