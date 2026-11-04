// Messages between the extension host and the builder webview.
// The INCAR text is the single source of truth: the webview never edits it directly,
// it asks the extension to apply tag changes, and then receives the new text.

import type { KpointsInfo, PoscarInfo, PotcarEntry, PseudoFile, QeChange, TagChanges, TextEdit } from '../core';

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

export type FromWebview =
  | { type: 'ready' }
  | { type: 'setTags'; changes: TagChanges; label?: string }
  | { type: 'qeSet'; changes: QeChange[] }
  | { type: 'reveal'; offset: number; end?: number }
  /** A quick fix, computed by the webview on the text it last received. */
  | { type: 'applyEdit'; edit: TextEdit; text: string };
