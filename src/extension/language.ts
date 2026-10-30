// Plain-text INCAR support: diagnostics, hover and completion.
// Useful on its own for people who never open the builder.

import * as vscode from 'vscode';
import {
  CATEGORY_LABELS,
  TAG_DEFS,
  entryAt,
  parseIncar,
  tagDef,
  validate,
  wikiUrl,
  type Diagnostic,
  type TagDef,
} from '../core';
import { findPoscar } from './poscar';

const SEVERITY: Record<Diagnostic['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

export function registerLanguageFeatures(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection('incar');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'incar') return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      const poscar = await findPoscar(doc.uri);
      collection.set(doc.uri, toVscodeDiagnostics(doc, validate(parseIncar(doc.getText()), { poscar: poscar?.info })));
    }, 250));
  };

  vscode.workspace.textDocuments.forEach(refresh);
  const poscarWatcher = vscode.workspace.createFileSystemWatcher('**/POSCAR*');
  const refreshSiblings = (uri: vscode.Uri) => {
    const dir = vscode.Uri.joinPath(uri, '..').toString();
    for (const doc of vscode.workspace.textDocuments) {
      if (vscode.Uri.joinPath(doc.uri, '..').toString() === dir) refresh(doc);
    }
  };
  poscarWatcher.onDidChange(refreshSiblings);
  poscarWatcher.onDidCreate(refreshSiblings);
  poscarWatcher.onDidDelete(refreshSiblings);

  context.subscriptions.push(
    collection,
    poscarWatcher,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.languages.registerHoverProvider('incar', { provideHover }),
    vscode.languages.registerCompletionItemProvider('incar', { provideCompletionItems }, '=', ' '),
  );
}

export function toVscodeDiagnostics(doc: vscode.TextDocument, diagnostics: Diagnostic[]): vscode.Diagnostic[] {
  return diagnostics.map((d) => {
    const span = d.span ?? { start: 0, end: 0 };
    const range = new vscode.Range(doc.positionAt(span.start), doc.positionAt(span.end));
    const diag = new vscode.Diagnostic(range, d.message, SEVERITY[d.severity]);
    diag.source = 'INCAR';
    diag.code = d.tag ? { value: d.code, target: vscode.Uri.parse(wikiUrl(d.tag)) } : d.code;
    return diag;
  });
}

export function tagMarkdown(def: TagDef, currentValue?: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${def.name}** · ${CATEGORY_LABELS[def.category]}\n\n${def.summary}\n\n`);
  const facts: string[] = [`type: \`${def.type}\``];
  if (def.unit) facts.push(`unit: ${def.unit}`);
  if (def.default !== undefined) facts.push(`default: \`${def.default}\``);
  else if (def.defaultNote) facts.push(`default: ${def.defaultNote}`);
  md.appendMarkdown(facts.join(' · ') + '\n\n');
  if (def.options) {
    for (const o of def.options) {
      const active = currentValue !== undefined && o.value.toUpperCase() === currentValue.toUpperCase();
      const label = active ? `**${o.label}**` : o.label;
      md.appendMarkdown(`- \`${o.value}\` ${label}${o.description ? ` (${o.description})` : ''}\n`);
    }
    md.appendMarkdown('\n');
  }
  md.appendMarkdown(`[VASP wiki](${wikiUrl(def.name)})`);
  return md;
}

function provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const parsed = parseIncar(doc.getText());
  const entry = entryAt(parsed, doc.offsetAt(position));
  if (!entry) return undefined;
  const def = tagDef(entry.key);
  if (!def) return undefined;
  return new vscode.Hover(tagMarkdown(def, entry.value), new vscode.Range(doc.positionAt(entry.keySpan.start), doc.positionAt(entry.keySpan.end)));
}

function provideCompletionItems(doc: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const line = doc.lineAt(position.line).text.slice(0, position.character);
  const statement = line.slice(line.lastIndexOf(';') + 1);
  if (/[!#]/.test(statement)) return [];

  const assign = statement.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*([^=]*)$/);
  if (assign) {
    // Value position: offer the tag's documented values.
    const def = tagDef(assign[1]);
    const opts = def?.options ?? (def?.type === 'bool' ? [{ value: '.TRUE.', label: 'true' }, { value: '.FALSE.', label: 'false' }] : []);
    return opts.map((o, i) => {
      const item = new vscode.CompletionItem(o.value, vscode.CompletionItemKind.EnumMember);
      item.detail = o.label;
      item.documentation = 'description' in o ? o.description : undefined;
      item.sortText = String(i).padStart(3, '0');
      return item;
    });
  }

  if (!/^\s*[A-Za-z0-9_]*$/.test(statement)) return [];
  const present = parseIncar(doc.getText()).tags;
  return TAG_DEFS.filter((d) => !present.has(d.name)).map((def) => {
    const item = new vscode.CompletionItem(def.name, vscode.CompletionItemKind.Property);
    item.detail = CATEGORY_LABELS[def.category];
    item.documentation = tagMarkdown(def);
    item.insertText = new vscode.SnippetString(`${def.name} = \${1:${def.default ?? ''}}`);
    item.sortText = (def.advanced ? '1' : '0') + def.name;
    return item;
  });
}
