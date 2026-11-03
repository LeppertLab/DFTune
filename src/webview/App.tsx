import { useEffect, useMemo, useState } from 'react';
import { INTENTS, describeKpoints, kspacingMesh, parseIncar, potcarSymbols, tagGroup, tagReader, validate, type TagChanges } from '../core';
import type { ToWebview } from '../extension/messages';
import { Diagnostics } from './components/Diagnostics';
import { GroupCard } from './components/GroupCard';
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
    return { doc, reader: tagReader(doc), diagnostics: validate(doc, { poscar: state.poscar, kpoints: state.kpoints, potcar: state.potcar?.entries }) };
  }, [state]);

  if (!state || !derived) return <div className="loading">Loading INCAR…</div>;
  const { doc, reader, diagnostics } = derived;
  const apply = (changes: TagChanges) => vscode.postMessage({ type: 'setTags', changes });
  const reveal = (offset: number, end?: number) => vscode.postMessage({ type: 'reveal', offset, end });
  const species = state.poscar?.species;
  // Nested-tag groups used in this file (KERNEL_TRUNCATION, PLUGINS, …) each get a card.
  // Also for an empty `GROUP { }` block, so it can be filled in from the card.
  const groups = [...new Set([...doc.blocks.map((b) => b.name), ...[...doc.tags.keys()].map(tagGroup)].filter((g): g is string => !!g))];

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
              : `No KPOINTS: mesh from KSPACING = ${reader.raw('KSPACING') ? `${reader.raw('KSPACING')} Å⁻¹` : '0.5 Å⁻¹ (default)'}${kspacingText(state.poscar, reader.num('KSPACING') ?? 0.5)}`}
          </div>
          <div className="muted">{potcarText(state.potcar)}</div>
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
          {groups.map((group) => (
            <GroupCard key={group} group={group} doc={doc} onApply={apply} onReveal={reveal} />
          ))}
        </section>
        <section className="tags">
          <h2>All tags</h2>
          <TagTable doc={doc} diagnostics={diagnostics} onApply={apply} onReveal={reveal} />
        </section>
      </div>
    </div>
  );
}

/** " → 6 × 6 × 6 for this POSCAR", when the cell is known. */
function kspacingText(poscar: State['poscar'], kspacing: number): string {
  if (!poscar?.lattice || !poscar.volume || !(kspacing > 0)) return '';
  return ` → ${kspacingMesh({ lattice: poscar.lattice, volume: poscar.volume }, kspacing).join(' × ')} for this POSCAR`;
}

function potcarText(potcar: State['potcar']): string {
  if (!potcar) return 'No POTCAR next to this INCAR: element order and ENCUT are not checked against it.';
  const enmax = potcar.entries.map((e) => e.enmax).filter((x): x is number => x !== undefined);
  const kinds = [...new Set(potcar.entries.map((e) => e.kind))].join(', ');
  return `${potcar.fileName}: ${potcarSymbols(potcar.entries)} (${kinds})${enmax.length ? ` · ENMAX up to ${Math.max(...enmax)} eV` : ''}`;
}
