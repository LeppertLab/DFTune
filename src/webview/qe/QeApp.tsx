import { useEffect, useMemo, useState } from 'react';
import { QE_INTENTS, Reader, cardsOf, describeCell, detectProgram, parseQe, qeCell, qeStructure, validateQe, type QeChange, type TextEdit } from '../../core';
import type { ToWebviewQe } from '../../extension/messages';
import { Diagnostics } from '../components/Diagnostics';
import { vscode } from '../vscode';
import { QeIntentCard } from './QeIntentCard';
import { QeVarTable } from './QeVarTable';

type State = Omit<ToWebviewQe, 'type'>;

export function QeApp() {
  const [state, setState] = useState<State>();

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebviewQe>) => {
      if (event.data.type === 'update-qe') setState(event.data);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return state ? <QeBuilder state={state} /> : <div className="loading">Loading input…</div>;
}

/** The builder for one input: a pure view of what the extension sent (so it can be rendered in tests). */
export function QeBuilder({ state }: { state: State }) {
  const derived = useMemo(() => {
    const program = detectProgram(state.text) ?? 'pw';
    const doc = parseQe(state.text, { cards: cardsOf(program) });
    const pseudos = state.pseudos ? new Map(state.pseudos) : undefined;
    return { program, doc, reader: new Reader(doc), diagnostics: validateQe(doc, program, { pseudos }) };
  }, [state]);

  const { program, doc, reader, diagnostics } = derived;
  const apply = (changes: QeChange[]) => vscode.postMessage({ type: 'qeSet', changes });
  const reveal = (offset: number, end?: number) => vscode.postMessage({ type: 'reveal', offset, end });
  const fix = (edit: TextEdit) => vscode.postMessage({ type: 'applyEdit', edit, text: state.text });

  const cell = qeCell(doc);
  const structure = qeStructure(doc);
  const species = doc.cards.find((c) => c.name === 'ATOMIC_SPECIES')?.lines.filter((l) => l.text.trim()).length ?? 0;
  const kp = doc.cards.find((c) => c.name === 'K_POINTS');

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{state.fileName}</h1>
          <div className="muted">
            {structure ? `${structure.frac.length} atoms · ${species} species` : 'Structure not readable yet (cell and ATOMIC_POSITIONS)'}
            {cell && !('error' in cell) ? ` · ${describeCell(cell.lattice, cell.volume)}` : ''}
          </div>
          <div className="muted">{kp ? `K_POINTS ${kp.option ?? 'tpiba'}${kp.option === 'automatic' ? ': ' + (kp.lines.find((l) => l.text.trim())?.text.trim() ?? '') : ''}` : 'No K_POINTS card'}</div>
          {state.pseudos && <div className="muted">{state.pseudos.map(([file, p]) => (p.status === 'ok' && p.info ? `${file} (${p.info.element ?? '?'}, ${p.info.type ?? '?'}, ${p.info.functional ?? '?'})` : `${file} (${p.status})`)).join(' · ')}</div>}
          {program !== 'pw' && <div className="muted">This builder covers pw.x; {program}.x inputs only get the variable table.</div>}
        </div>
        <button className="secondary" onClick={() => reveal(0)} title="Show the input text beside the builder">
          Show text
        </button>
      </header>

      <Diagnostics diagnostics={diagnostics} onReveal={reveal} onFix={fix} />

      <div className="columns">
        {program === 'pw' && (
          <section className="setup">
            <h2>Setup</h2>
            {QE_INTENTS.map((kind) => (
              <QeIntentCard key={kind.id} kind={kind} doc={doc} reader={reader} program={program} onApply={apply} />
            ))}
          </section>
        )}
        <section className="tags">
          <h2>All variables</h2>
          <QeVarTable doc={doc} program={program} diagnostics={diagnostics} onApply={apply} onReveal={reveal} />
        </section>
      </div>
    </div>
  );
}
