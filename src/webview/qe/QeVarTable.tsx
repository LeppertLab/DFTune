import { useState } from 'react';
import { namelistsOf, qeDocsUrl, varsOf, type Diagnostic, type QeChange, type QeDoc, type QeProgram, type QeVar } from '../../core';
import { loadUiState, vscode } from '../vscode';
import { QeVarField } from './QeVarField';

interface Props {
  doc: QeDoc;
  program: QeProgram;
  diagnostics: Diagnostic[];
  onApply(changes: QeChange[]): void;
  onReveal(offset: number, end?: number): void;
}

interface Filters {
  query: string;
  onlySet: boolean;
}

/** The indices an array variable shows: a numeric range, or 1…ntyp / 1…nat from the input; else only those set. */
function indicesOf(v: QeVar, doc: QeDoc): string[] | undefined {
  const [lo, hi] = v.dim.split(':');
  if (!v.dim || !/^\d+$/.test(lo)) return undefined;
  let max = Number(hi);
  if (!Number.isFinite(max)) {
    const named = doc.namelists.find((n) => n.name === 'SYSTEM')?.entries.find((e) => e.name === hi.toLowerCase());
    max = Number(named?.items[0]?.text);
  }
  if (!Number.isInteger(max) || max < Number(lo) || max > 12) return undefined;
  return Array.from({ length: max - Number(lo) + 1 }, (_, i) => String(Number(lo) + i));
}

export function QeVarTable({ doc, program, diagnostics, onApply, onReveal }: Props) {
  const [filters, setFilters] = useState<Filters>(() => loadUiState({ query: '', onlySet: false }));
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    vscode.setState(next);
  };
  const q = filters.query.trim().toLowerCase();
  const matches = (v: QeVar) => !q || v.name.toLowerCase().includes(q) || v.summary.toLowerCase().includes(q);
  const problem = new Set(diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning').flatMap((d) => (d.span ? [`${d.span.start}`] : [])));

  return (
    <div className="tag-table">
      <div className="filters">
        <input type="search" placeholder="Search variables and descriptions" value={filters.query} onChange={(e) => update({ query: e.target.value })} aria-label="Search variables" />
        <label>
          <input type="checkbox" checked={filters.onlySet} onChange={(e) => update({ onlySet: e.target.checked })} /> Set only
        </label>
      </div>
      {namelistsOf(program).map((namelist) => {
        const nl = doc.namelists.find((n) => n.name === namelist);
        const set = new Set((nl?.entries ?? []).map((e) => e.name));
        const vars = varsOf(program, namelist).filter((v) => matches(v) && (!filters.onlySet || set.has(v.name.toLowerCase())));
        if (!vars.length) return null;
        const all = varsOf(program, namelist);
        return (
          <details key={namelist} open={!!q || filters.onlySet || set.size > 0}>
            <summary>
              &amp;{namelist} <span className="muted">({all.filter((v) => set.has(v.name.toLowerCase())).length}/{all.length})</span>
              {!nl && <span className="muted"> · not in the file</span>}
            </summary>
            {vars.map((v) => {
              const entries = (nl?.entries ?? []).filter((e) => e.name === v.name.toLowerCase());
              const indices = indicesOf(v, doc);
              // Array variables: one row per element when the range is known, else one per element set.
              const rows: { index?: string; entry?: (typeof entries)[number] }[] = v.dim
                ? (indices ?? entries.map((e) => e.index ?? '')).map((index) => ({ index, entry: [...entries].reverse().find((e) => (e.index?.trim() ?? '') === index) }))
                : [{ entry: entries[entries.length - 1] }];
              return rows.map(({ index, entry }) => {
                const label = `${v.name}${index ? `(${index})` : ''}`;
                return (
                  <div key={label} className={`tag-row${entry ? ' set' : ''}${entry && problem.has(`${entry.keySpan.start}`) ? ' problem' : ''}`}>
                    <div className="tag-name">
                      <a href={qeDocsUrl(program)} title={`Open the ${program}.x input documentation`}>{label}</a>
                      {entry && (
                        <button className="icon-button" onClick={() => onReveal(entry.span.start, entry.span.end)} title="Show in the text editor">↗</button>
                      )}
                    </div>
                    <div className="tag-summary muted">{v.summary}{v.required && !entry ? ' (required)' : ''}</div>
                    <div className="tag-value">
                      <QeVarField v={v} label={label} value={entry?.value} onChange={(value) => onApply([{ namelist, name: v.name, index: index || undefined, value }])} />
                    </div>
                  </div>
                );
              });
            })}
          </details>
        );
      })}
    </div>
  );
}
