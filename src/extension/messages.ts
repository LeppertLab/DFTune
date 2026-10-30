// Messages between the extension host and the builder webview.
// The INCAR text is the single source of truth: the webview never edits it directly,
// it asks the extension to apply tag changes, and then receives the new text.

import type { PoscarInfo, TagChanges } from '../core';

export type ToWebview = {
  type: 'update';
  text: string;
  fileName: string;
  poscar?: PoscarInfo & { fileName: string };
};

export type FromWebview =
  | { type: 'ready' }
  | { type: 'setTags'; changes: TagChanges; label?: string }
  | { type: 'reveal'; offset: number; end?: number };
