// Plain-text support for the positional input files (KPOINTS, POSCAR/CONTCAR): diagnostics in
// the Problems panel, Format Document and hovers. Both are checked against their neighbours:
// KPOINTS against the POSCAR (cell), POSCAR against the POTCAR (elements).

import * as vscode from 'vscode';
import {
  cardsOf,
  detectProgram,
  formatKpoints,
  formatPoscar,
  formatQe,
  kpointsHover,
  lintKpoints,
  lintPoscar,
  minimalEdit,
  parsePoscar,
  parseQe,
  poscarHover,
  qeCompletions,
  qeHover,
  validateQe,
  type Diagnostic,
  type QeCompletion,
  type QeProgram,
} from '../core';
import { FolderWatch, findPoscar, findPotcar } from './inputs';
import { toVscodeDiagnostics } from './language';
import { LintCache } from './lintCache';
import { registerQuickFixes } from './quickFixes';

type HoverResult = { markdown: string; start: number; end: number } | undefined;

interface InputLanguage {
  id: string;
  /** Shown as the diagnostics' source and in messages. */
  label: string;
  lint: (text: string, uri: vscode.Uri) => Promise<Diagnostic[]>;
  /** Not every language has a formatter yet. */
  format?: (text: string) => string | undefined;
  hover: (text: string, offset: number, uri: vscode.Uri) => Promise<HoverResult>;
  complete?: (text: string, offset: number) => QeCompletion[];
  /** Characters that start a completion. */
  triggers?: string[];
}

/** Programs whose inputs are checked in depth; for the others only the syntax is. */
const QE_CHECKED: QeProgram[] = ['pw'];

function lintQe(text: string): Diagnostic[] {
  const program = detectProgram(text);
  const doc = parseQe(text, { cards: program ? cardsOf(program) : [] });
  return program && QE_CHECKED.includes(program) ? validateQe(doc, program) : doc.issues;
}

/** The cell of the POSCAR next to `uri`, when it could be read completely. */
async function cellNear(uri: vscode.Uri) {
  const info = (await findPoscar(uri))?.info;
  return info?.lattice && info.volume ? { lattice: info.lattice, volume: info.volume } : undefined;
}

const LANGUAGES: InputLanguage[] = [
  {
    id: 'qe',
    label: 'QE',
    lint: async (text) => lintQe(text),
    format: formatQe,
    hover: async (text, offset) => {
      const program = detectProgram(text);
      return program ? qeHover(parseQe(text, { cards: cardsOf(program) }), program, offset) : undefined;
    },
    complete: (text, offset) => {
      const program = detectProgram(text) ?? 'pw';
      return qeCompletions(parseQe(text, { cards: cardsOf(program) }), program, offset);
    },
    triggers: ['=', ' ', '&', ','],
  },
  {
    id: 'kpoints',
    label: 'KPOINTS',
    lint: async (text, uri) => lintKpoints(text, await cellNear(uri)),
    format: formatKpoints,
    hover: async (text, offset, uri) => kpointsHover(text, offset, await cellNear(uri)),
  },
  {
    id: 'poscar',
    label: 'POSCAR',
    lint: async (text, uri) => lintPoscar(text, (await findPotcar(uri))?.info),
    format: formatPoscar,
    hover: async (text, offset) => poscarHover(parsePoscar(text, { distances: false }), offset),
  },
];

export function registerInputLanguages(context: vscode.ExtensionContext) {
  for (const lang of LANGUAGES) register(context, lang);
  registerQeDetection(context);
}

/**
 * QE inputs have no fixed file name (scf.in, relax.in, my_run.pwi …). A plain-text file that
 * starts with a QE namelist is switched to the QE language, so the checks and hovers apply.
 */
function registerQeDetection(context: vscode.ExtensionContext) {
  const NAME = /\.(in|inp|pwi|dat|txt)$|\/[^./]+$/i;
  const sniff = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'plaintext' || !NAME.test(doc.uri.path) || doc.lineCount > 20000) return;
    // First non-comment line decides, like the firstLine rule of the language contribution.
    const head = doc.getText().slice(0, 4000);
    if (detectProgram(head) && /^\s*&\s*(control|inputph|projwfc|dos|bands|inputpp|plot)\b/im.test(head)) {
      vscode.languages.setTextDocumentLanguage(doc, 'qe');
    }
  };
  vscode.workspace.textDocuments.forEach(sniff);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(sniff));
}

function register(context: vscode.ExtensionContext, lang: InputLanguage) {
  const collection = vscode.languages.createDiagnosticCollection(lang.id);
  const cache = new LintCache((doc) => lang.lint(doc.getText(), doc.uri));
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const { format, complete } = lang;
  const refresh = (doc: vscode.TextDocument) => {
    if (doc.languageId !== lang.id) return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      await cache.whenCurrent(doc, (diagnostics) => collection.set(doc.uri, toVscodeDiagnostics(doc, diagnostics, lang.label)));
    }, 250));
  };
  // A neighbouring input file changed on disk: recheck the open files of this language there.
  const folders = new FolderWatch((dir) => {
    cache.invalidate();
    for (const d of vscode.workspace.textDocuments) if (FolderWatch.dirOf(d.uri) === dir) refresh(d);
  });
  const open = (doc: vscode.TextDocument) => {
    if (doc.languageId !== lang.id) return;
    folders.track(doc.uri);
    refresh(doc);
  };

  vscode.workspace.textDocuments.forEach(open);

  context.subscriptions.push(
    collection,
    folders,
    vscode.workspace.onDidOpenTextDocument(open),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId !== lang.id) return;
      folders.untrack(doc.uri);
      cache.delete(doc.uri);
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    }),
    ...(format ? [registerFormatter(lang.id, lang.label, format)] : []),
    registerQuickFixes(lang.id, cache),
    vscode.languages.registerHoverProvider(lang.id, {
      async provideHover(doc, position) {
        const h = await lang.hover(doc.getText(), doc.offsetAt(position), doc.uri);
        return h && new vscode.Hover(new vscode.MarkdownString(h.markdown), new vscode.Range(doc.positionAt(h.start), doc.positionAt(h.end)));
      },
    }),
    ...(complete ? [registerCompletion(lang.id, complete, lang.triggers ?? [])] : []),
  );
}

function registerFormatter(id: string, label: string, format: (text: string) => string | undefined): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider(id, {
    provideDocumentFormattingEdits(doc) {
      const before = doc.getText();
      const after = format(before);
      if (after === undefined) {
        vscode.window.showWarningMessage(`${label} not formatted: fix the errors in the Problems panel first, so no line gets misread.`);
        return [];
      }
      const edit = minimalEdit(before, after);
      return edit ? [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text)] : [];
    },
  });
}

const COMPLETION_KINDS: Record<QeCompletion['kind'], vscode.CompletionItemKind> = {
  variable: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.EnumMember,
  namelist: vscode.CompletionItemKind.Module,
  card: vscode.CompletionItemKind.Keyword,
};

function registerCompletion(id: string, complete: (text: string, offset: number) => QeCompletion[], triggers: string[]): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    id,
    {
      provideCompletionItems(doc, position) {
        return complete(doc.getText(), doc.offsetAt(position)).map((c) => {
          const item = new vscode.CompletionItem(c.label, COMPLETION_KINDS[c.kind]);
          item.detail = c.detail;
          if (c.documentation) item.documentation = new vscode.MarkdownString(c.documentation);
          item.insertText = c.insertText.includes('$') ? new vscode.SnippetString(c.insertText) : c.insertText;
          item.sortText = c.sortText;
          return item;
        });
      },
    },
    ...triggers,
  );
}
