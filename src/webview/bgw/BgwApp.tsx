import { useEffect, useMemo, useState } from 'react';
import { bgwManualUrl, detectBgwProgram, keywordsOf, parseBgw, validateBgw, type BgwChange, type BgwDoc, type BgwKeyword, type BgwProgram, type TextEdit } from '../../core';
import type { ToWebviewBgw } from '../../extension/messages';
import { Diagnostics } from '../components/Diagnostics';
import { loadUiState, vscode } from '../vscode';

type State = Omit<ToWebviewBgw, 'type'>;

export function BgwApp() {
  const [state, setState] = useState<State>();
  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebviewBgw>) => {
      if (event.data.type === 'update-bgw') setState(event.data);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return state ? <BgwBuilder state={state} /> : <div className="loading">Loading input…</div>;
}

interface Filters {
  query: string;
  onlySet: boolean;
}

/** First paragraph of the documentation, short enough for a row. */
const brief = (doc: string) => {
  const first = doc.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return first.length > 220 ? first.slice(0, 220).replace(/\s+\S*$/, '') + '…' : first;
};

/** The builder for one BerkeleyGW input: a pure view of what the extension sent. */
export function BgwBuilder({ state }: { state: State }) {
  const derived = useMemo(() => {
    const program = detectBgwProgram(state.fileName, state.text);
    const doc = parseBgw(state.text);
    const neighbors = (state.neighbors ?? []).map((n) => ({ program: n.program as BgwProgram, fileName: n.fileName, doc: parseBgw(n.text) }));
    return { program, doc, diagnostics: program ? validateBgw(doc, program, { neighbors }) : doc.issues };
  }, [state]);
  const { program, doc, diagnostics } = derived;

  const [filters, setFilters] = useState<Filters>(() => loadUiState({ query: '', onlySet: false }));
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    vscode.setState(next);
  };

  const apply = (changes: BgwChange[]) => vscode.postMessage({ type: 'bgwSet', changes });
  const reveal = (offset: number, end?: number) => vscode.postMessage({ type: 'reveal', offset, end });
  const fix = (edit: TextEdit) => vscode.postMessage({ type: 'applyEdit', edit, text: state.text });

  const q = filters.query.trim().toLowerCase();
  const keywords = program ? keywordsOf(program) : [];
  const isSet = (k: BgwKeyword) => (k.kind === 'block' ? doc.blocks.some((b) => b.name === k.name) : doc.entries.some((e) => e.keyword === k.name));
  const shown = keywords
    .filter((k) => (!q || k.name.includes(q) || k.doc.toLowerCase().includes(q)) && (!filters.onlySet || isSet(k)))
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
  const unknown = doc.entries.filter((e) => program && !keywords.some((k) => k.name === e.keyword));

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{state.fileName}</h1>
          <div className="muted">
            {program ? (
              <>
                BerkeleyGW {program}.x · {doc.entries.length} keywords, {doc.blocks.length} blocks · <a href={bgwManualUrl(program)}>manual</a>
              </>
            ) : (
              'The program is not recognized from the file name or its keywords: name the file epsilon.inp, sigma.inp, kernel.inp, absorption.inp or inteqp.inp.'
            )}
          </div>
        </div>
        <button className="secondary" onClick={() => reveal(0)} title="Show the input text beside the builder">
          Show text
        </button>
      </header>

      <Diagnostics diagnostics={diagnostics} onReveal={reveal} onFix={fix} />

      {program && (
        <section className="tags">
          <h2>Keywords</h2>
          <div className="tag-table">
            <div className="filters">
              <input type="search" placeholder="Search keywords and descriptions" value={filters.query} onChange={(e) => update({ query: e.target.value })} aria-label="Search keywords" />
              <label>
                <input type="checkbox" checked={filters.onlySet} onChange={(e) => update({ onlySet: e.target.checked })} /> Set only
              </label>
            </div>
            {shown.map((k) => (
              <KeywordRow key={k.name} k={k} doc={doc} program={program} onApply={apply} onReveal={reveal} />
            ))}
            {unknown.length > 0 && !q && (
              <p className="muted">
                Not in the table: {[...new Set(unknown.map((e) => e.keyword))].join(', ')}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function KeywordRow({ k, doc, program, onApply, onReveal }: { k: BgwKeyword; doc: BgwDoc; program: BgwProgram; onApply(c: BgwChange[]): void; onReveal(a: number, b?: number): void }) {
  const entry = [...doc.entries].reverse().find((e) => e.keyword === k.name);
  const block = doc.blocks.find((b) => b.name === k.name);
  const set = k.kind === 'block' ? !!block : !!entry;
  const at = k.kind === 'block' ? block?.span : entry?.span;
  return (
    <div className={`tag-row${set ? ' set' : ''}`}>
      <div className="tag-name">
        <a href={`${bgwManualUrl(program)}#${k.name}`} title="Open the manual">
          {k.kind === 'block' ? `begin ${k.name}` : k.name}
        </a>
        {at && (
          <button className="icon-button" onClick={() => onReveal(at.start, at.end)} title="Show in the text editor">
            ↗
          </button>
        )}
      </div>
      <div className="tag-summary muted">
        {brief(k.doc)}
        {k.required && !set ? ' (required)' : ''}
      </div>
      <div className="tag-value">
        <KeywordField k={k} value={entry?.value} rows={block?.rows.map((r) => r.text)} set={set} onApply={onApply} />
      </div>
    </div>
  );
}

function KeywordField({ k, value, rows, set, onApply }: { k: BgwKeyword; value?: string; rows?: string[]; set: boolean; onApply(c: BgwChange[]): void }) {
  const initial = k.kind === 'block' ? (rows ?? []).join('\n') : (value ?? '');
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const label = k.name;

  if (k.type === 'toggle') {
    return <input type="checkbox" checked={set} aria-label={label} onChange={(e) => onApply([{ keyword: k.name, value: e.target.checked ? '' : null }])} />;
  }
  if (k.kind === 'keyword' && k.options.length > 1 && k.type === 'integer') {
    const known = k.options.some((o) => o.value === value);
    return (
      <select className={set ? '' : 'unset'} value={value ?? ''} aria-label={label} onChange={(e) => onApply([{ keyword: k.name, value: e.target.value || null }])}>
        <option value="">not set{k.default ? ` (default ${k.default})` : ''}</option>
        {k.options.map((o) => (
          <option key={o.value} value={o.value} title={o.note}>
            {o.value}
            {o.note ? ` – ${o.note.slice(0, 50)}` : ''}
          </option>
        ))}
        {set && !known && <option value={value}>{value}</option>}
      </select>
    );
  }
  if (k.kind === 'block') {
    const commit = () => {
      const lines = draft.split('\n').filter((l) => l.trim());
      if (draft === initial) return;
      onApply([{ block: k.name, rows: lines.length ? lines : null }]);
    };
    return (
      <textarea
        className="block-rows"
        rows={Math.max(2, (rows?.length ?? 0) + 1)}
        value={draft}
        placeholder={k.cols.length ? k.cols.join(' ') : 'one row per line'}
        aria-label={label}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    );
  }
  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? '')) return;
    onApply([{ keyword: k.name, value: next === '' ? null : next }]);
  };
  return (
    <span className="text-field">
      <input
        value={draft}
        placeholder={k.default || k.example}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(value ?? '');
        }}
      />
    </span>
  );
}
