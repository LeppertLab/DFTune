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
    const entry = { version: doc.version, generation: this.generation, result };
    this.entries.set(key, entry);
    // A failed lint (say a transient file-system error) must not stay cached: the next request tries again.
    result.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return result;
  }

  /**
   * Lints `doc` and passes the result to `use` once it is current: not after an edit (a refresh for
   * the new text is scheduled by the edit itself), and run again when a neighbouring file changed
   * while it was being computed. Errors are swallowed: the diagnostics just stay as they were.
   */
  async whenCurrent(doc: vscode.TextDocument, use: (diagnostics: Diagnostic[]) => void) {
    const version = doc.version;
    for (let attempt = 0; attempt < 3; attempt++) {
      const generation = this.generation;
      let diagnostics: Diagnostic[];
      try {
        diagnostics = await this.get(doc);
      } catch {
        return;
      }
      if (doc.isClosed || doc.version !== version) return;
      if (this.generation === generation) return use(diagnostics);
    }
  }

  /** A neighbouring file changed: everything must be linted again. */
  invalidate() {
    this.generation++;
  }

  delete(uri: vscode.Uri) {
    this.entries.delete(uri.toString());
  }
}
