import { useState } from 'react';
import { CATEGORY_LABELS, TAG_DEFS, wikiUrl, type Category, type Diagnostic, type IncarDoc, type TagChanges } from '../../core';
import { loadUiState, vscode } from '../vscode';
import { TagField } from './TagField';

interface Props {
  doc: IncarDoc;
  diagnostics: Diagnostic[];
  onApply(changes: TagChanges): void;
  onReveal(offset: number, end?: number): void;
}

interface Filters {
  query: string;
  onlySet: boolean;
  advanced: boolean;
}

export function TagTable({ doc, diagnostics, onApply, onReveal }: Props) {
  const [filters, setFilters] = useState<Filters>(() => loadUiState({ query: '', onlySet: false, advanced: false }));
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    vscode.setState(next);
  };

  const q = filters.query.trim().toUpperCase();
  const matches = (name: string, summary = '') => !q || name.includes(q) || summary.toUpperCase().includes(q);
  const problemTags = new Set(diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning').map((d) => d.tag));

  const visible = TAG_DEFS.filter((d) => {
    const set = doc.tags.has(d.name);
    if (filters.onlySet && !set) return false;
    if (d.advanced && !set && !filters.advanced && !q) return false;
    return matches(d.name, d.summary);
  });
  const byCategory = new Map<Category, typeof visible>();
  for (const def of visible) byCategory.set(def.category, [...(byCategory.get(def.category) ?? []), def]);

  // Tags in the file that the knowledge base doesn't cover: shown and editable as raw text.
  const unknown = [...doc.tags.values()].filter((e) => !TAG_DEFS.some((d) => d.name === e.key) && matches(e.key));

  return (
    <div className="tag-table">
      <div className="filters">
        <input type="search" placeholder="Search tags and descriptions" value={filters.query} onChange={(e) => update({ query: e.target.value })} aria-label="Search tags" />
        <label>
          <input type="checkbox" checked={filters.onlySet} onChange={(e) => update({ onlySet: e.target.checked })} /> Set only
        </label>
        <label>
          <input type="checkbox" checked={filters.advanced} onChange={(e) => update({ advanced: e.target.checked })} /> Advanced
        </label>
      </div>

      {unknown.length > 0 && (
        <details open>
          <summary>Other tags in this file ({unknown.length})</summary>
          {unknown.map((e) => (
            <Row key={e.key} name={e.key} summary="Not in the builder's tag list; edited as raw text." set onReveal={() => onReveal(e.span.start, e.span.end)}>
              <TagField name={e.key} value={e.value} onChange={(v) => onApply({ [e.key]: v })} />
            </Row>
          ))}
        </details>
      )}

      {[...byCategory].map(([category, defs]) => (
        <details key={category} open={!!q || filters.onlySet || defs.some((d) => doc.tags.has(d.name))}>
          <summary>
            {CATEGORY_LABELS[category]} <span className="muted">({defs.filter((d) => doc.tags.has(d.name)).length}/{defs.length})</span>
          </summary>
          {defs.map((def) => {
            const entry = doc.tags.get(def.name);
            return (
              <Row
                key={def.name}
                name={def.name}
                summary={def.summary}
                set={!!entry}
                problem={problemTags.has(def.name)}
                onReveal={entry ? () => onReveal(entry.span.start, entry.span.end) : undefined}
              >
                <TagField def={def} name={def.name} value={entry?.value} onChange={(v) => onApply({ [def.name]: v })} />
              </Row>
            );
          })}
        </details>
      ))}
    </div>
  );
}

function Row(props: { name: string; summary: string; set: boolean; problem?: boolean; onReveal?(): void; children: React.ReactNode }) {
  return (
    <div className={`tag-row${props.set ? ' set' : ''}${props.problem ? ' problem' : ''}`}>
      <div className="tag-name">
        <a href={wikiUrl(props.name)} title="Open on the VASP wiki">{props.name}</a>
        {props.onReveal && (
          <button className="icon-button" onClick={props.onReveal} title="Show in the text editor">↗</button>
        )}
      </div>
      <div className="tag-summary muted">{props.summary}</div>
      <div className="tag-value">{props.children}</div>
    </div>
  );
}
