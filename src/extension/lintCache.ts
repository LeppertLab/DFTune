// Diagnostics per document version, shared by the Problems-panel refresh and the quick fixes.
// Linting can await slow reads of neighbouring files (POSCAR, POTCAR on a cluster file system),
// so results are tagged with the document version and a generation that changes whenever a
// neighbour changes on disk; a result that is no longer current is never shown.

import type * as vscode from 'vscode';
import type { Diagnostic } from '../core';

export class LintCache {
  private readonly entries = new Map<string, { version: number; generation: number; result: Promise<Diagnostic[]> }>();
  private generation = 0;

  constructor(private readonly lint: (doc: vscode.TextDocument) => Promise<Diagnostic[]>) {}

  /** The diagnostics of the current text and neighbours, computed once per version. */
  get(doc: vscode.TextDocument): Promise<Diagnostic[]> {
    const key = doc.uri.toString();
    const hit = this.entries.get(key);
    if (hit && hit.version === doc.version && hit.generation === this.generation) return hit.result;
    const result = this.lint(doc);
    this.entries.set(key, { version: doc.version, generation: this.generation, result });
    return result;
  }

  /**
   * Lints `doc` and passes the result to `use` only if it is still current when it arrives (no
   * edit and no neighbour change in the meantime).
   */
  async whenCurrent(doc: vscode.TextDocument, use: (diagnostics: Diagnostic[]) => void) {
    const version = doc.version;
    const generation = this.generation;
    const diagnostics = await this.get(doc);
    if (!doc.isClosed && doc.version === version && this.generation === generation) use(diagnostics);
  }

  /** A neighbouring file changed: everything must be linted again. */
  invalidate() {
    this.generation++;
  }

  delete(uri: vscode.Uri) {
    this.entries.delete(uri.toString());
  }
}
