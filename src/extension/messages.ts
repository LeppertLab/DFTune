// Messages between the extension host and the builder webview.
// The INCAR text is the single source of truth: the webview never edits it directly,
// it asks the extension to apply tag changes, and then receives the new text.

import type { BgwChange, KpointsInfo, PoscarInfo, PotcarEntry, PseudoFile, QeChange, StructureFormat, TagChanges, TextEdit } from '../core';

export type ToWebview = {
  type: 'update';
  text: string;
  fileName: string;
  poscar?: PoscarInfo & { fileName: string };
  /** null: there is no KPOINTS file next to the INCAR. */
  kpoints: (KpointsInfo & { fileName: string }) | null;
  /** Headers of the POTCAR next to the INCAR. */
  potcar?: { fileName: string; entries: PotcarEntry[] };
};

/** The Quantum ESPRESSO builder: the input text and what was found next to it. */
export type ToWebviewQe = {
  type: 'update-qe';
  text: string;
  fileName: string;
  /** Pseudopotential files named in ATOMIC_SPECIES, as found on disk; undefined when there is nowhere to look. */
  pseudos?: [string, PseudoFile][];
};

/** The structure viewer: the file's text (the webview reads the structure itself), and the text cursor. */
export type ToWebviewStructure =
  | {
      type: 'update-structure';
      text: string;
      fileName: string;
      format: StructureFormat;
      /** Species from the POTCAR next to a VASP 4 POSCAR, which names none itself. */
      speciesHint?: string[];
    }
  /** The cursor moved in the text editor: the viewer centres rotation on the atom of that line. */
  | { type: 'select-structure'; offset: number };

/** The BerkeleyGW builder: the input text (the program is found from the file name and keywords). */
export type ToWebviewBgw = {
  type: 'update-bgw';
  text: string;
  fileName: string;
  /** The inputs of the same workflow found in the folder, for the cross-file checks. */
  neighbors?: { program: string; fileName: string; text: string }[];
};

export type FromWebview =
  | { type: 'ready' }
  | { type: 'setTags'; changes: TagChanges; label?: string }
  | { type: 'qeSet'; changes: QeChange[] }
  | { type: 'bgwSet'; changes: BgwChange[] }
  | { type: 'reveal'; offset: number; end?: number }
  /** A quick fix, computed by the webview on the text it last received. */
  | { type: 'applyEdit'; edit: TextEdit; text: string };
