// Plain-text INCAR support: diagnostics, hover and completion.
// Useful on its own for people who never open the builder.

import * as vscode from 'vscode';
import {
  CATEGORY_LABELS,
  DEFAULT_FORMAT_OPTIONS,
  KNOWN_TAG_NAMES,
  TAG_DEFS,
  TAGS,
  entryAt,
  formatIncar,
  knownTag,
  minimalEdit,
  parseIncar,
  tagDef,
  validate,
  wikiUrl,
  type Diagnostic,
  type FormatOptions,
  type KnownTag,
  type TagDef,
} from '../core';
import { findInputs, watchInputs } from './inputs';

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
      const { poscar, kpoints } = await findInputs(doc.uri);
      const diagnostics = validate(parseIncar(doc.getText()), { poscar: poscar?.info, kpoints: kpoints?.info ?? null });
      collection.set(doc.uri, toVscodeDiagnostics(doc, diagnostics));
    }, 250));
  };

  // Watch POSCAR/KPOINTS only in folders with an open INCAR: a workspace-wide watcher can be
  // expensive on large cluster file systems (GPFS, Lustre).
  const watchers = new Map<string, { watcher: vscode.Disposable; docs: Set<string> }>();
  const dirOf = (uri: vscode.Uri) => vscode.Uri.joinPath(uri, '..');
  const track = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'incar') return;
    const dir = dirOf(doc.uri);
    let entry = watchers.get(dir.toString());
    if (!entry) {
      // A POSCAR or KPOINTS changed: recheck the INCARs open in that folder.
      const watcher = watchInputs(() => {
        for (const d of vscode.workspace.textDocuments) if (dirOf(d.uri).toString() === dir.toString()) refresh(d);
      }, dir);
      entry = { watcher, docs: new Set() };
      watchers.set(dir.toString(), entry);
    }
    entry.docs.add(doc.uri.toString());
  };
  const untrack = (doc: vscode.TextDocument) => {
    const key = dirOf(doc.uri).toString();
    const entry = watchers.get(key);
    if (!entry?.docs.delete(doc.uri.toString()) || entry.docs.size) return;
    entry.watcher.dispose();
    watchers.delete(key);
  };

  for (const doc of vscode.workspace.textDocuments) {
    track(doc);
    refresh(doc);
  }

  context.subscriptions.push(
    collection,
    { dispose: () => watchers.forEach((e) => e.watcher.dispose()) },
    vscode.workspace.onDidOpenTextDocument((doc) => {
      track(doc);
      refresh(doc);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      untrack(doc);
      collection.delete(doc.uri);
    }),
    vscode.languages.registerHoverProvider('incar', { provideHover }),
    vscode.languages.registerDocumentFormattingEditProvider('incar', { provideDocumentFormattingEdits }),
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
  const deprecated = knownTag(def.name)?.deprecated;
  if (deprecated) md.appendMarkdown(`⚠ Deprecated: ${deprecated}\n\n`);
  md.appendMarkdown(`[VASP wiki](${wikiUrl(def.name)})`);
  return md;
}

/** Hover text for a valid tag outside the curated definitions (wiki summary only). */
export function knownTagMarkdown(tag: KnownTag): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${tag.name}**${PATCH_LABELS[tag.source] ? ` · ${PATCH_LABELS[tag.source]}` : ''}\n\n`);
  if (tag.aliasOf) md.appendMarkdown(`Older or alternative name for **${tag.aliasOf}**.\n\n`);
  md.appendMarkdown(`${tag.summary || 'No description available.'}\n\n`);
  const facts: string[] = [];
  if (tag.type) facts.push(`type: \`${tag.type}\``);
  if (tag.default) facts.push(`default: ${tag.default}`);
  if (facts.length) md.appendMarkdown(facts.join(' · ') + '\n\n');
  if (tag.deprecated) md.appendMarkdown(`⚠ Deprecated: ${tag.deprecated}\n\n`);
  if (tag.page) md.appendMarkdown(`[VASP wiki](${wikiUrl(tag.page)})`);
  else if (tag.source === 'vtst') md.appendMarkdown('Only read by VASP builds with the [VTST](https://theory.cm.utexas.edu/vtsttools/) patch.');
  else if (tag.source === 'vaspsol') md.appendMarkdown('Only read by VASP builds with the [VASPsol](https://github.com/henniggroup/VASPsol) patch.');
  return md;
}

const PATCH_LABELS: Partial<Record<KnownTag['source'], string>> = { vtst: 'VTST Tools', vaspsol: 'VASPsol' };

function provideDocumentFormattingEdits(doc: vscode.TextDocument): vscode.TextEdit[] {
  const config = vscode.workspace.getConfiguration('projectElectrons.format', doc.uri);
  const options: FormatOptions = {
    groupByCategory: config.get('groupByCategory', DEFAULT_FORMAT_OPTIONS.groupByCategory),
    categoryHeaders: config.get('categoryHeaders', DEFAULT_FORMAT_OPTIONS.categoryHeaders),
    alignEquals: config.get('alignEquals', DEFAULT_FORMAT_OPTIONS.alignEquals),
    alignComments: config.get('alignComments', DEFAULT_FORMAT_OPTIONS.alignComments),
  };
  const before = doc.getText();
  const after = formatIncar(before, options);
  if (after === undefined) {
    vscode.window.showWarningMessage('INCAR not formatted: fix the syntax problems in the Problems panel first, so no text gets moved to the wrong place.');
    return [];
  }
  const edit = minimalEdit(before, after);
  return edit ? [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text)] : [];
}

function provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const parsed = parseIncar(doc.getText());
  const entry = entryAt(parsed, doc.offsetAt(position));
  if (!entry) return undefined;
  const range = new vscode.Range(doc.positionAt(entry.keySpan.start), doc.positionAt(entry.keySpan.end));
  const def = tagDef(entry.key);
  if (def) return new vscode.Hover(tagMarkdown(def, entry.value), range);
  const known = knownTag(entry.key);
  return known ? new vscode.Hover(knownTagMarkdown(known), range) : undefined;
}

function provideCompletionItems(doc: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const line = doc.lineAt(position.line).text.slice(0, position.character);
  const statement = line.slice(line.lastIndexOf(';') + 1);
  if (/[!#]/.test(statement)) return [];

  const assign = statement.match(/^\s*([A-Za-z][A-Za-z0-9_/]*)\s*=\s*([^=]*)$/);
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

  if (!/^\s*[A-Za-z0-9_/]*$/.test(statement)) return [];
  const present = parseIncar(doc.getText()).tags;
  const curated = TAG_DEFS.filter((d) => !present.has(d.name)).map((def) => {
    const item = new vscode.CompletionItem(def.name, vscode.CompletionItemKind.Property);
    item.detail = CATEGORY_LABELS[def.category];
    item.documentation = tagMarkdown(def);
    item.insertText = new vscode.SnippetString(`${def.name} = \${1:${def.default ?? ''}}`);
    item.sortText = (def.advanced ? '1' : '0') + def.name;
    return item;
  });
  // The rest of the documented tags, listed after the curated ones.
  const rest = KNOWN_TAG_NAMES.filter((name) => !TAGS.has(name) && !present.has(name)).map((name) => {
    const known = knownTag(name)!;
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
    item.detail = PATCH_LABELS[known.source] ?? (known.deprecated ? 'Deprecated' : 'Other VASP tag');
    item.documentation = knownTagMarkdown(known);
    item.insertText = new vscode.SnippetString(`${name} = \${1}`);
    item.sortText = '2' + name;
    if (known.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
    return item;
  });
  return [...curated, ...rest];
}
