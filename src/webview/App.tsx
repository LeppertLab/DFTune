import { useEffect, useMemo, useState } from 'react';
import { INTENTS, describeKpoints, parseIncar, tagReader, validate, type TagChanges } from '../core';
import type { ToWebview } from '../extension/messages';
import { Diagnostics } from './components/Diagnostics';
import { HubbardCard } from './components/HubbardCard';
import { IntentCard } from './components/IntentCard';
import { TagTable } from './components/TagTable';
import { vscode } from './vscode';

type State = Omit<ToWebview, 'type'>;

export function App() {
  const [state, setState] = useState<State>();

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      if (event.data.type === 'update') setState(event.data);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const derived = useMemo(() => {
    if (!state) return undefined;
    const doc = parseIncar(state.text);
    return { doc, reader: tagReader(doc), diagnostics: validate(doc, { poscar: state.poscar, kpoints: state.kpoints }) };
  }, [state]);

  if (!state || !derived) return <div className="loading">Loading INCAR…</div>;
  const { doc, reader, diagnostics } = derived;
  const apply = (changes: TagChanges) => vscode.postMessage({ type: 'setTags', changes });
  const reveal = (offset: number, end?: number) => vscode.postMessage({ type: 'reveal', offset, end });
  const species = state.poscar?.species;

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{state.fileName}</h1>
          <div className="muted">
            {state.poscar
              ? `${state.poscar.fileName}: ${state.poscar.nions} atoms${species ? ` · ${species.map((s, i) => `${s}${state.poscar!.counts[i]}`).join(' ')}` : ''}`
              : 'No POSCAR next to this INCAR: per-atom and per-species checks are off.'}
          </div>
          <div className="muted">
            {state.kpoints
              ? `${state.kpoints.fileName}: ${describeKpoints(state.kpoints)}`
              : `No KPOINTS: mesh from KSPACING = ${reader.raw('KSPACING') ? `${reader.raw('KSPACING')} Å⁻¹` : '0.5 Å⁻¹ (default)'}`}
          </div>
        </div>
        <button className="secondary" onClick={() => reveal(0)} title="Show the INCAR text beside the builder">
          Show text
        </button>
      </header>

      <Diagnostics diagnostics={diagnostics} onReveal={reveal} />

      <div className="columns">
        <section className="setup">
          <h2>Setup</h2>
          {INTENTS.map((kind) => (
            <IntentCard key={kind.id} kind={kind} doc={doc} reader={reader} onApply={apply} />
          ))}
          <HubbardCard reader={reader} species={species} onApply={apply} />
        </section>
        <section className="tags">
          <h2>All tags</h2>
          <TagTable doc={doc} diagnostics={diagnostics} onApply={apply} onReveal={reveal} />
        </section>
      </div>
    </div>
  );
}
